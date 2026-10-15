import { z } from "zod";
import type { Evidence } from "@/server/knowledge/providers/types";

/**
 * Hợp đồng dữ liệu của slide deck (docs/03 + docs/06-slide-engine.md).
 * File này KHÔNG import "server-only" để component client dùng chung kiểu và schema.
 */

export const SLIDE_LAYOUTS = [
  "title",
  "section",
  "title_bullets",
  "two_column",
  "image_text",
  "chart",
  "quote",
  "table",
  "closing",
] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export const SLIDE_PALETTES = ["indigo", "emerald", "rose", "amber", "slate", "ocean"] as const;
export const SLIDE_FONTS = ["Inter", "Roboto", "Georgia", "Arial"] as const;
export const CHART_TYPES = ["bar", "line", "pie"] as const;

export type SlideChart = {
  type: "bar" | "line" | "pie";
  labels: string[];
  series: { name: string; values: number[] }[];
};

export type Slide = {
  id: string;
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bullets?: string[];
  columns?: { heading: string; bullets: string[] }[];
  image?: { prompt: string; fileId?: string; dataUrl?: string; caption?: string };
  chart?: SlideChart;
  table?: { headers: string[]; rows: string[][] };
  quote?: { text: string; attribution?: string };
  notes?: string;
  /** Số thứ tự bằng chứng (1-based) trong `SlideDeckContent.evidence`. */
  citations?: number[];
};

export type SlideTheme = {
  palette: "indigo" | "emerald" | "rose" | "amber" | "slate" | "ocean";
  font: "Inter" | "Roboto" | "Georgia" | "Arial";
};

export type SlideDeckContent = { theme: SlideTheme; slides: Slide[]; evidence: Evidence[] };

// ---------------------------------------------------------------- zod (lưu trữ — khoan dung)

export const evidenceSchema = z.object({
  id: z.string(),
  provider: z.enum(["local", "web", "notebooklm-bridge", "notebooklm-enterprise"]),
  sourceId: z.string().nullable(),
  sourceTitle: z.string(),
  locator: z.object({
    page: z.number().optional(),
    slide: z.number().optional(),
    section: z.string().optional(),
    url: z.string().optional(),
    startChar: z.number().optional(),
    endChar: z.number().optional(),
  }),
  text: z.string(),
  score: z.number(),
  similarity: z.number().optional(),
});

export const chartSchema = z.object({
  type: z.enum(CHART_TYPES),
  labels: z.array(z.string()),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
});

export const tableSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

export const slideSchema = z.object({
  id: z.string().min(1),
  layout: z.enum(SLIDE_LAYOUTS),
  title: z.string(),
  subtitle: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  columns: z.array(z.object({ heading: z.string(), bullets: z.array(z.string()) })).optional(),
  image: z
    .object({
      prompt: z.string(),
      fileId: z.string().optional(),
      dataUrl: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
  chart: chartSchema.optional(),
  table: tableSchema.optional(),
  quote: z.object({ text: z.string(), attribution: z.string().optional() }).optional(),
  notes: z.string().optional(),
  citations: z.array(z.number().int().positive()).optional(),
});

export const slideThemeSchema = z.object({
  palette: z.enum(SLIDE_PALETTES),
  font: z.enum(SLIDE_FONTS),
});

export const slideDeckSchema: z.ZodType<SlideDeckContent> = z.object({
  theme: slideThemeSchema,
  slides: z.array(slideSchema),
  evidence: z.array(evidenceSchema),
});

export const DEFAULT_THEME: SlideTheme = { palette: "indigo", font: "Inter" };

// ---------------------------------------------------------------- JSON Schema cho mô hình

const strArr = (description?: string) => ({
  type: "array",
  items: { type: "string" },
  ...(description ? { description } : {}),
});

/** Schema của MỘT slide do mô hình sinh (không có `id`; hệ thống tự gán). */
export const slideModelJsonSchema = {
  type: "object",
  properties: {
    layout: { type: "string", enum: [...SLIDE_LAYOUTS] },
    title: { type: "string", description: "Tiêu đề ngắn, tối đa ~9 từ" },
    subtitle: { type: "string" },
    bullets: { ...strArr("Tối đa 6 gạch đầu dòng, mỗi dòng ~7 từ"), maxItems: 6 },
    columns: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: { heading: { type: "string" }, bullets: { ...strArr(), maxItems: 5 } },
        required: ["heading", "bullets"],
      },
    },
    image: {
      type: "object",
      properties: { prompt: { type: "string" }, caption: { type: "string" } },
      required: ["prompt"],
    },
    chart: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...CHART_TYPES] },
        labels: strArr(),
        series: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } },
            required: ["name", "values"],
          },
        },
      },
      required: ["type", "labels", "series"],
    },
    table: {
      type: "object",
      properties: { headers: strArr(), rows: { type: "array", items: strArr() } },
      required: ["headers", "rows"],
    },
    quote: {
      type: "object",
      properties: { text: { type: "string" }, attribution: { type: "string" } },
      required: ["text"],
    },
    notes: { type: "string", description: "Ghi chú diễn giả 2–4 câu" },
    citations: { type: "array", items: { type: "integer" }, description: "Số thứ tự [n] của bằng chứng" },
  },
  required: ["layout", "title"],
} as const;

/** JSON Schema để truyền vào `generateText({ jsonSchema })` — KHÔNG có `evidence` (hệ thống tự gắn). */
export const slideDeckJsonSchema = {
  type: "object",
  properties: {
    theme: {
      type: "object",
      properties: {
        palette: { type: "string", enum: [...SLIDE_PALETTES] },
        font: { type: "string", enum: [...SLIDE_FONTS] },
      },
      required: ["palette", "font"],
    },
    slides: { type: "array", minItems: 1, items: slideModelJsonSchema },
  },
  required: ["theme", "slides"],
} as const;

/** Schema dàn ý (giai đoạn 1). */
export const slideOutlineJsonSchema = {
  type: "object",
  properties: {
    deckTitle: { type: "string" },
    palette: { type: "string", enum: [...SLIDE_PALETTES] },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, summary: { type: "string" } },
        required: ["title"],
      },
    },
    slides: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          layout: { type: "string", enum: [...SLIDE_LAYOUTS] },
          title: { type: "string" },
          purpose: { type: "string", description: "Slide này truyền đạt điều gì (1 câu)" },
          section: { type: "string" },
          citations: { type: "array", items: { type: "integer" } },
        },
        required: ["layout", "title", "purpose"],
      },
    },
  },
  required: ["deckTitle", "slides"],
} as const;

export const slideOutlineSchema = z.object({
  deckTitle: z.string().min(1),
  palette: z.enum(SLIDE_PALETTES).optional(),
  sections: z.array(z.object({ title: z.string(), summary: z.string().optional() })).optional(),
  slides: z
    .array(
      z.object({
        layout: z.enum(SLIDE_LAYOUTS),
        title: z.string().min(1),
        purpose: z.string(),
        section: z.string().optional(),
        citations: z.array(z.number()).optional(),
      }),
    )
    .min(1),
});
export type SlideOutline = z.infer<typeof slideOutlineSchema>;

/** Khoá i18n tên layout. */
export const LAYOUT_LABEL_KEYS = {
  title: "slides.layout.title",
  section: "slides.layout.section",
  title_bullets: "slides.layout.title_bullets",
  two_column: "slides.layout.two_column",
  image_text: "slides.layout.image_text",
  chart: "slides.layout.chart",
  quote: "slides.layout.quote",
  table: "slides.layout.table",
  closing: "slides.layout.closing",
} as const;
