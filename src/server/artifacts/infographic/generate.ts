import "server-only";
import { z } from "zod";
import type { AiProvider } from "@/server/ai/provider";
import type { Evidence } from "@/server/knowledge/providers/types";
import { retrySuffix } from "../slides/prompts";
import { sanitizeCitations, SlideGenerationError } from "../slides/generate";
import { newId } from "../slides/sources";
import { SLIDE_PALETTES } from "../slides/types";
import { ICON_NAMES } from "./icons";
import { buildInfographicUser, INFOGRAPHIC_SYSTEM } from "./prompts";
import {
  infographicJsonSchema,
  infographicSchema,
  INFOGRAPHIC_BLOCK_TYPES,
  type InfographicBlock,
  type InfographicContent,
} from "./types";

export type GenerateInfographicInput = {
  contextText: string;
  evidence: Evidence[];
  instructions: string;
  options: { orientation?: "portrait" | "landscape"; detail?: "standard" | "detailed"; language?: string };
  provider: AiProvider;
  model?: string;
};

// ---------------------------------------------------------------- kiểm tra số liệu có trong nguồn

/** Các biến thể chuẩn hoá của một dãy số: nguyên văn, ',' → '.', bỏ dấu phân cách nghìn, dạng số. */
function variantsOf(raw: string): string[] {
  const dot = raw.replace(/,/g, ".");
  const bare = raw.replace(/[.,]/g, "");
  const num = Number(dot);
  return [raw, dot, bare, ...(Number.isFinite(num) ? [String(num)] : [])];
}

/** Tập các số xuất hiện trong văn bản (đã bỏ chỉ mục trích dẫn [n]) cùng các biến thể chuẩn hoá. */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.replace(/\[\d+\]/g, " ").matchAll(/\d+(?:[.,]\d+)*/g)) for (const v of variantsOf(m[0])) out.add(v);
  return out;
}

function groundedNumber(n: number, known: Set<string>): boolean {
  return known.has(String(n)) || known.has(n.toFixed(1)) || known.has(n.toFixed(2)) || known.has(String(Math.round(n)));
}

/** Mọi dãy số trong chuỗi (vd "42,5%") phải có trong nguồn. Trả về các số không tìm thấy. */
export function ungroundedInText(value: string, known: Set<string>): string[] {
  const missing: string[] = [];
  for (const m of value.matchAll(/\d+(?:[.,]\d+)*/g)) if (!variantsOf(m[0]).some((v) => known.has(v))) missing.push(m[0]);
  return missing;
}

// ---------------------------------------------------------------- chuẩn hoá khối

const rawBlockSchema = z
  .object({
    type: z.enum(INFOGRAPHIC_BLOCK_TYPES),
    value: z.string().optional(),
    label: z.string().optional(),
    caption: z.string().optional(),
    icon: z.string().optional(),
    title: z.string().optional(),
    items: z.array(z.string()).optional(),
    ordered: z.boolean().optional(),
    steps: z.array(z.object({ title: z.string(), description: z.string().optional() })).optional(),
    left: z.object({ heading: z.string(), items: z.array(z.string()) }).optional(),
    right: z.object({ heading: z.string(), items: z.array(z.string()) }).optional(),
    text: z.string().optional(),
    chart: z
      .object({
        type: z.enum(["bar", "line", "pie"]),
        labels: z.array(z.string()),
        series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
      })
      .optional(),
    attribution: z.string().optional(),
    citations: z.array(z.number()).optional(),
  })
  .passthrough();

function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== null && val !== undefined) o[k] = stripNulls(val);
    return o;
  }
  return v;
}

