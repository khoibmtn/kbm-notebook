import { z } from "zod";
import type { Evidence } from "@/server/knowledge/providers/types";
import { chartSchema, evidenceSchema, SLIDE_PALETTES, type SlideChart } from "../slides/types";
import { ICON_NAMES, type IconName } from "./icons";

/** Hợp đồng dữ liệu infographic (docs/03). Không import "server-only" để component client dùng chung. */

export type InfographicPalette = (typeof SLIDE_PALETTES)[number];
export const INFOGRAPHIC_BLOCK_TYPES = ["stat", "list", "process", "compare", "icon_text", "chart", "quote"] as const;
export type InfographicBlockType = (typeof INFOGRAPHIC_BLOCK_TYPES)[number];

type BlockBase = {
  id: string;
  /** Số thứ tự bằng chứng (1-based) trong `InfographicContent.evidence`. */
  citations?: number[];
  /** Số cột chiếm trong lưới (tuỳ chọn; mặc định theo loại khối). */
  span?: number;
};

export type InfographicBlock =
  | (BlockBase & { type: "stat"; value: string; label: string; caption?: string; icon?: IconName })
  | (BlockBase & { type: "list"; title: string; items: string[]; ordered?: boolean })
  | (BlockBase & { type: "process"; title: string; steps: { title: string; description?: string }[] })
  | (BlockBase & {
      type: "compare";
      title: string;
      left: { heading: string; items: string[] };
      right: { heading: string; items: string[] };
    })
  | (BlockBase & { type: "icon_text"; icon: IconName; title: string; text: string })
  | (BlockBase & { type: "chart"; title: string; chart: SlideChart })
  | (BlockBase & { type: "quote"; text: string; attribution?: string });

export type InfographicContent = {
  title: string;
  subtitle?: string;
  orientation: "portrait" | "landscape";
  palette: InfographicPalette;
  blocks: InfographicBlock[];
  imageFileId?: string;
  evidence: Evidence[];
};

// ---------------------------------------------------------------- zod

const iconSchema = z.enum(ICON_NAMES as [IconName, ...IconName[]]);
const base = { id: z.string().min(1), citations: z.array(z.number().int().positive()).optional(), span: z.number().int().min(1).max(4).optional() };
const side = z.object({ heading: z.string(), items: z.array(z.string()) });

export const infographicBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("stat"), value: z.string(), label: z.string(), caption: z.string().optional(), icon: iconSchema.optional() }),
  z.object({ ...base, type: z.literal("list"), title: z.string(), items: z.array(z.string()), ordered: z.boolean().optional() }),
  z.object({
    ...base,
    type: z.literal("process"),
    title: z.string(),
    steps: z.array(z.object({ title: z.string(), description: z.string().optional() })),
  }),
  z.object({ ...base, type: z.literal("compare"), title: z.string(), left: side, right: side }),
  z.object({ ...base, type: z.literal("icon_text"), icon: iconSchema, title: z.string(), text: z.string() }),
  z.object({ ...base, type: z.literal("chart"), title: z.string(), chart: chartSchema }),
  z.object({ ...base, type: z.literal("quote"), text: z.string(), attribution: z.string().optional() }),
]);

export const infographicSchema: z.ZodType<InfographicContent> = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  orientation: z.enum(["portrait", "landscape"]),
  palette: z.enum(SLIDE_PALETTES),
  blocks: z.array(infographicBlockSchema),
  imageFileId: z.string().optional(),
  evidence: z.array(evidenceSchema),
});

// ---------------------------------------------------------------- JSON Schema cho mô hình

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const sideJson = {
  type: "object",
  properties: { heading: str, items: strArr },
  required: ["heading", "items"],
} as const;

/** Một khối do mô hình sinh: object phẳng với `type` quyết định trường nào được dùng (không có `id`). */
export const infographicBlockJsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: [...INFOGRAPHIC_BLOCK_TYPES] },
    value: { ...str, description: "stat: con số nguyên văn từ nguồn, kèm đơn vị (vd. 42%)" },
    label: str,
    caption: str,
    icon: { type: "string", enum: [...ICON_NAMES] },
    title: str,
    items: strArr,
    ordered: { type: "boolean" },
    steps: {
      type: "array",
      items: { type: "object", properties: { title: str, description: str }, required: ["title"] },
    },
    left: sideJson,
    right: sideJson,
    text: str,
    chart: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bar", "line", "pie"] },
        labels: strArr,
        series: {
          type: "array",
          items: {
            type: "object",
            properties: { name: str, values: { type: "array", items: { type: "number" } } },
            required: ["name", "values"],
          },
        },
      },
      required: ["type", "labels", "series"],
    },
    attribution: str,
    citations: { type: "array", items: { type: "integer" }, description: "Số [n] của bằng chứng cho khối này" },
  },
  required: ["type", "citations"],
} as const;

/** JSON Schema cho `generateText({ jsonSchema })` — KHÔNG có `evidence`. */
export const infographicJsonSchema = {
  type: "object",
  properties: {
    title: str,
    subtitle: str,
    palette: { type: "string", enum: [...SLIDE_PALETTES] },
    blocks: { type: "array", minItems: 1, items: infographicBlockJsonSchema },
  },
  required: ["title", "blocks"],
} as const;

export const INFOGRAPHIC_SIZE = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
} as const;
