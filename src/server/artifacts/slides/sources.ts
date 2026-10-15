import { t, type Locale } from "@/lib/i18n";
import type { Evidence, EvidenceLocator } from "@/server/knowledge/providers/types";
import type { Slide, SlideDeckContent } from "./types";

export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** "trang 3", "slide 5", "mục …", URL — dùng cho slide Nguồn. */
export function describeEvidenceLocator(loc: EvidenceLocator, locale: Locale = "vi"): string {
  const parts: string[] = [];
  if (loc.page != null) parts.push(t("slides.locator.page", { n: loc.page }, locale));
  if (loc.slide != null) parts.push(t("slides.locator.slide", { n: loc.slide }, locale));
  if (loc.section) parts.push(t("slides.locator.section", { name: loc.section }, locale));
  if (loc.url) parts.push(loc.url);
  return parts.join(", ");
}

/** Số bằng chứng được trích dẫn thực sự (hợp lệ, không trùng, tăng dần). */
export function citedEvidenceNumbers(content: SlideDeckContent): number[] {
  const set = new Set<number>();
  for (const s of content.slides) {
    for (const n of s.citations ?? []) if (Number.isInteger(n) && n >= 1 && n <= content.evidence.length) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

export function evidenceLine(n: number, ev: Evidence, locale: Locale = "vi"): string {
  const where = describeEvidenceLocator(ev.locator, locale);
  return `[${n}] ${ev.sourceTitle}${where ? ` — ${where}` : ""}`;
}

const SOURCES_PER_SLIDE = 7;

/**
 * Slide "Nguồn" (cuối bộ) liệt kê tiêu đề + vị trí của các bằng chứng đã được trích dẫn.
 * Trả về [] nếu không slide nào có trích dẫn hợp lệ. Dùng chung cho PPTX và HTML/PDF.
 */
export function buildSourceSlides(content: SlideDeckContent, locale: Locale = "vi"): Slide[] {
  const nums = citedEvidenceNumbers(content);
  if (nums.length === 0) return [];
  const chunks: number[][] = [];
  for (let i = 0; i < nums.length; i += SOURCES_PER_SLIDE) chunks.push(nums.slice(i, i + SOURCES_PER_SLIDE));
  return chunks.map((chunk, i) => ({
    id: `sources-${i + 1}`,
    layout: "title_bullets" as const,
    title:
      chunks.length === 1
        ? t("slides.sources.title", undefined, locale)
        : t("slides.sources.titlePart", { part: i + 1, total: chunks.length }, locale),
    bullets: chunk.map((n) => evidenceLine(n, content.evidence[n - 1], locale)),
  }));
}
