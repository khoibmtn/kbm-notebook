import "server-only";
import { JSDOM, VirtualConsole } from "jsdom";
import JSZip from "jszip";
import mammoth from "mammoth";
import { Readability } from "@mozilla/readability";
import * as XLSX from "xlsx";
import type { SourceFileType, SourcePageUnit } from "@/lib/sources";
import { normalizeText, type Segment } from "./chunk";
import { IngestError } from "./errors";
import { safeFetch } from "./ssrf";

export type Extracted = {
  segments: Segment[];
  /** Tiêu đề phát hiện được (trang web, tài liệu). */
  title?: string;
  /** Số trang / slide / sheet nếu áp dụng. */
  pageCount: number | null;
  unit: SourcePageUnit | null;
};

/** PDF có ít hơn ngần này ký tự (không tính khoảng trắng) → coi là bản scan, không có lớp văn bản. */
const MIN_PDF_TEXT_CHARS = 50;
export const NO_TEXT_LAYER_MESSAGE = "PDF không có lớp văn bản (cần OCR)";

/* -------------------------------------------------------------------------- */
/* Tiện ích chuyển HTML / XML → văn bản                                        */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  copy: "©",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

/** HTML (một đoạn không chứa heading) → văn bản giữ xuống dòng theo khối, bảng dùng " | ". */
function htmlFragmentToText(html: string): string {
  const withBreaks = html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(p|div|li|tr|blockquote|section|article|pre|ul|ol|table|figure|figcaption|dd|dt|header|footer)>/gi, "\n")
    .replace(/<(p|div|tr|blockquote|pre|table|section|article)\b[^>]*>/gi, "\n");
  return stripTags(withBreaks)
    .split("\n")
    .map((line) => line.replace(/\s+\|\s*$/, "").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * HTML → segments, tách theo heading h1–h3 (mỗi mục có `section` = tiêu đề heading).
 */
export function htmlToSegments(html: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let last = 0;
  let current: { section?: string; parts: string[] } = { parts: [] };
  const flush = () => {
    const text = normalizeText(current.parts.join("\n"));
    if (text) segments.push({ text, section: current.section });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    current.parts.push(htmlFragmentToText(html.slice(last, m.index)));
    flush();
    const heading = normalizeText(stripTags(m[2]).replace(/\s+/g, " "));
    current = { section: heading || undefined, parts: [heading] };
    last = m.index + m[0].length;
  }
  current.parts.push(htmlFragmentToText(html.slice(last)));
  flush();
  return segments;
}

/* -------------------------------------------------------------------------- */
/* Văn bản thuần: txt / md / json                                              */
/* -------------------------------------------------------------------------- */

export function decodeText(buf: Buffer): string {
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    // Tệp tiếng Việt cũ thường dùng bảng mã Windows-1258
    return new TextDecoder("windows-1258").decode(body);
  }
}

/** Markdown → segments theo heading (#, ##, ###), bỏ qua heading nằm trong khối code. */
export function markdownToSegments(md: string): Segment[] {
  const segments: Segment[] = [];
  let current: { section?: string; lines: string[] } = { lines: [] };
  let inFence = false;
  const flush = () => {
    const text = normalizeText(current.lines.join("\n"));
    if (text) segments.push({ text, section: current.section });
  };
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence ? line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/) : null;
    if (h) {
      flush();
      current = { section: h[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return segments;
}

function extractPlainLike(buf: Buffer, type: "txt" | "md" | "json"): Extracted {
  const text = decodeText(buf);
  if (type === "md") return { segments: markdownToSegments(text), pageCount: null, unit: null };
  if (type === "json") {
    try {
      return { segments: [{ text: JSON.stringify(JSON.parse(text), null, 2) }], pageCount: null, unit: null };
    } catch {
      throw new IngestError("Tệp JSON không hợp lệ");
    }
  }
  return { segments: [{ text }], pageCount: null, unit: null };
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                         */
/* -------------------------------------------------------------------------- */

async function extractPdf(buf: Buffer): Promise<Extracted> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let totalPages = 0;
  let pages: string[] = [];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const res = await extractText(pdf, { mergePages: false });
    totalPages = res.totalPages;
    pages = res.text;
    await pdf.cleanup();
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "PasswordException") throw new IngestError("PDF được bảo vệ bằng mật khẩu", { cause: err });
    throw new IngestError("Không đọc được tệp PDF (tệp hỏng hoặc không hợp lệ)", { cause: err });
  }
  const segments: Segment[] = pages.map((text, i) => ({ text, page: i + 1 }));
  const chars = pages.reduce((n, p) => n + p.replace(/\s+/g, "").length, 0);
  if (chars < MIN_PDF_TEXT_CHARS) throw new IngestError(NO_TEXT_LAYER_MESSAGE);
  return { segments, pageCount: totalPages, unit: "page" };
}

