import "server-only";
import { JSDOM, VirtualConsole } from "jsdom";
import JSZip from "jszip";
import mammoth from "mammoth";
import { Readability } from "@mozilla/readability";
import { XMLParser } from "fast-xml-parser";
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

function resolveSlidePath(target: string): string {
  const t = target.replace(/^\/+/, "");
  return t.startsWith("ppt/") ? t : `ppt/${t}`;
}

/**
 * Parser XML thật (không regex): giới hạn độ sâu thẻ lồng nhau và số entity nên XML độc hại
 * (hàng triệu thẻ mở không đóng, entity bomb) bị từ chối thay vì làm treo tiến trình.
 */
const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  htmlEntities: true,
  maxNestedTags: 64,
});

type XmlNode = { [key: string]: unknown };

function parseXml(xml: string): XmlNode[] {
  return xmlParser.parse(xml) as XmlNode[];
}

function tagOf(node: XmlNode): string | null {
  for (const key of Object.keys(node)) if (key !== ":@" && key !== "#text") return key;
  return null;
}

function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  const v = tag ? node[tag] : null;
  return Array.isArray(v) ? (v as XmlNode[]) : [];
}

function attrOf(node: XmlNode, name: string): string | null {
  const a = node[":@"];
  if (a && typeof a === "object") {
    const v = (a as Record<string, unknown>)[`@_${name}`];
    return typeof v === "string" ? v : null;
  }
  return null;
}

/** Duyệt cây theo thứ tự văn bản; `visit` trả true để KHÔNG đi sâu vào nút đó. */
function walkXml(nodes: XmlNode[], visit: (tag: string, node: XmlNode) => boolean | void): void {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) continue;
    if (visit(tag, node) === true) continue;
    walkXml(childrenOf(node), visit);
  }
}

function paragraphText(p: XmlNode): string {
  let text = "";
  walkXml(childrenOf(p), (tag, node) => {
    if (tag === "a:br") text += "\n";
    else if (tag === "a:t") {
      for (const c of childrenOf(node)) if (typeof c["#text"] === "string") text += c["#text"];
      return true;
    }
  });
  return text;
}

export function slideXmlToText(xml: string): { title?: string; text: string } {
  const lines: string[] = [];
  let title: string | undefined;
  walkXml(parseXml(xml), (tag, shape) => {
    if (tag !== "p:sp" && tag !== "p:graphicFrame") return;
    let isTitle = false;
    const paras: XmlNode[] = [];
    walkXml(childrenOf(shape), (t, node) => {
      if (t === "p:ph") {
        const type = attrOf(node, "type");
        if (type === "title" || type === "ctrTitle") isTitle = true;
      } else if (t === "a:p") {
        paras.push(node);
        return true;
      }
    });
    const shapeLines: string[] = [];
    for (const p of paras) {
      const clean = paragraphText(p).replace(/[ \t]+/g, " ").trim();
      if (clean) shapeLines.push(clean);
    }
    if (isTitle && !title && shapeLines.length) title = shapeLines.join(" ");
    lines.push(...shapeLines);
    return true;
  });
  return { title, text: lines.join("\n") };
}