const clean = (s: string | undefined) => s?.replace(/\s+/g, " ").trim() || undefined;
const cleanList = (l: string[] | undefined, max = 8) => (l ?? []).map((x) => x.replace(/^[\s•\-–*]+/, "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, max);

export function normalizeBlock(raw: unknown, evidenceCount: number, known: Set<string>, label: string): { block?: InfographicBlock; errors: string[] } {
  const parsed = rawBlockSchema.safeParse(stripNulls(raw));
  if (!parsed.success) return { errors: [`${label}: ${parsed.error.issues[0]?.path.join(".") || "khối"} không hợp lệ`] };
  const r = parsed.data;
  const errors: string[] = [];
  const citations = sanitizeCitations(r.citations, evidenceCount);
  const base = { id: newId(), citations: citations.length ? citations : undefined };
  let block: InfographicBlock | undefined;
  const icon = (ICON_NAMES as string[]).includes(r.icon ?? "") ? (r.icon as (typeof ICON_NAMES)[number]) : undefined;

  switch (r.type) {
    case "stat": {
      const value = clean(r.value);
      const lab = clean(r.label);
      if (!value || !lab) errors.push(`${label} (stat): cần "value" và "label"`);
      else {
        const missing = ungroundedInText(value, known);
        if (missing.length) errors.push(`${label} (stat): số "${missing.join(", ")}" không có trong nguồn — chỉ dùng số nguyên văn từ nguồn`);
        if (citations.length === 0) errors.push(`${label} (stat): thiếu "citations" hợp lệ`);
        block = { ...base, type: "stat", value, label: lab, caption: clean(r.caption), icon };
      }
      break;
    }
    case "list": {
      const items = cleanList(r.items);
      if (!clean(r.title) || items.length === 0) errors.push(`${label} (list): cần "title" và "items"`);
      else block = { ...base, type: "list", title: clean(r.title) as string, items, ordered: r.ordered };
      break;
    }
    case "process": {
      const steps = (r.steps ?? []).map((s) => ({ title: clean(s.title) ?? "", description: clean(s.description) })).filter((s) => s.title).slice(0, 8);
      if (!clean(r.title) || steps.length < 2) errors.push(`${label} (process): cần "title" và ≥ 2 "steps"`);
      else block = { ...base, type: "process", title: clean(r.title) as string, steps };
      break;
    }
    case "compare": {
      const l = r.left && { heading: clean(r.left.heading) ?? "", items: cleanList(r.left.items, 6) };
      const rr = r.right && { heading: clean(r.right.heading) ?? "", items: cleanList(r.right.items, 6) };
      if (!clean(r.title) || !l || !rr || !l.heading || !rr.heading || l.items.length === 0 || rr.items.length === 0) {
        errors.push(`${label} (compare): cần "title", "left", "right" (mỗi bên có heading và items)`);
      } else block = { ...base, type: "compare", title: clean(r.title) as string, left: l, right: rr };
      break;
    }
    case "icon_text": {
      if (!icon || !clean(r.title) || !clean(r.text)) errors.push(`${label} (icon_text): cần "icon" (trong danh sách), "title", "text"`);
      else block = { ...base, type: "icon_text", icon, title: clean(r.title) as string, text: clean(r.text) as string };
      break;
    }
    case "chart": {
      const c = r.chart;
      if (!clean(r.title) || !c || c.labels.length === 0 || c.series.length === 0) errors.push(`${label} (chart): cần "title" và "chart" (labels, series)`);
      else {
        const series = c.type === "pie" ? c.series.slice(0, 1) : c.series;
        if (series.some((s) => s.values.length !== c.labels.length)) errors.push(`${label} (chart): số "values" phải bằng số "labels"`);
        const bad = series.flatMap((s) => s.values).filter((v) => !groundedNumber(v, known));
        if (bad.length) errors.push(`${label} (chart): giá trị ${[...new Set(bad)].slice(0, 5).join(", ")} không có trong nguồn`);
        if (citations.length === 0) errors.push(`${label} (chart): thiếu "citations" hợp lệ`);
        block = { ...base, type: "chart", title: clean(r.title) as string, chart: { type: c.type, labels: c.labels.map((x) => x.trim()), series } };
      }
      break;
    }
    case "quote": {
      if (!clean(r.text)) errors.push(`${label} (quote): thiếu "text"`);
      else block = { ...base, type: "quote", text: clean(r.text) as string, attribution: clean(r.attribution) };
      break;
    }
  }
  return { block, errors };
}

// ---------------------------------------------------------------- sinh

async function callOnce(input: GenerateInfographicInput, user: string) {
  const res = await input.provider.generateText({
    model: input.model,
    system: INFOGRAPHIC_SYSTEM,
    messages: [{ role: "user", content: user }],
    jsonSchema: infographicJsonSchema,
    temperature: 0.3,
  });
  if (res.json !== undefined) return res.json;
  try {
    return JSON.parse(res.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, ""));
  } catch {
    return undefined;
  }
}

type Draft = { title: string; subtitle?: string; palette?: string; blocks: InfographicBlock[] };

function validate(raw: unknown, input: GenerateInfographicInput, known: Set<string>): { ok: true; draft: Draft; soft: string[] } | { ok: false; errors: string[] } {
  const o = stripNulls(raw) as { title?: string; subtitle?: string; palette?: string; blocks?: unknown[] } | undefined;
  if (!o || !clean(o.title) || !Array.isArray(o.blocks) || o.blocks.length === 0) return { ok: false, errors: ['Thiếu "title" hoặc mảng "blocks"'] };
  const errors: string[] = [];
  const blocks: InfographicBlock[] = [];
  o.blocks.forEach((b, i) => {
    const r = normalizeBlock(b, input.evidence.length, known, `Khối ${i + 1}`);
    errors.push(...r.errors);
    if (r.block) blocks.push(r.block);
  });
  if (errors.length) return { ok: false, errors };
  const soft: string[] = [];
  const noCite = blocks.map((b, i) => (b.citations?.length ? null : i + 1)).filter((n): n is number => n !== null);
  if (noCite.length) soft.push(`Khối ${noCite.join(", ")} thiếu "citations" — mỗi khối phải trích dẫn nguồn`);
  return { ok: true, draft: { title: clean(o.title) as string, subtitle: clean(o.subtitle), palette: o.palette, blocks }, soft };
}

/**
 * Sinh infographic từ ngữ cảnh đã đánh số. Số liệu được kiểm chứng với `contextText`
 * (stat/chart chứa số không có trong nguồn bị từ chối → thử lại một lần kèm lỗi → ném lỗi).
 * Provider `mock` mà đầu ra không hợp lệ → infographic trích xuất xác định từ bằng chứng.
 */
export async function generateInfographic(input: GenerateInfographicInput): Promise<InfographicContent> {
  if (!input.contextText.trim() && input.evidence.length === 0) throw new SlideGenerationError("Không có nguồn để tạo infographic", ["contextText rỗng"]);
  const orientation = input.options.orientation ?? "portrait";
  const known = numbersIn(input.contextText + "\n" + input.evidence.map((e) => e.text).join("\n"));
  const user = buildInfographicUser({
    contextText: input.contextText,
    instructions: input.instructions,
    orientation,
    detail: input.options.detail ?? "standard",
    language: input.options.language,
    evidenceCount: input.evidence.length,
  });

  let draft: Draft | undefined;
  try {
    const first = validate(await callOnce(input, user), input, known);
    if (first.ok && first.soft.length === 0) draft = first.draft;
    else {
      const second = validate(await callOnce(input, user + retrySuffix(first.ok ? first.soft : first.errors)), input, known);
      if (second.ok) draft = second.draft;
      else if (first.ok) draft = first.draft;
      else throw new SlideGenerationError("Không tạo được infographic hợp lệ sau 2 lần thử", second.errors);
    }
  } catch (e) {
    if (input.provider.id === "mock" && e instanceof SlideGenerationError) return buildExtractiveInfographic(input, orientation);
    throw e;
  }

  const palette = (SLIDE_PALETTES as readonly string[]).includes(draft.palette ?? "") ? (draft.palette as InfographicContent["palette"]) : "indigo";
  return infographicSchema.parse({
    title: draft.title,
    subtitle: draft.subtitle,
    orientation,
    palette,
    blocks: draft.blocks,
    evidence: input.evidence,
  });
}

// ---------------------------------------------------------------- mock: trích xuất

function buildExtractiveInfographic(input: GenerateInfographicInput, orientation: "portrait" | "landscape"): InfographicContent {
  const blocks: InfographicBlock[] = [];
  const evs = input.evidence.length > 0 ? input.evidence : [];
  evs.forEach((e, idx) => {
    const n = idx + 1;
    // số liệu thật: "<nhãn> ... 42%" lấy từ câu có phần trăm
    for (const m of e.text.matchAll(/([^.\n]{0,60}?)\b(\d+(?:[.,]\d+)?\s?%)/g)) {
      if (blocks.filter((b) => b.type === "stat").length >= 3) break;
      const label = m[1].replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().split(" ").slice(-6).join(" ");
      if (label) blocks.push({ id: newId(), type: "stat", value: m[2].replace(/\s/g, ""), label, citations: [n] });
    }
    const sentences = e.text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 0) {
      blocks.push({
        id: newId(),
        type: "list",
        title: e.sourceTitle,
        items: sentences.slice(0, 4).map((s) => s.split(/\s+/).slice(0, 12).join(" ")),
        citations: [n],
      });
    }
  });
  if (blocks.length === 0) {
    const paras = input.contextText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 4);
    paras.forEach((p, i) => blocks.push({ id: newId(), type: "list", title: `Phần ${i + 1}`, items: [p.split(/\s+/).slice(0, 14).join(" ")] }));
  }
  return infographicSchema.parse({
    title: (evs[0]?.sourceTitle ?? "Infographic").split(/\s+/).slice(0, 10).join(" "),
    subtitle: evs.length ? `Tổng hợp từ ${new Set(evs.map((e) => e.sourceTitle)).size} nguồn` : undefined,
    orientation,
    palette: "indigo",
    blocks,
    evidence: input.evidence,
  });
}

