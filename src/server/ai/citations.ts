import "server-only";
import {
  containsNotFoundSentinel,
  sanitizeCitations,
} from "@/lib/citations";
import { INSUFFICIENT_SIMILARITY_THRESHOLD, type SourceUsed } from "@/lib/chat";
import type { Evidence } from "@/server/knowledge/providers/types";
import { describeLocator } from "./context";

export { INSUFFICIENT_SIMILARITY_THRESHOLD };
export { findCitations, parseCitationNumbers, sanitizeCitations, stripCitations, containsNotFoundSentinel, NOT_FOUND_SENTINEL } from "@/lib/citations";

/** Loại bằng chứng "đoạn trích" (mặc định): khác với câu trả lời tổng hợp của kho ngoài và kết quả web. */
const isChunk = (e: Evidence) => (e.kind ?? "chunk") === "chunk";

/**
 * "Thiếu bằng chứng" theo độ tương đồng (docs/02 §3.3): không có bằng chứng nào, hoặc độ tương đồng cosine tốt nhất
 * của các ĐOẠN TRÍCH (kind = chunk) có similarity < ngưỡng. Chỉ tính trên các đoạn có similarity; kết quả web và
 * câu trả lời tổng hợp của kho ngoài (`external_answer`) KHÔNG làm tắt cảnh báo. Nếu không đoạn nào có similarity
 * (vd. chỉ kết quả web) thì không đủ cơ sở để kết luận thiếu theo ngưỡng.
 */
export function isInsufficientEvidence(evidence: Evidence[], threshold = INSUFFICIENT_SIMILARITY_THRESHOLD): boolean {
  if (evidence.length === 0) return true;
  const scored = evidence.filter((e) => isChunk(e) && e.similarity !== undefined);
  if (scored.length === 0) return false;
  return Math.max(...scored.map((e) => e.similarity as number)) < threshold;
}

/**
 * Lý do cảnh báo (null = đủ): `no_evidence` (không có bằng chứng) · `not_found` (mô hình tự nói không tìm thấy) ·
 * `low_similarity` (đoạn trích tốt nhất dưới ngưỡng) · `no_citations` (có bằng chứng nhưng câu trả lời không có [n] hợp lệ nào).
 */
export type InsufficientReason = "no_evidence" | "not_found" | "low_similarity" | "no_citations";

export function insufficientReasonFor(
  content: string,
  evidence: Evidence[],
  usedNumbers: number[],
  threshold = INSUFFICIENT_SIMILARITY_THRESHOLD,
): InsufficientReason | null {
  if (evidence.length === 0) return "no_evidence";
  if (containsNotFoundSentinel(content)) return "not_found";
  if (isInsufficientEvidence(evidence, threshold)) return "low_similarity";
  if (usedNumbers.length === 0) return "no_citations";
  return null;
}

function sourceKey(ev: Evidence): string {
  // Kết nối ngoài: id nguồn chỉ duy nhất trong từng kết nối.
  if (ev.connectionId) return `${ev.provider}:${ev.connectionId}:${ev.kind === "external_answer" ? "answer" : (ev.sourceId ?? ev.id)}`;
  if (ev.sourceId) return `${ev.provider}:${ev.sourceId}`;
  if (ev.locator.url) return `${ev.provider}:${ev.locator.url}`;
  return `${ev.provider}:${ev.id}`;
}

/** Nguồn thực sự được trích (theo các số `used`), khử trùng theo nguồn và giữ thứ tự xuất hiện đầu tiên. */
export function buildSourcesUsed(evidence: Evidence[], used: number[]): SourceUsed[] {
  const byKey = new Map<string, SourceUsed>();
  for (const n of used) {
    const ev = evidence[n - 1];
    if (!ev) continue;
    const key = sourceKey(ev);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, sourceId: ev.sourceId, provider: ev.provider, title: ev.sourceTitle, locators: [], numbers: [] };
      if (ev.locator.url) entry.url = ev.locator.url;
      else if (ev.externalUrl) entry.url = ev.externalUrl;
      byKey.set(key, entry);
    }
    entry.numbers.push(n);
    const where = describeLocator({ ...ev.locator, url: undefined });
    if (where && !entry.locators.includes(where)) entry.locators.push(where);
  }
  return [...byKey.values()];
}

export type PostCheckResult = {
  /** Câu trả lời đã loại `[n]` không hợp lệ. */
  content: string;
  /** Toàn bộ bằng chứng đã đánh số (phần tử i ↔ `[i+1]`). */
  citations: Evidence[];
  usedNumbers: number[];
  removedNumbers: number[];
  sourcesUsed: SourceUsed[];
  insufficientEvidence: boolean;
  insufficientReason: InsufficientReason | null;
};

/**
 * Hậu kiểm câu trả lời (docs/02 §3.3 bước 4): chỉ giữ `[n]` có trong danh sách bằng chứng, tính `sourcesUsed`
 * và `insufficientEvidence` (không có bằng chứng / similarity thấp / mô hình tự nói "không tìm thấy").
 */
export function postCheckAnswer(rawAnswer: string, evidence: Evidence[]): PostCheckResult {
  const sanitized = sanitizeCitations(rawAnswer, evidence.length);
  const content = sanitized.text.trim();
  const reason = insufficientReasonFor(content, evidence, sanitized.used);
  return {
    content,
    citations: evidence,
    usedNumbers: sanitized.used,
    removedNumbers: sanitized.removed,
    sourcesUsed: buildSourcesUsed(evidence, sanitized.used),
    insufficientEvidence: reason !== null,
    insufficientReason: reason,
  };
}