/** Số slide tối đa xử lý trong một tệp PPTX. */
export const MAX_PPTX_SLIDES = 2000;

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
      walkXml(parseXml(rels), (tag, node) => {
        if (tag !== "Relationship") return;
        const id = attrOf(node, "Id");
        const target = attrOf(node, "Target");
        if (id && target) relMap.set(id, resolveSlidePath(target));
        return true;
      });
      walkXml(parseXml(pres), (tag, node) => {
        if (tag !== "p:sldId") return;
        const rid = attrOf(node, "r:id");
        const p = rid ? relMap.get(rid) : undefined;
        if (p && zip.file(p)) paths.push(p);
        return true;
      });
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
  if (paths.length > MAX_PPTX_SLIDES) {
    throw new IngestError(`Tệp PPTX có quá nhiều slide (${paths.length}; tối đa ${MAX_PPTX_SLIDES})`);
  }
  const segments: Segment[] = [];
  for (let i = 0; i < paths.length; i++) {
    const xml = await zip.file(paths[i])!.async("string");
    let parsed: { title?: string; text: string };
    try {
      parsed = slideXmlToText(xml);
    } catch (err) {
      throw new IngestError(`Slide ${i + 1} của tệp PPTX không hợp lệ (XML hỏng hoặc quá phức tạp)`, { cause: err });
    }
    segments.push({ text: parsed.text, slide: i + 1, section: parsed.title });
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

/** Tổng số ô (vùng bao của dữ liệu thật) tối đa của một bảng tính trước khi chuyển thành văn bản. */
export const MAX_SHEET_CELLS = 500_000;

/**
 * `<dimension ref>` do tệp tự khai có thể là A1:XFD1048576 dù gần như trống; `sheet_to_json` lặp qua toàn bộ vùng đó.
 * Thu hẹp `!ref` về vùng có dữ liệu thật và trả về số ô của vùng ấy.
 */
function tightenSheetRef(ws: XLSX.WorkSheet): number {
  const declared = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  if (!declared) return 0;
  let maxR = -1;
  let maxC = -1;
  let populated = 0;
  for (const key in ws) {
    if (key.charCodeAt(0) === 33 /* "!" */) continue;
    if (++populated > MAX_SHEET_CELLS) break;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  if (populated > MAX_SHEET_CELLS) return populated;
  if (maxR < 0) {
    ws["!ref"] = undefined;
    return 0;
  }
  const end = { r: Math.min(maxR, declared.e.r), c: Math.min(maxC, declared.e.c) };
  ws["!ref"] = XLSX.utils.encode_range(declared.s, end);
  return Math.max(0, end.r - declared.s.r + 1) * Math.max(0, end.c - declared.s.c + 1);
}

function extractSheets(buf: Buffer, type: "xlsx" | "csv"): Extracted {
  let wb: XLSX.WorkBook;
  try {
    wb = type === "csv" ? XLSX.read(decodeText(buf), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
  } catch (err) {
    throw new IngestError("Không đọc được bảng tính (tệp hỏng hoặc không hợp lệ)", { cause: err });
  }
  // Kiểm tra TRƯỚC khi chuyển đổi: bảng quá lớn bị từ chối ngay, không lặp qua vùng khai báo.
  let totalCells = 0;
  for (const name of wb.SheetNames) {
    totalCells += tightenSheetRef(wb.Sheets[name]);
    if (totalCells > MAX_SHEET_CELLS) {
      throw new IngestError(
        `Bảng tính quá lớn (vượt ${MAX_SHEET_CELLS.toLocaleString("vi-VN")} ô). Hãy tách nhỏ tệp hoặc xuất các sheet cần thiết.`,
      );
    }
  }
  const segments: Segment[] = [];
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    const rows = ws["!ref"]
      ? XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", blankrows: false })
      : [];
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

/** Trang web/tệp đã tải về (sau safeFetch) → văn bản theo Content-Type. */
export async function extractFetchedPage(page: { contentType: string; finalUrl: string; body: Buffer }): Promise<Extracted & { finalUrl: string }> {
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

/** Tải URL (có chặn SSRF) rồi trích văn bản theo Content-Type. */
export async function extractUrl(url: string): Promise<Extracted & { finalUrl: string }> {
  return extractFetchedPage(await safeFetch(url));
}

/** Công việc trích xuất có thể chuyển sang worker thread (xem `extract-sandbox.ts`). */
export type ExtractJob =
  | { op: "file"; type: SourceFileType; data: Uint8Array }
  | { op: "page"; contentType: string; finalUrl: string; data: Uint8Array };

/** Thực thi một ExtractJob trong tiến trình hiện tại (worker thread gọi hàm này). */
export async function runExtractJob(job: ExtractJob): Promise<Extracted & { finalUrl?: string }> {
  const buf = Buffer.from(job.data.buffer, job.data.byteOffset, job.data.byteLength);
  if (job.op === "file") return extractFile(buf, job.type);
  return extractFetchedPage({ contentType: job.contentType, finalUrl: job.finalUrl, body: buf });
}
