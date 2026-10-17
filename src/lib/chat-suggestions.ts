import type { TFunction } from "@/lib/i18n";
import type { SourceDto } from "@/lib/sources";

export const MAX_SUGGESTIONS = 4;

/**
 * Câu hỏi gợi ý khi cuộc trò chuyện còn trống — dựng từ dữ liệu thật của các nguồn đang chọn
 * (chủ đề chính `key_topics`, tiêu đề, có tóm tắt hay chưa), không gọi AI.
 */
export function buildSuggestedQuestions(selected: Pick<SourceDto, "title" | "keyTopics" | "summary" | "status">[], t: TFunction): string[] {
  const ready = selected.filter((s) => s.status === "ready");
  if (ready.length === 0) return [];
  const out: string[] = [];
  const topics: string[] = [];
  for (const s of ready) for (const topic of s.keyTopics ?? []) if (topic.trim() && !topics.includes(topic.trim())) topics.push(topic.trim());

  if (ready.length === 1) out.push(t("chat.suggest.summarizeOne", { title: ready[0].title }));
  else out.push(t("chat.suggest.summarizeMany", { count: ready.length }));
  for (const topic of topics.slice(0, 2)) out.push(t("chat.suggest.topic", { topic }));
  if (ready.length > 1) out.push(t("chat.suggest.compare"));
  else if (topics.length > 2) out.push(t("chat.suggest.topic", { topic: topics[2] }));
  if (ready.some((s) => s.summary)) out.push(t("chat.suggest.keyPoints"));
  return [...new Set(out)].slice(0, MAX_SUGGESTIONS);
}
