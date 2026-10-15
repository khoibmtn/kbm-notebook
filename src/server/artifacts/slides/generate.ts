import "server-only";
import { z } from "zod";
import type { AiProvider } from "@/server/ai/provider";
import type { Evidence } from "@/server/knowledge/providers/types";
import { buildExtractiveDeck } from "./extractive";
import {
  CONTENT_SYSTEM,
  EDIT_SLIDE_SYSTEM,
  OUTLINE_SYSTEM,
  buildContentUser,
  buildEditSlideUser,
  buildOutlineUser,
  retrySuffix,
  type PromptCtx,
} from "./prompts";
import { newId } from "./sources";
import {
  DEFAULT_THEME,
  SLIDE_PALETTES,
  slideDeckJsonSchema,
  slideDeckSchema,
  slideModelJsonSchema,
  slideOutlineJsonSchema,
  slideOutlineSchema,
  slideSchema,
  type Slide,
  type SlideDeckContent,
  type SlideLayout,
  type SlideOutline,
} from "./types";

export type GenerateSlideDeckInput = {
  contextText: string;
  evidence: Evidence[];
  instructions: string;
  options: {
    slideCount?: number | "auto";
    style?: "detailed" | "concise";
    language?: string;
    audience?: string;
    includeImages?: boolean;
    /** Số ảnh AI tối đa khi `includeImages` (mặc định 4). */
    maxImages?: number;
  };
  provider: AiProvider;
  model?: string;
};

