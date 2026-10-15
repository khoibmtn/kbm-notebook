/**
 * Kiểu + zod schema nội dung artifact (docs/03 "Studio / Artifact"), dùng chung client + server.
 * Trích dẫn trong nội dung là số `n` (1-based) trỏ vào `content.evidence[n - 1]`.
 */
import { z } from "zod";

export const ARTIFACT_TYPE_LIST = [
  "note",
  "report",
  "study_guide",
  "faq",
  "timeline",
  "mindmap",
  "slide_deck",
  "infographic",
  "quiz",
  "flashcards",
  "data_table",
] as const;
export type ArtifactTypeName = (typeof ARTIFACT_TYPE_LIST)[number];

export function isArtifactTypeName(v: string): v is ArtifactTypeName {
  return (ARTIFACT_TYPE_LIST as readonly string[]).includes(v);
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

export const evidenceLocatorSchema = z.object({
  page: z.number().optional(),
  slide: z.number().optional(),
  section: z.string().optional(),
  url: z.string().optional(),
  startChar: z.number().optional(),
  endChar: z.number().optional(),
});

export const evidenceSchema = z.object({
  id: z.string(),
  provider: z.enum(["local", "web", "notebooklm-bridge", "notebooklm-enterprise"]),
  sourceId: z.string().nullable(),
  sourceTitle: z.string(),
  locator: evidenceLocatorSchema,
  text: z.string(),
  score: z.number(),
  similarity: z.number().optional(),
});
export type ArtifactEvidence = z.infer<typeof evidenceSchema>;

const citationsSchema = z.array(z.number().int().min(1)).optional();

/* -------------------------------------------------------------------------- */
/* Tài liệu markdown: note | report | study_guide | faq | timeline             */
/* -------------------------------------------------------------------------- */

export const MARKDOWN_TYPES = ["note", "report", "study_guide", "faq", "timeline"] as const;
export type MarkdownArtifactType = (typeof MARKDOWN_TYPES)[number];
export function isMarkdownType(t: ArtifactTypeName): t is MarkdownArtifactType {
  return (MARKDOWN_TYPES as readonly string[]).includes(t);
}

export const markdownContentSchema = z.object({
  markdown: z.string().max(400_000),
  evidence: z.array(evidenceSchema).max(300),
});
export type MarkdownContent = z.infer<typeof markdownContentSchema>;

/* -------------------------------------------------------------------------- */
/* Quiz                                                                        */
/* -------------------------------------------------------------------------- */

export const quizQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["mcq", "tf", "short"]),
  stem: z.string().min(1),
  options: z.array(z.object({ key: z.string().min(1), text: z.string() })).optional(),
  /** mcq: key của đáp án đúng; tf: "true" | "false"; short: đáp án mẫu. */
  answer: z.string(),
  explanation: z.string(),
  citations: citationsSchema,
  difficulty: z.enum(["easy", "medium", "hard"]),
});
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const quizContentSchema = z
  .object({
    questions: z.array(quizQuestionSchema).min(1).max(200),
    evidence: z.array(evidenceSchema).max(300),
  })
  .superRefine((val, ctx) => {
    val.questions.forEach((q, i) => {
      if (q.type === "mcq") {
        const keys = (q.options ?? []).map((o) => o.key);
        if (keys.length < 2) ctx.addIssue({ code: "custom", path: ["questions", i, "options"], message: "Câu trắc nghiệm cần ít nhất 2 đáp án" });
        else if (!keys.includes(q.answer)) ctx.addIssue({ code: "custom", path: ["questions", i, "answer"], message: "Đáp án đúng phải là một trong các lựa chọn" });
      }
      if (q.type === "tf" && q.answer !== "true" && q.answer !== "false") {
        ctx.addIssue({ code: "custom", path: ["questions", i, "answer"], message: "Câu đúng/sai phải có đáp án true hoặc false" });
      }
    });
  });
export type QuizContent = z.infer<typeof quizContentSchema>;

