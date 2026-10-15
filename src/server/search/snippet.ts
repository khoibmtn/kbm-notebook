import { HL_END, HL_START } from "@/lib/community";

/** Tách các từ khoá tìm kiếm (chữ/số Unicode), bỏ trùng, dài trước. */
export function searchTerms(q: string): string[] {
  const seen = new Set<string>();
  for (const m of q.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) seen.add(m[0]);
  return [...seen].sort((a, b) => b.length - a.length);
}

/**
 * Chuỗi `to_tsquery('simple', …)` an toàn: mỗi từ là tiền tố (`từ:*`), nối bằng `&`.
 * Chỉ giữ chữ/số Unicode nên không thể chèn cú pháp tsquery. Trả null nếu không còn từ nào.
 */
export function buildTsQuery(q: string): string | null {
  const terms = searchTerms(q).slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Đoạn trích quanh lần khớp đầu tiên, các từ khớp được bao bằng `HL_START`/`HL_END`
 * (client dựng `<mark>`; không bao giờ chèn HTML). Không có từ nào khớp → đầu văn bản.
 */
export function makeSnippet(text: string | null | undefined, q: string, opts: { before?: number; length?: number } = {}): string | null {
  if (!text) return null;
  const before = opts.before ?? 50;
  const length = opts.length ?? 180;
  const clean = text.replaceAll(HL_START, "").replaceAll(HL_END, "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const terms = searchTerms(q);
  const re = terms.length ? new RegExp(terms.map(escapeRe).join("|"), "giu") : null;
  const first = re ? clean.search(re) : -1;
  let start = first > before ? first - before : 0;
  if (start > 0) {
    const space = clean.indexOf(" ", start);
    if (space !== -1 && space - start < 20) start = space + 1;
  }
  let end = Math.min(clean.length, start + length);
  if (end < clean.length) {
    const space = clean.lastIndexOf(" ", end);
    if (space > start + length / 2) end = space;
  }
  let piece = clean.slice(start, end);
  if (re) piece = piece.replace(re, (m) => `${HL_START}${m}${HL_END}`);
  return `${start > 0 ? "…" : ""}${piece}${end < clean.length ? "…" : ""}`;
}

/** Đánh dấu từ khớp trong một chuỗi ngắn (tiêu đề). */
export function highlightTitle(title: string, q: string): string {
  const terms = searchTerms(q);
  if (terms.length === 0) return title;
  const clean = title.replaceAll(HL_START, "").replaceAll(HL_END, "");
  return clean.replace(new RegExp(terms.map(escapeRe).join("|"), "giu"), (m) => `${HL_START}${m}${HL_END}`);
}