/* -------------------------------------------------------------------------- */
/* DOCX                                                                        */
/* -------------------------------------------------------------------------- */

async function extractDocx(buf: Buffer): Promise<Extracted> {
  try {
    const { value } = await mammoth.convertToHtml({ buffer: buf });
    return { segments: htmlToSegments(value), pageCount: null, unit: null };
  } catch (err) {
    throw new IngestError("Không đọc được tệp DOCX (tệp hỏng hoặc không hợp lệ)", { cause: err });
  }
}

/* -------------------------------------------------------------------------- */
/* PPTX                                                                        */
/* -------------------------------------------------------------------------- */

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function resolveSlidePath(target: string): string {
  const t = target.replace(/^\/+/, "");
  return t.startsWith("ppt/") ? t : `ppt/${t}`;
}

export function slideXmlToText(xml: string): { title?: string; text: string } {
  const lines: string[] = [];
  let title: string | undefined;
  const shapes = xml.match(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g) ?? [];
  for (const shape of shapes) {
    const isTitle = /<p:ph\b[^>]*\btype="(title|ctrTitle)"/.test(shape);
    const paras = shape.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
    const shapeLines: string[] = [];
    for (const p of paras) {
      let text = "";
      for (const tok of p.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/?>/g)) text += tok[1] ?? "\n";
      const clean = decodeEntities(text).replace(/[ \t]+/g, " ").trim();
      if (clean) shapeLines.push(clean);
    }
    if (isTitle && !title && shapeLines.length) title = shapeLines.join(" ");
    lines.push(...shapeLines);
  }
  return { title, text: lines.join("\n") };
}

async function extractPptx(buf: Buffer): Promise<Extracted> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    throw new IngestError("Không đọc được tệp PPTX (tệp hỏng hoặc không hợp lệ)", { cause: err });
  }
  // Thứ tự slide theo presentation.xml (tên tệp slideN.xml không nhất thiết là thứ tự trình chiếu)
  let paths: string[] = [];
  try {
    const pres = await zip.file("ppt/presentation.xml")?.async("string");
    const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
    if (pres && rels) {
      const relMap = new Map<string, string>();
      for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
        const id = attr(tag, "Id");
        const target = attr(tag, "Target");
        if (id && target) relMap.set(id, resolveSlidePath(target));
      }
      for (const tag of pres.match(/<p:sldId\b[^>]*>/g) ?? []) {
        const rid = attr(tag, "r:id");
        const p = rid ? relMap.get(rid) : undefined;
        if (p && zip.file(p)) paths.push(p);
      }
    }
  } catch {
    paths = [];
  }
  if (paths.length === 0) {
    paths = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  }
  if (paths.length === 0) throw new IngestError("Tệp PPTX không có slide nào");
  const segments: Segment[] = [];
  for (let i = 0; i < paths.length; i++) {
    const xml = await zip.file(paths[i])!.async("string");
    const { title, text } = slideXmlToText(xml);
    segments.push({ text, slide: i + 1, section: title });
  }
  return { segments, pageCount: paths.length, unit: "slide" };
}

/* -------------------------------------------------------------------------- */
/* XLSX / CSV                                                                  */
/* -------------------------------------------------------------------------- */

function looksLikeHeader(row: string[], rest: string[][]): boolean {
  if (rest.length === 0 || row.length < 2) return false;
  const cells = row.map((c) => c.trim());
  if (cells.some((c) => c === "")) return false;
  if (cells.some((c) => /^[-+]?[\d.,%\s]+$/.test(c))) return false;
  return new Set(cells).size === cells.length;
}

