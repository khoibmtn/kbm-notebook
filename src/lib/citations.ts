/**
 * Phân tích trích dẫn `[n]` trong câu trả lời AI (dùng chung server + client).
 * Hỗ trợ `[1]`, `[1, 3]`, `[2-4]`, `[1,2,5-7]`. Bỏ qua mã trong ``` … ``` / `…` và liên kết markdown `[1](url)`.
 */

/** Dấu `[...]` chỉ chứa số, dấu phẩy/chấm phẩy và khoảng `a-b`; không đứng trước `(` (liên kết markdown). */
const CITATION_SOURCE = String.raw`\[\s*(\d{1,4}(?:\s*[-–—]\s*\d{1,4})?(?:\s*[,;]\s*\d{1,4}(?:\s*[-–—]\s*\d{1,4})?)*)\s*\](?!\()`;
/** Số phần tử tối đa khi mở rộng một khoảng `a-b` (chặn `[1-99999]`). */
const MAX_RANGE = 100;

export type CitationToken = {
  /** Vị trí trong chuỗi gốc. */
  start: number;
  end: number;
  raw: string;
  /** Các số đã mở rộng, đã khử trùng lặp, giữ thứ tự xuất hiện. */
  numbers: number[];
};

/** `"1, 3-5"` → `[1, 3, 4, 5]`. Khoảng ngược (`5-3`) hoặc quá lớn được tách thành hai số riêng để bước hậu kiểm tự loại nếu sai. */
export function parseCitationNumbers(inner: string): number[] {
  const out: number[] = [];
  for (const part of inner.split(/[,;]/)) {
    const m = /^\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    if (m[2] === undefined) {
      out.push(a);
      continue;
    }
    const b = Number(m[2]);
    if (b < a || b - a >= MAX_RANGE) {
      out.push(a, b);
      continue;
    }
    for (let n = a; n <= b; n++) out.push(n);
  }
  return [...new Set(out)];
}

/** Các đoạn nằm trong code fence / inline code (không được đụng tới). */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const re = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

export function findCitations(text: string): CitationToken[] {
  const code = codeRanges(text);
  const tokens: CitationToken[] = [];
  const re = new RegExp(CITATION_SOURCE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    if (code.some(([s, e]) => start >= s && start < e)) continue;
    tokens.push({ start, end: start + m[0].length, raw: m[0], numbers: parseCitationNumbers(m[1]) });
  }
  return tokens;
}

/** Dấu `[d.d]` / `[d.d.d]` (số mục/phần của tài liệu, vd `[5.1]`): không phải trích dẫn hợp lệ; không đứng trước `(`. */
const DECIMAL_TOKEN_SOURCE = String.raw`\[\s*\d{1,4}(?:\s*\.\s*\d{1,4}){1,2}\s*\](?!\()`;

/** Xoá token thập phân `[5.1]` (ngoài code) cùng khoảng trắng đứng trước. Không bao giờ được coi là `[n]` hợp lệ. */
function removeDecimalTokens(text: string): string {
  if (!text.includes("[")) return text;
  const code = codeRanges(text);
  const re = new RegExp(DECIMAL_TOKEN_SOURCE, "g");
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    if (code.some(([s, e]) => start >= s && start < e)) continue;
    out += text.slice(cursor, start).replace(/[ \t]+$/, "");
    cursor = start + m[0].length;
  }
  return out + text.slice(cursor);
}

export type SanitizedCitations = {
  /** Văn bản đã bỏ trích dẫn không hợp lệ. */
  text: string;
  /** Số trích dẫn hợp lệ thực sự được dùng (tăng dần, không trùng). */
  used: number[];
  /** Số không hợp lệ đã bị loại (tăng dần, không trùng). */
  removed: number[];
};

/** Giữ `[n]` có 1 ≤ n ≤ maxN, bỏ phần còn lại (kể cả `[5.1]`); dấu `[...]` rỗng sau khi lọc bị xoá cùng khoảng trắng đứng trước nó. */
export function sanitizeCitations(input: string, maxN: number): SanitizedCitations {
  const text = removeDecimalTokens(input);
  const used = new Set<number>();
  const removed = new Set<number>();
  let out = "";
  let cursor = 0;
  for (const tok of findCitations(text)) {
    const valid = tok.numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= maxN);
    for (const n of tok.numbers) if (!valid.includes(n)) removed.add(n);
    for (const n of valid) used.add(n);
    let before = text.slice(cursor, tok.start);
    let replacement: string;
    if (valid.length === tok.numbers.length) replacement = tok.raw;
    else if (valid.length === 0) {
      replacement = "";
      before = before.replace(/[ \t]+$/, ""); // "…câu [9]." → "…câu."
    } else replacement = `[${valid.join(", ")}]`;
    out += before + replacement;
    cursor = tok.end;
  }
  out += text.slice(cursor);
  const sort = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { text: out, used: sort(used), removed: sort(removed) };
}

/** Xoá mọi `[n]` (dùng để gửi lịch sử hội thoại cho model mà không lẫn đánh số của lượt trước). */
export function stripCitations(input: string): string {
  const text = removeDecimalTokens(input);
  let out = "";
  let cursor = 0;
  for (const tok of findCitations(text)) {
    out += text.slice(cursor, tok.start).replace(/[ \t]+$/, "");
    cursor = tok.end;
  }
  return out + text.slice(cursor);
}

/** Câu mẫu mô hình phải dùng khi bằng chứng không đủ (hậu kiểm nhận ra để gắn `insufficientEvidence`). */
export const NOT_FOUND_SENTINEL = "Không tìm thấy thông tin này trong các nguồn đã chọn";

function normalize(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
}

export function containsNotFoundSentinel(text: string): boolean {
  return normalize(text).includes(normalize(NOT_FOUND_SENTINEL));
}
