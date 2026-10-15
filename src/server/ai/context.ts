import "server-only";
import { estimateTokens } from "@/lib/sources";
import type { Evidence, EvidenceLocator } from "@/server/knowledge/providers/types";

/** Ngân sách token mặc định cho phần ngữ cảnh bằng chứng (docs/02 §3.3). */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 24_000;
/** Phần còn lại nhỏ hơn mức này thì bỏ luôn thay vì cắt cụt đoạn cuối. */
const MIN_TRUNCATED_TOKENS = 120;

export type BuiltContext = {
  /** Bằng chứng được giữ lại theo thứ tự; phần tử thứ i được trích dẫn là `[i+1]`. Đoạn cuối có thể đã bị cắt ngắn. */
  evidence: Evidence[];
  /** Văn bản ngữ cảnh đã đánh số `[1..n]` để đưa vào prompt. */
  contextText: string;
};

/** "trang 3", "slide 5", "mục Giới thiệu", URL… */
export function describeLocator(loc: EvidenceLocator): string {
  const parts: string[] = [];
  if (loc.page != null) parts.push(`trang ${loc.page}`);
  if (loc.slide != null) parts.push(`slide ${loc.slide}`);
  if (loc.section) parts.push(`mục "${loc.section}"`);
  if (loc.url) parts.push(loc.url);
  return parts.join(", ");
}

function header(n: number, ev: Evidence): string {
  const where = describeLocator(ev.locator);
  return `[${n}] Nguồn: "${ev.sourceTitle}"${where ? ` (${where})` : ""}`;
}

/** Cắt `text` còn ≤ maxChars, ưu tiên điểm kết thúc câu/dòng/từ gần nhất. */
function truncateAt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > maxChars * 0.5) return cut.slice(0, sentence + 1).trimEnd() + " …";
  const space = cut.lastIndexOf(" ");
  return (space > maxChars * 0.5 ? cut.slice(0, space) : cut).trimEnd() + " …";
}

/**
 * Đánh số bằng chứng [1..n], cắt theo ngân sách token (≈ ký tự/4) và dựng văn bản ngữ cảnh cho prompt.
 * Giữ thứ tự đầu vào (đã xếp theo độ liên quan); dừng khi hết ngân sách. Đoạn cuối được cắt ngắn nếu còn đủ chỗ.
 * Chỉ các `[n]` có trong `evidence` trả về mới hợp lệ cho bước hậu kiểm trích dẫn.
 */
export function buildContext(
  evidence: Evidence[],
  opts: { tokenBudget?: number } = {},
): BuiltContext {
  const budget = opts.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
  const kept: Evidence[] = [];
  const blocks: string[] = [];
  let used = 0;
  for (const ev of evidence) {
    const head = header(kept.length + 1, ev);
    const overhead = estimateTokens(head) + 2;
    const fullCost = overhead + estimateTokens(ev.text);
    if (used + fullCost <= budget) {
      kept.push(ev);
      blocks.push(`${head}\n${ev.text}`);
      used += fullCost;
      continue;
    }
    const remaining = budget - used - overhead;
    if (remaining >= MIN_TRUNCATED_TOKENS) {
      const text = truncateAt(ev.text, remaining * 4);
      kept.push({ ...ev, text });
      blocks.push(`${head}\n${text}`);
    }
    break;
  }
  return { evidence: kept, contextText: blocks.join("\n\n") };
}
