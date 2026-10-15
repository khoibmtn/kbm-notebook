import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { IngestError } from "@/server/knowledge/ingest/errors";
import { extractFile, MAX_SHEET_CELLS } from "@/server/knowledge/ingest/extract";
import { EXTRACT_MESSAGES, extractFileSandboxed } from "@/server/knowledge/ingest/extract-sandbox";
import { makeMaliciousPptx, makeMaliciousXlsx, makeXlsx } from "../helpers/docs";

const DIMENSION = /<dimension ref="[^"]+"\s*\/>/;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kbm-sandbox-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
function fakeWorker(name: string, code: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, code);
  return p;
}

describe("C-1 · tệp độc hại không treo tiến trình", () => {
  it("XLSX khai báo vùng khổng lồ: vùng được thu hẹp về dữ liệu thật, không lặp qua toàn vùng", async () => {
    const buf = await makeMaliciousXlsx();
    const t0 = Date.now();
    const res = await extractFile(buf, "xlsx");
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(res.segments[0].text).toBe("a: 1; b: 2");
  }, 10_000);

  it("XLSX có quá nhiều ô dữ liệu thật → IngestError rõ ràng", async () => {
    const cols = MAX_SHEET_CELLS / 1000 + 5;
    const rows = Array.from({ length: 1000 }, (_, r) => Array.from({ length: cols }, (_, c) => `${r}-${c}`));
    const err = await extractFile(makeXlsx([{ name: "Big", rows }]), "xlsx").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).message).toContain("Bảng tính quá lớn");
    expect((err as IngestError).permanent).toBe(true);
  }, 60_000);

  it("XLSX có hai ô ở hai góc xa nhau (vùng bao khổng lồ) → từ chối nhanh", async () => {
    const zip = await JSZip.loadAsync(makeXlsx([{ name: "S", rows: [["a"]] }]));
    const name = "xl/worksheets/sheet1.xml";
    const xml = await zip.file(name)!.async("string");
    const far = xml
      .replace(DIMENSION, '<dimension ref="A1:XFD1048576"/>')
      .replace("</sheetData>", '<row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>z</t></is></c></row></sheetData>');
    zip.file(name, far);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const t0 = Date.now();
    const err = await extractFile(buf, "xlsx").catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(err).toBeInstanceOf(IngestError);
  }, 10_000);

  it("PPTX với hàng trăm nghìn thẻ mở không đóng: parser XML từ chối nhanh", async () => {
    const buf = await makeMaliciousPptx();
    const t0 = Date.now();
    const err = await extractFile(buf, "pptx").catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).message).toContain("Slide 1");
  }, 15_000);

  it("qua sandbox: cả hai tệp độc hại không treo, event loop chính vẫn chạy", async () => {
    let ticks = 0;
    const iv = setInterval(() => ticks++, 20);
    try {
      const t0 = Date.now();
      const errPptx = await extractFileSandboxed(await makeMaliciousPptx(), "pptx", { timeoutMs: 20_000 }).catch((e: unknown) => e);
      expect(errPptx).toBeInstanceOf(IngestError);
      const resXlsx = await extractFileSandboxed(await makeMaliciousXlsx(), "xlsx", { timeoutMs: 20_000 });
      expect(resXlsx.segments[0].text).toContain("a: 1");
      expect(Date.now() - t0).toBeLessThan(15_000);
    } finally {
      clearInterval(iv);
    }
    expect(ticks).toBeGreaterThan(0);
  }, 30_000);

  it("sandbox: kết quả bình thường đi qua worker và lỗi nghiệp vụ giữ nguyên thông báo", async () => {
    const ok = await extractFileSandboxed(Buffer.from("# Tiêu đề\nNội dung tiếng Việt"), "md", { timeoutMs: 20_000 });
    expect(ok.segments[0]).toMatchObject({ section: "Tiêu đề" });
    const err = await extractFileSandboxed(Buffer.from("{hỏng"), "json", { timeoutMs: 20_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).message).toBe("Tệp JSON không hợp lệ");
    expect((err as IngestError).permanent).toBe(true);
  }, 30_000);

  it("worker vòng lặp vô hạn bị dừng đúng hạn và event loop chính không bị chặn", async () => {
    const workerPath = fakeWorker("hang.cjs", "while (true) {}\n");
    let ticks = 0;
    const iv = setInterval(() => ticks++, 20);
    const t0 = Date.now();
    const err = await extractFileSandboxed(Buffer.from("x"), "txt", { workerPath, timeoutMs: 400 }).catch((e: unknown) => e);
    const elapsed = Date.now() - t0;
    clearInterval(iv);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).message).toBe(EXTRACT_MESSAGES.timeout(1));
    expect((err as IngestError).permanent).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(5000);
    expect(ticks).toBeGreaterThan(5);
  }, 15_000);

  it("worker vượt giới hạn bộ nhớ (ERR_WORKER_OUT_OF_MEMORY) → thông báo giới hạn bộ nhớ", async () => {
    // V8 mất ~30 giây để thực sự cạn heap trên máy chậm nên mô phỏng đúng mã lỗi mà Node phát ra khi vượt resourceLimits.
    const workerPath = fakeWorker("oom.cjs", "const e = new Error('heap'); e.code = 'ERR_WORKER_OUT_OF_MEMORY'; throw e;\n");
    const err = await extractFileSandboxed(Buffer.from("x"), "txt", { workerPath, timeoutMs: 10_000, maxMemoryMb: 64 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).message).toBe(EXTRACT_MESSAGES.memory);
  }, 15_000);

  it("worker ném lỗi → IngestError 'bị dừng đột ngột'", async () => {
    const workerPath = fakeWorker("crash.cjs", "throw new Error('boom');\n");
    const err = await extractFileSandboxed(Buffer.from("x"), "txt", { workerPath, timeoutMs: 10_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).message).toBe(EXTRACT_MESSAGES.crashed);
  }, 15_000);
});
