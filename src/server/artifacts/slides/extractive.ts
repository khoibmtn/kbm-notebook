import type { Evidence } from "@/server/knowledge/providers/types";
import { newId } from "./sources";
import { DEFAULT_THEME, type Slide, type SlideDeckContent } from "./types";

/**
 * Bộ slide "trích xuất" xác định từ bằng chứng — CHỈ dùng khi provider là mock (không có mô hình thật)
 * để luồng Studio vẫn chạy đầu-cuối trong test/e2e. Không bịa nội dung: mọi chữ đều cắt từ bằng chứng.
 */

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function clip(text: string, maxWords: number): string {
  const words = text.replace(/[.;:,]+$/g, "").split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? words.join(" ") : words.slice(0, maxWords).join(" ") + "…";
}

export function buildExtractiveDeck(input: {
  evidence: Evidence[];
  contextText: string;
  slideCount?: number | "auto";
}): SlideDeckContent {
  const evidence = input.evidence;
  const units: { title: string; text: string; cite?: number }[] =
    evidence.length > 0
      ? evidence.map((e, i) => ({ title: e.sourceTitle, text: e.text, cite: i + 1 }))
      : input.contextText
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, i) => ({ title: `Phần ${i + 1}`, text: p }));

  const body = input.slideCount && input.slideCount !== "auto" ? Math.max(1, input.slideCount - 2) : Math.min(units.length, 10);
  const slides: Slide[] = [];
  const deckTitle = units[0]?.title ?? "Bài thuyết trình";
  slides.push({
    id: newId(),
    layout: "title",
    title: clip(deckTitle, 9),
    subtitle: evidence.length > 0 ? `Tổng hợp từ ${new Set(evidence.map((e) => e.sourceTitle)).size} nguồn` : undefined,
  });
  for (const u of units.slice(0, body)) {
    const sents = sentences(u.text);
    slides.push({
      id: newId(),
      layout: "title_bullets",
      title: clip(sents[0] ?? u.title, 9),
      bullets: sents.slice(0, 4).map((s) => clip(s, 12)),
      notes: sents.slice(0, 3).join(" "),
      citations: u.cite ? [u.cite] : undefined,
    });
  }
  slides.push({
    id: newId(),
    layout: "closing",
    title: "Tổng kết",
    bullets: slides.slice(1).slice(0, 4).map((s) => s.title),
  });
  return { theme: { ...DEFAULT_THEME }, slides, evidence };
}