export class SlideGenerationError extends Error {
  readonly errors: string[];
  constructor(message: string, errors: string[]) {
    super(`${message}\n- ${errors.slice(0, 8).join("\n- ")}`);
    this.name = "SlideGenerationError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------- tiện ích

export const MAX_SLIDES = 80;
export const DEFAULT_MAX_IMAGES = 4;

/** Số slide gợi ý cho 'auto': 10–25 theo độ dài ngữ cảnh (chỉ là gợi ý, mô hình được phép vượt). */
export function autoSlideCountTarget(contextText: string): number {
  return Math.max(10, Math.min(25, Math.round(8 + contextText.length / 5000)));
}

/** Ngữ cảnh có đủ số liệu để nên có slide chart/table không. */
export function hasNumericData(contextText: string): boolean {
  const cleaned = contextText.replace(/\[\d+\]/g, " ");
  const nums = new Set(cleaned.match(/\d+(?:[.,]\d+)?/g)?.filter((n) => n.length >= 2 || n.includes(",") || n.includes(".")));
  const hasUnits = /\d\s?(?:%|tỷ|triệu|nghìn|ngàn|USD|VND|đồng|GW|MW|kWh|tấn|km|kg)/i.test(cleaned);
  return nums.size >= 6 || (hasUnits && nums.size >= 3);
}

function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      out[k] = stripNulls(val);
    }
    return out;
  }
  return v;
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const s = trimmed.indexOf("{");
    const e = trimmed.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(trimmed.slice(s, e + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function issuesToErrors(prefix: string, err: z.ZodError): string[] {
  return err.issues.slice(0, 6).map((i) => `${prefix}${i.path.join(".") || "(gốc)"}: ${i.message}`);
}

type Validated<T> = { ok: true; value: T; soft: string[] } | { ok: false; errors: string[] };

async function callJson<T>(args: {
  provider: AiProvider;
  model?: string;
  system: string;
  user: string;
  jsonSchema: object;
  temperature?: number;
  validate: (raw: unknown) => Validated<T>;
  what: string;
}): Promise<T> {
  const run = async (user: string): Promise<Validated<T>> => {
    const res = await args.provider.generateText({
      model: args.model,
      system: args.system,
      messages: [{ role: "user", content: user }],
      jsonSchema: args.jsonSchema,
      temperature: args.temperature ?? 0.4,
    });
    const raw = res.json !== undefined ? res.json : parseJsonLoose(res.text);
    if (raw === undefined) return { ok: false, errors: ["Không phải JSON hợp lệ"] };
    return args.validate(raw);
  };

  const first = await run(args.user);
  if (first.ok && first.soft.length === 0) return first.value;
  const errors = first.ok ? first.soft : first.errors;
  const second = await run(args.user + retrySuffix(errors));
  if (second.ok) return second.value;
  // Lần 2 hỏng nhưng lần 1 đã hợp lệ (chỉ còn lỗi mềm) → dùng lần 1.
  if (first.ok) return first.value;
  throw new SlideGenerationError(`Không tạo được ${args.what} hợp lệ sau 2 lần thử`, second.errors);
}

// ---------------------------------------------------------------- chuẩn hoá & kiểm tra slide

const modelSlideSchema = slideSchema.omit({ id: true });
type ModelSlide = z.infer<typeof modelSlideSchema>;

const FIELDS_BY_LAYOUT: Record<SlideLayout, (keyof ModelSlide)[]> = {
  title: ["subtitle"],
  section: ["subtitle"],
  title_bullets: ["subtitle", "bullets"],
  two_column: ["subtitle", "columns"],
  image_text: ["subtitle", "bullets", "image"],
  chart: ["subtitle", "chart", "bullets"],
  table: ["subtitle", "table"],
  quote: ["quote"],
  closing: ["subtitle", "bullets"],
};

export const MAX_BULLETS = 6;

/** Giữ các số trích dẫn hợp lệ (1..evidenceCount), bỏ trùng, tăng dần. */
export function sanitizeCitations(citations: unknown, evidenceCount: number): number[] {
  if (!Array.isArray(citations)) return [];
  const set = new Set<number>();
  for (const c of citations) {
    const n = typeof c === "number" ? c : Number(c);
    if (Number.isInteger(n) && n >= 1 && n <= evidenceCount) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function cleanStr(s: string | undefined): string | undefined {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
}

function cleanBullets(b: string[] | undefined): string[] | undefined {
  if (!b) return undefined;
  const out = b.map((x) => x.replace(/^[\s•\-–*]+/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return out.slice(0, MAX_BULLETS);
}

/** Chuẩn hoá một slide thô từ mô hình; trả lỗi cứng nếu thiếu dữ liệu mà layout cần. */
export function normalizeModelSlide(
  raw: unknown,
  evidenceCount: number,
  label = "Slide",
): { slide?: ModelSlide; errors: string[] } {
  const parsed = modelSlideSchema.safeParse(stripNulls(raw));
  if (!parsed.success) return { errors: issuesToErrors(`${label}: `, parsed.error) };
  const s = parsed.data;
  const errors: string[] = [];
  const keep = new Set<keyof ModelSlide>(FIELDS_BY_LAYOUT[s.layout]);

  const out: ModelSlide = { layout: s.layout, title: cleanStr(s.title) ?? "" };
  if (!out.title) errors.push(`${label}: thiếu "title"`);
  if (keep.has("subtitle")) out.subtitle = cleanStr(s.subtitle);
  if (keep.has("bullets")) out.bullets = cleanBullets(s.bullets);
  if (keep.has("columns") && s.columns) {
    out.columns = s.columns.slice(0, 3).map((c) => ({ heading: cleanStr(c.heading) ?? "", bullets: cleanBullets(c.bullets) ?? [] }));
  }
  if (keep.has("image") && s.image) {
    const prompt = cleanStr(s.image.prompt);
    if (prompt) out.image = { prompt, caption: cleanStr(s.image.caption) };
  }
  if (keep.has("chart") && s.chart) {
    const series = (s.chart.type === "pie" ? s.chart.series.slice(0, 1) : s.chart.series).filter((x) => x.values.length > 0);
    out.chart = { type: s.chart.type, labels: s.chart.labels.map((l) => l.trim()), series };
  }
  if (keep.has("table") && s.table) {
    const headers = s.table.headers.map((h) => h.trim());
    out.table = {
      headers,
      rows: s.table.rows.map((r) => headers.map((_, i) => (r[i] ?? "").trim())),
    };
  }
  if (keep.has("quote") && s.quote) {
    const text = cleanStr(s.quote.text);
    if (text) out.quote = { text, attribution: cleanStr(s.quote.attribution) };
  }
  out.notes = cleanStr(s.notes);
  const cites = sanitizeCitations(s.citations, evidenceCount);
  if (cites.length) out.citations = cites;

  // Yêu cầu theo layout
  switch (out.layout) {
    case "title_bullets":
      if (!out.bullets?.length) errors.push(`${label} (title_bullets): thiếu "bullets"`);
      break;
    case "two_column":
      if (!out.columns || out.columns.length < 2) errors.push(`${label} (two_column): cần ít nhất 2 "columns"`);
      else if (out.columns.some((c) => !c.heading || c.bullets.length === 0)) errors.push(`${label} (two_column): mỗi cột cần "heading" và "bullets"`);
      break;
    case "image_text":
      if (!out.bullets?.length) errors.push(`${label} (image_text): thiếu "bullets"`);
      if (!out.image?.prompt) errors.push(`${label} (image_text): thiếu "image.prompt"`);
      break;
    case "chart": {
      const c = out.chart;
      if (!c || c.labels.length === 0 || c.series.length === 0) errors.push(`${label} (chart): thiếu "chart" (labels/series)`);
      else if (c.series.some((x) => x.values.length !== c.labels.length)) {
        errors.push(`${label} (chart): mỗi series phải có số "values" bằng số "labels" (${c.labels.length})`);
      }
      break;
    }
    case "table":
      if (!out.table || out.table.headers.length < 2 || out.table.rows.length === 0) errors.push(`${label} (table): cần "headers" ≥ 2 cột và "rows" ≥ 1 hàng`);
      break;
    case "quote":
      if (!out.quote?.text) errors.push(`${label} (quote): thiếu "quote.text"`);
      break;
    default:
      break;
  }
  return { slide: out, errors };
}

// ---------------------------------------------------------------- dàn ý & nội dung

function validateOutline(raw: unknown, count: number | "auto"): Validated<SlideOutline> {
  const parsed = slideOutlineSchema.safeParse(stripNulls(raw));
  if (!parsed.success) return { ok: false, errors: issuesToErrors("Dàn ý: ", parsed.error) };
  const o = parsed.data;
  if (count !== "auto" && o.slides.length !== count) {
    return { ok: false, errors: [`Dàn ý phải có ĐÚNG ${count} slide nhưng có ${o.slides.length}`] };
  }
  if (o.slides.length > MAX_SLIDES) return { ok: false, errors: [`Tối đa ${MAX_SLIDES} slide`] };
  return { ok: true, value: o, soft: [] };
}

function validateContent(raw: unknown, outline: SlideOutline, evidenceCount: number, numeric: boolean): Validated<{ palette?: string; slides: ModelSlide[] }> {
  const obj = stripNulls(raw) as { theme?: { palette?: string }; slides?: unknown[] } | undefined;
  if (!obj || !Array.isArray(obj.slides)) return { ok: false, errors: ['Thiếu mảng "slides"'] };
  if (obj.slides.length !== outline.slides.length) {
    return { ok: false, errors: [`Phải trả về đúng ${outline.slides.length} slide theo dàn ý nhưng có ${obj.slides.length}`] };
  }
  const errors: string[] = [];
  const slides: ModelSlide[] = [];
  obj.slides.forEach((rawSlide, i) => {
    const r = normalizeModelSlide(rawSlide, evidenceCount, `Slide ${i + 1}`);
    errors.push(...r.errors);
    if (r.slide) slides.push(r.slide);
  });
  if (errors.length > 0) return { ok: false, errors };
  const soft: string[] = [];
  if (numeric && !slides.some((s) => s.layout === "chart" || s.layout === "table")) {
    soft.push('Nguồn có số liệu nhưng chưa có slide layout "chart" hoặc "table": hãy thêm số liệu thật của nguồn');
  }
  const missingNotes = slides.map((s, i) => (s.notes ? null : i + 1)).filter((n): n is number => n !== null);
  if (missingNotes.length > 0) soft.push(`Thiếu "notes" (ghi chú diễn giả 2–4 câu) ở slide: ${missingNotes.slice(0, 10).join(", ")}`);
  return { ok: true, value: { palette: obj.theme?.palette, slides }, soft };
}

// ---------------------------------------------------------------- ảnh

async function attachImages(slides: Slide[], provider: AiProvider, max: number): Promise<void> {
  if (!provider.generateImage || max <= 0) return;
  let used = 0;
  for (const s of slides) {
    if (used >= max) break;
    if (s.layout !== "image_text" || !s.image?.prompt || s.image.dataUrl || s.image.fileId) continue;
    used += 1;
    try {
      const img = await provider.generateImage(
        `${s.image.prompt}. Flat modern vector illustration, clean composition, soft colors, no text, no letters, no watermark.`,
        { aspect: "5:4" },
      );
      s.image = { ...s.image, dataUrl: `data:${img.mime};base64,${img.bytes.toString("base64")}` };
    } catch {
      // Một ảnh lỗi không làm hỏng cả bộ slide: slide giữ `image.prompt` để người dùng bấm "Tạo ảnh" lại.
    }
  }
}

// ---------------------------------------------------------------- API công khai

/**
 * Sinh bộ slide 2 giai đoạn (dàn ý → nội dung) từ ngữ cảnh đã đánh số.
 *
 * Ảnh: nếu `options.includeImages` và provider có `generateImage`, tối đa `maxImages` (mặc định 4)
 * slide `image_text` nhận ảnh dưới dạng `image.dataUrl`. Framework PHẢI lưu các ảnh này vào kho tệp
 * rồi thay bằng `image.fileId` (xoá `dataUrl`) trước khi ghi vào `artifact_versions.content`.
 *
 * Với provider `mock` (test/e2e) mà đầu ra không hợp lệ, trả về bộ slide trích xuất từ bằng chứng.
 */
export async function generateSlideDeck(input: GenerateSlideDeckInput): Promise<SlideDeckContent> {
  const { provider, evidence, options } = input;
  if (!input.contextText.trim() && evidence.length === 0) {
    throw new SlideGenerationError("Không có nguồn để tạo slide", ["contextText rỗng"]);
  }
  const rawCount = options.slideCount ?? "auto";
  const count = rawCount === "auto" ? "auto" : Math.max(1, Math.min(MAX_SLIDES, Math.round(rawCount)));
  const numeric = hasNumericData(input.contextText);
  const ctx: PromptCtx = {
    contextText: input.contextText,
    instructions: input.instructions,
    language: options.language,
    audience: options.audience,
    style: options.style ?? "concise",
    count,
    autoTarget: autoSlideCountTarget(input.contextText),
    evidenceCount: evidence.length,
    hasNumeric: numeric,
  };

  let deck: SlideDeckContent;
  try {
    const outline = await callJson<SlideOutline>({
      provider,
      model: input.model,
      system: OUTLINE_SYSTEM,
      user: buildOutlineUser(ctx),
      jsonSchema: slideOutlineJsonSchema,
      validate: (raw) => validateOutline(raw, count),
      what: "dàn ý",
    });
    const content = await callJson({
      provider,
      model: input.model,
      system: CONTENT_SYSTEM,
      user: buildContentUser(ctx, outline),
      jsonSchema: slideDeckJsonSchema,
      validate: (raw) => validateContent(raw, outline, evidence.length, numeric),
      what: "nội dung slide",
    });
    const palette = (SLIDE_PALETTES as readonly string[]).includes(content.palette ?? "")
      ? (content.palette as SlideDeckContent["theme"]["palette"])
      : (outline.palette ?? DEFAULT_THEME.palette);
    deck = {
      theme: { palette, font: DEFAULT_THEME.font },
      slides: content.slides.map((s) => ({ id: newId(), ...s })),
      evidence,
    };
  } catch (e) {
    if (provider.id === "mock" && e instanceof SlideGenerationError) {
      return buildExtractiveDeck({ evidence, contextText: input.contextText, slideCount: count });
    }
    throw e;
  }

  if (options.includeImages) await attachImages(deck.slides, provider, options.maxImages ?? DEFAULT_MAX_IMAGES);
  return slideDeckSchema.parse(deck);
}

export type EditSlideInput = {
  content: SlideDeckContent;
  slideId: string;
  instruction: string;
  contextText?: string;
  provider: AiProvider;
  model?: string;
};

/** Viết lại CHỈ một slide theo chỉ dẫn; các slide khác, theme và evidence giữ nguyên. */
export async function editSlideWithAi(input: EditSlideInput): Promise<SlideDeckContent> {
  const { content, slideId } = input;
  const index = content.slides.findIndex((s) => s.id === slideId);
  if (index < 0) throw new Error(`Không tìm thấy slide ${slideId}`);
  const old = content.slides[index];
  const evCount = content.evidence.length;

  // Không đưa ảnh nhúng (dataUrl rất lớn) vào prompt.
  const forPrompt = JSON.parse(
    JSON.stringify({ ...old, image: old.image ? { prompt: old.image.prompt, caption: old.image.caption } : undefined }),
  ) as Partial<Slide>;
  delete forPrompt.id;
  const user = buildEditSlideUser({
    slide: forPrompt as Omit<Slide, "id">,
    otherTitles: content.slides.map((s) => s.title),
    instruction: input.instruction,
    contextText: input.contextText,
    evidenceCount: evCount,
  });

  const next = await callJson<ModelSlide>({
    provider: input.provider,
    model: input.model,
    system: EDIT_SLIDE_SYSTEM,
    user,
    jsonSchema: slideModelJsonSchema,
    validate: (raw) => {
      const r = normalizeModelSlide(raw, evCount, "Slide");
      if (r.errors.length > 0 || !r.slide) return { ok: false, errors: r.errors };
      return { ok: true, value: r.slide, soft: [] };
    },
    what: "slide đã chỉnh sửa",
  });

  const merged: Slide = { id: old.id, ...next };
  // Giữ ảnh đã tạo nếu mô tả ảnh không đổi; đổi mô tả → ảnh cũ không còn đúng.
  if (merged.image && old.image && merged.image.prompt === old.image.prompt) {
    merged.image = { ...merged.image, fileId: old.image.fileId, dataUrl: old.image.dataUrl };
  }
  if (!merged.citations && old.citations) merged.citations = sanitizeCitations(old.citations, evCount);
  if (!merged.notes && old.notes) merged.notes = old.notes;

  const slides = content.slides.map((s, i) => (i === index ? merged : s));
  return slideDeckSchema.parse({ ...content, slides });
}
