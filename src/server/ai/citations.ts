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

/**
 * "Thiếu bằng chứng" (docs/02 §3.3): không có bằng chứng nào, hoặc độ tương đồng tốt nhất < ngưỡng.
 * Ngưỡng chỉ áp dụng khi mọi bằng chứng đều có `similarity` (cosine); đoạn chỉ khớp từ khoá hoặc
 * kết quả web không có độ tương đồng vector nên được coi là có liên quan.
 */
export function isInsufficientEvidence(evidence: Evidence[], threshold = INSUFFICIENT_SIMILARITY_THRESHOLD): boolean {
  if (evidence.length === 0) return true;
  if (!evidence.every((e) => e.similarity !== undefined)) return false;
  return Math.max(...evidence.map((e) => e.similarity as number)) < threshold;
}

function sourceKey(ev: Evidence): string {
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
};

/**
 * Hậu kiểm câu trả lời (docs/02 §3.3 bước 4): chỉ giữ `[n]` có trong danh sách bằng chứng, tính `sourcesUsed`
 * và `insufficientEvidence` (không có bằng chứng / similarity thấp / mô hình tự nói "không tìm thấy").
 */
export function postCheckAnswer(rawAnswer: string, evidence: Evidence[]): PostCheckResult {
  const sanitized = sanitizeCitations(rawAnswer, evidence.length);
  const content = sanitized.text.trim();
  return {
    content,
    citations: evidence,
    usedNumbers: sanitized.used,
    removedNumbers: sanitized.removed,
    sourcesUsed: buildSourcesUsed(evidence, sanitized.used),
    insufficientEvidence: isInsufficientEvidence(evidence) || containsNotFoundSentinel(content),
  };
}