/* -------------------------------------------------------------------------- */
/* Flashcards                                                                  */
/* -------------------------------------------------------------------------- */

export const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  hint: z.string().optional(),
  tags: z.array(z.string()).optional(),
  citations: citationsSchema,
});
export type Flashcard = z.infer<typeof flashcardSchema>;

export const flashcardsContentSchema = z.object({
  cards: z.array(flashcardSchema).min(1).max(500),
  evidence: z.array(evidenceSchema).max(300),
});
export type FlashcardsContent = z.infer<typeof flashcardsContentSchema>;

/* -------------------------------------------------------------------------- */
/* Mindmap                                                                     */
/* -------------------------------------------------------------------------- */

export type MindmapNode = {
  id: string;
  label: string;
  note?: string;
  citations?: number[];
  children: MindmapNode[];
};

export const mindmapNodeSchema: z.ZodType<MindmapNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    note: z.string().optional(),
    citations: citationsSchema,
    children: z.array(mindmapNodeSchema),
  }),
);

export const mindmapContentSchema = z.object({
  root: mindmapNodeSchema,
  evidence: z.array(evidenceSchema).max(300),
});
export type MindmapContent = z.infer<typeof mindmapContentSchema>;

/* -------------------------------------------------------------------------- */
/* Data table                                                                  */
/* -------------------------------------------------------------------------- */

export const dataTableContentSchema = z
  .object({
    columns: z.array(z.object({ key: z.string().min(1), label: z.string() })).min(1).max(40),
    rows: z
      .array(z.object({ cells: z.record(z.string(), z.string()), citations: citationsSchema }))
      .max(5000),
    evidence: z.array(evidenceSchema).max(300),
  })
  .superRefine((val, ctx) => {
    const keys = val.columns.map((c) => c.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["columns"], message: "Khoá cột bị trùng" });
  });
export type DataTableContent = z.infer<typeof dataTableContentSchema>;

/* -------------------------------------------------------------------------- */
/* Slide deck / infographic: engine riêng kiểm tra chi tiết; ở đây chỉ kiểm khung */
/* -------------------------------------------------------------------------- */

export const slideDeckEnvelopeSchema = z.looseObject({
  theme: z.looseObject({ palette: z.string(), font: z.string() }),
  slides: z.array(z.looseObject({ id: z.string().min(1) })).min(1).max(200),
  evidence: z.array(evidenceSchema).max(300),
});

export const infographicEnvelopeSchema = z.looseObject({
  title: z.string(),
  blocks: z.array(z.looseObject({ type: z.string() })).max(200),
  evidence: z.array(evidenceSchema).max(300),
});

/* -------------------------------------------------------------------------- */
/* Tra theo loại                                                               */
/* -------------------------------------------------------------------------- */

export type ArtifactContent =
  | MarkdownContent
  | QuizContent
  | FlashcardsContent
  | MindmapContent
  | DataTableContent
  | (z.infer<typeof slideDeckEnvelopeSchema>)
  | (z.infer<typeof infographicEnvelopeSchema>);

export function contentSchemaFor(type: ArtifactTypeName): z.ZodType<unknown> {
  switch (type) {
    case "note":
    case "report":
    case "study_guide":
    case "faq":
    case "timeline":
      return markdownContentSchema;
    case "quiz":
      return quizContentSchema;
    case "flashcards":
      return flashcardsContentSchema;
    case "mindmap":
      return mindmapContentSchema;
    case "data_table":
      return dataTableContentSchema;
    case "slide_deck":
      return slideDeckEnvelopeSchema;
    case "infographic":
      return infographicEnvelopeSchema;
  }
}

/** Parse nội dung theo loại; ném ZodError nếu sai. */
export function parseContent(type: ArtifactTypeName, content: unknown): ArtifactContent {
  return contentSchemaFor(type).parse(content) as ArtifactContent;
}

/** Tạo id ngắn cho phần tử nội dung (câu hỏi, thẻ, nút…). */
export function newItemId(prefix = "i"): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rnd}`;
}