export function sheetRowsToLines(rows: string[][]): string[] {
  const cleaned = rows.map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()));
  if (cleaned.length === 0) return [];
  const [first, ...rest] = cleaned;
  if (looksLikeHeader(first, rest)) {
    return rest
      .map((r) =>
        first
          .map((h, i) => (r[i] ? `${h}: ${r[i]}` : ""))
          .filter(Boolean)
          .join("; "),
      )
      .filter(Boolean);
  }
  return cleaned.map((r) => r.filter((c) => c !== "").join(" | ")).filter(Boolean);
}

function extractSheets(buf: Buffer, type: "xlsx" | "csv"): Extracted {
  let wb: XLSX.WorkBook;
  try {
    wb = type === "csv" ? XLSX.read(decodeText(buf), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
  } catch (err) {
    throw new IngestError("Không đọc được bảng tính (tệp hỏng hoặc không hợp lệ)", { cause: err });
  }
  const segments: Segment[] = [];
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", blankrows: false });
    const lines = sheetRowsToLines(rows);
    segments.push({ text: lines.join("\n"), page: i + 1, section: name });
  });
  return { segments, pageCount: wb.SheetNames.length, unit: "sheet" };
}

/* -------------------------------------------------------------------------- */
/* HTML (tệp .html và URL)                                                     */
/* -------------------------------------------------------------------------- */

export function extractHtml(html: string, baseUrl = "https://example.invalid/"): Extracted {
  const virtualConsole = new VirtualConsole(); // im lặng lỗi CSS/script của trang
  const dom = new JSDOM(html, { url: baseUrl, virtualConsole });
  try {
    const doc = dom.window.document;
    const docTitle = doc.title?.trim() || undefined;
    const article = new Readability(doc.cloneNode(true) as unknown as Document).parse();
    if (article?.content) {
      const segments = htmlToSegments(article.content);
      if (segments.length > 0) return { segments, title: article.title?.trim() || docTitle, pageCount: null, unit: null };
    }
    const bodyHtml = doc.body?.innerHTML ?? "";
    return { segments: htmlToSegments(bodyHtml), title: docTitle, pageCount: null, unit: null };
  } finally {
    dom.window.close();
  }
}

/* -------------------------------------------------------------------------- */
/* API công khai                                                               */
/* -------------------------------------------------------------------------- */

function assertHasText(res: Extracted): Extracted {
  const total = res.segments.reduce((n, s) => n + s.text.replace(/\s+/g, "").length, 0);
  if (total === 0) throw new IngestError("Không trích xuất được nội dung văn bản từ nguồn này");
  return res;
}

/** Trích văn bản từ nội dung tệp theo loại đã xác định. */
export async function extractFile(buf: Buffer, type: SourceFileType): Promise<Extracted> {
  switch (type) {
    case "pdf":
      return assertHasText(await extractPdf(buf));
    case "docx":
      return assertHasText(await extractDocx(buf));
    case "pptx":
      return assertHasText(await extractPptx(buf));
    case "xlsx":
    case "csv":
      return assertHasText(extractSheets(buf, type));
    case "html":
      return assertHasText(extractHtml(decodeText(buf)));
    case "md":
    case "txt":
    case "json":
      return assertHasText(extractPlainLike(buf, type));
  }
}

/** Văn bản dán trực tiếp. */
export function extractPastedText(text: string): Extracted {
  return assertHasText({ segments: [{ text }], pageCount: null, unit: null });
}

/** Tải URL (có chặn SSRF) rồi trích văn bản theo Content-Type. */
export async function extractUrl(url: string): Promise<Extracted & { finalUrl: string }> {
  const page = await safeFetch(url);
  const ct = page.contentType.toLowerCase().split(";")[0].trim();
  let result: Extracted;
  if (ct === "application/pdf") {
    result = await extractPdf(page.body);
  } else if (ct === "text/html" || ct === "application/xhtml+xml" || ct === "") {
    result = extractHtml(decodeText(page.body), page.finalUrl);
  } else if (ct === "application/json" || ct.endsWith("+json")) {
    result = extractPlainLike(page.body, "json");
  } else if (ct === "text/markdown") {
    result = extractPlainLike(page.body, "md");
  } else if (ct.startsWith("text/")) {
    result = extractPlainLike(page.body, "txt");
  } else {
    throw new IngestError(`Loại nội dung "${ct}" chưa được hỗ trợ`);
  }
  return { ...assertHasText(result), finalUrl: page.finalUrl };
}

