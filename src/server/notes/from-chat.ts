import "server-only";
import { sanitizeCitations } from "@/lib/citations";
import { describeLocator } from "@/server/ai/context";
import type { Evidence } from "@/server/knowledge/providers/types";

export const NOTE_SOURCES_HEADING = "Nguồn";

/**
 * Markdown của ghi chú tạo từ câu trả lời AI: giữ nguyên `[n]` trong thân bài và thêm danh sách
 * nguồn kiểu chú thích ở cuối (`- [n] Tiêu đề — vị trí`), chỉ gồm các `[n]` thực sự xuất hiện và hợp lệ.
 */
export function answerToNoteMarkdown(content: string, evidence: Evidence[]): string {
  const { text, used } = sanitizeCitations(content.trim(), evidence.length);
  if (used.length === 0) return text;
  const lines = used.map((n) => {
    const ev = evidence[n - 1];
    const where = describeLocator({ ...ev.locator, url: undefined });
    const url = ev.locator.url ? ` (${ev.locator.url})` : "";
    return `- [${n}] ${ev.sourceTitle}${where ? ` — ${where}` : ""}${url}`;
  });
  return `${text}\n\n---\n\n**${NOTE_SOURCES_HEADING}**\n\n${lines.join("\n")}\n`;
}
