import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ApiError } from "@/server/api/errors";
import { LocalDiskStorage } from "@/server/storage/local";
import { canAccessFile, deleteStoredFile, getFile } from "@/server/storage/files";
import { createNotebookWithMembers, insertSource } from "../helpers/fixtures";
import { createTestUser } from "../helpers/users";
import { db } from "@/server/db";
import { sources } from "@/server/db/schema";

const root = await mkdtemp(path.join(os.tmpdir(), "kbm-storage-"));
const storage = new LocalDiskStorage({ root, maxBytes: 1024 });

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readAll(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe("LocalDiskStorage", () => {
  it("put(buffer) tạo dòng files có sha256/size/mime và đọc lại đúng byte", async () => {
    const owner = await createTestUser();
    const data = Buffer.from("xin chào thế giới");
    const row = await storage.put(data, { ownerId: owner.id, mime: "text/plain", name: "chao.txt" });
    expect(row.sizeBytes).toBe(data.length);
    expect(row.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    expect(row.originalName).toBe("chao.txt");
    expect(row.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect((await readAll(await storage.getStream(row.storageKey))).toString()).toBe("xin chào thế giới");
  });

  it("put(stream) hoạt động và tên lưu là UUID (không dùng tên gốc)", async () => {
    const owner = await createTestUser();
    const row = await storage.put(Readable.from([Buffer.from("a"), Buffer.from("b")]), {
      ownerId: owner.id,
      mime: "application/pdf",
      name: "../../etc/passwd",
    });
    expect(row.sizeBytes).toBe(2);
    expect(row.storageKey).not.toContain("passwd");
  });

  it("vượt giới hạn dung lượng → 413 và không để lại tệp dở", async () => {
    const owner = await createTestUser();
    const before = JSON.stringify(await readdir(root, { recursive: true }));
    await expect(
      storage.put(Buffer.alloc(2048), { ownerId: owner.id, mime: "application/octet-stream", name: "big.bin" }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(storage.put(Buffer.alloc(2048), { ownerId: owner.id, mime: "x/y", name: "b" })).rejects.toBeInstanceOf(ApiError);
    const after = (await readdir(root, { recursive: true })).filter((f) => f.endsWith(".part"));
    expect(after).toHaveLength(0);
    expect(JSON.stringify(await readdir(root, { recursive: true }))).toBe(before);
  });

  it("chặn path traversal ở getStream/delete", async () => {
    await expect(storage.getStream("../../etc/passwd")).rejects.toThrow();
    await expect(storage.delete("../x")).rejects.toThrow();
  });

  it("delete xoá byte; deleteStoredFile xoá cả dòng", async () => {
    const owner = await createTestUser();
    const row = await storage.put(Buffer.from("bye"), { ownerId: owner.id, mime: "text/plain", name: "bye.txt" });
    await storage.delete(row.storageKey);
    await expect(storage.getStream(row.storageKey)).rejects.toThrow();
    await deleteStoredFile(row.id);
    expect(await getFile(row.id)).toBeNull();
  });
});

describe("canAccessFile", () => {
  it("chủ tệp truy cập được, người lạ thì không", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const row = await storage.put(Buffer.from("x"), { ownerId: owner.id, mime: "text/plain", name: "x.txt" });
    expect(await canAccessFile(owner.id, row.id)).toBe(true);
    expect(await canAccessFile(stranger.id, row.id)).toBe(false);
    expect(await canAccessFile(owner.id, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("thành viên notebook truy cập được tệp của nguồn shared; nguồn private chỉ chủ nguồn", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer", "editor"]);
    const outsider = await createTestUser();
    const shared = await storage.put(Buffer.from("s"), { ownerId: owner.id, mime: "application/pdf", name: "s.pdf" });
    const priv = await storage.put(Buffer.from("p"), { ownerId: members.editor.id, mime: "application/pdf", name: "p.pdf" });
    await insertSource(notebook.id, owner.id, { kind: "file", fileId: shared.id, visibility: "shared" });
    const privSrc = await insertSource(notebook.id, members.editor.id, { kind: "file", fileId: priv.id, visibility: "private" });

    expect(await canAccessFile(members.viewer.id, shared.id)).toBe(true);
    expect(await canAccessFile(outsider.id, shared.id)).toBe(false);
    expect(await canAccessFile(members.viewer.id, priv.id)).toBe(false);
    expect(await canAccessFile(members.editor.id, priv.id)).toBe(true);

    // xoá mềm nguồn → thành viên khác mất quyền
    await db.update(sources).set({ deletedAt: new Date() }).where(eqId(privSrc.id));
    expect(await canAccessFile(members.viewer.id, priv.id)).toBe(false);
  });
});

import { eq } from "drizzle-orm";
function eqId(id: string) {
  return eq(sources.id, id);
}
