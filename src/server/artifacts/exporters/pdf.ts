import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { BrowserUnavailableError, withPage } from "./browser";
import { markdownToDocx } from "./docx";
import { renderDocumentHtml } from "./html";

const execFileAsync = promisify(execFile);

export type PdfResult = { buffer: Buffer; engine: "chromium" | "libreoffice" };

/** Markdown → PDF bằng Chromium (`page.pdf`). */
export async function markdownToPdfChromium(markdown: string, title: string): Promise<Buffer> {
  const html = renderDocumentHtml(markdown, title);
  return withPage(async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
    return Buffer.from(pdf);
  });
}

/**
 * HTML đã dựng sẵn (slide deck / infographic) → PDF bằng Chromium. Kích thước trang lấy từ `@page` trong HTML
 * (`preferCSSPageSize`), nền in đủ màu. Ảnh phải nhúng sẵn dạng `data:` (Chromium bị chặn mạng khi xuất).
 */
export async function htmlToPdfChromium(html: string): Promise<Buffer> {
  return withPage(async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    return Buffer.from(pdf);
  });
}

/** DOCX → PDF bằng LibreOffice (`soffice --headless --convert-to pdf`), dùng khi không có Chromium. */
export async function docxToPdfLibreOffice(docx: Buffer, name = "document"): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kbm-pdf-"));
  try {
    const input = path.join(dir, `${name.replace(/[^a-zA-Z0-9_-]+/g, "_") || "document"}.docx`);
    await writeFile(input, docx);
    await execFileAsync(
      "soffice",
      ["--headless", "--norestore", `-env:UserInstallation=file://${path.join(dir, "profile")}`, "--convert-to", "pdf", "--outdir", dir, input],
      { timeout: 120_000 },
    );
    return await readFile(input.replace(/\.docx$/, ".pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Markdown → PDF: Chromium trước, LibreOffice (qua DOCX) làm dự phòng khi Chromium không chạy được. */
export async function markdownToPdf(markdown: string, title: string): Promise<PdfResult> {
  try {
    return { buffer: await markdownToPdfChromium(markdown, title), engine: "chromium" };
  } catch (err) {
    if (!(err instanceof BrowserUnavailableError)) throw err;
    const docx = await markdownToDocx(markdown, { title });
    return { buffer: await docxToPdfLibreOffice(docx, title), engine: "libreoffice" };
  }
}
