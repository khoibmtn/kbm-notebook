import "server-only";
import { z } from "zod";
import { ARTIFACT_TYPE_LIST, type ArtifactTypeName } from "@/lib/artifacts/content";

/**
 * Schema nội dung artifact (docs/03) + schema ĐẦU RA của model cho từng loại.
 * - Schema nội dung (`contentSchemaFor`, ...): dạng lưu trong `artifact_versions.content`.
 * - Schema đầu ra (`*OutputSchema`): dạng model sinh (trích dẫn là số theo bằng chứng đánh số gốc,
 *   mindmap là danh sách phẳng nút→cha để tránh schema đệ quy); generator chuyển sang dạng lưu.
 */
export * from "@/lib/artifacts/content";

/** Chuyển zod → JSON Schema (draft-07) để gửi cho `generateText({ jsonSchema })`. */
export function toJsonSchema(schema: z.ZodType): object {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

const cites = z.array(z.number().int()).describe("Số thứ tự [n] của các nguồn được dùng (chỉ số có trong danh sách nguồn)");

export const docOutputSchema = z.object({
  title: z.string().describe("Tiêu đề ngắn gọn cho tài liệu"),
  markdown: z.string().min(1).describe("Toàn bộ nội dung dạng Markdown, chèn trích dẫn [n] ngay sau câu/ý có căn cứ"),
});
export type DocOutput = z.infer<typeof docOutputSchema>;

export const quizOutputSchema = z.object({
  title: z.string(),
  questions: z
    .array(
      z.object({
        type: z.enum(["mcq", "tf", "short"]),
        stem: z.string().describe("Nội dung câu hỏi"),
        options: z
          .array(z.object({ key: z.string().describe("A, B, C, D…"), text: z.string() }))
          .optional()
          .describe("Chỉ cho câu trắc nghiệm (mcq): 3–5 lựa chọn"),
        answer: z.string().describe("mcq: key đáp án đúng (vd A); tf: 'true' hoặc 'false'; short: đáp án mẫu ngắn"),
        explanation: z.string().describe("Giải thích ngắn gọn vì sao đúng"),
        citations: cites,
        difficulty: z.enum(["easy", "medium", "hard"]),
      }),
    )
    .min(1),
});
export type QuizOutput = z.infer<typeof quizOutputSchema>;

export const flashcardsOutputSchema = z.object({
  title: z.string(),
  cards: z
    .array(
      z.object({
        front: z.string(),
        back: z.string(),
        hint: z.string().optional(),
        tags: z.array(z.string()).optional(),
        citations: cites,
      }),
    )
    .min(1),
});
export type FlashcardsOutput = z.infer<typeof flashcardsOutputSchema>;

export const mindmapOutputSchema = z.object({
  title: z.string(),
  nodes: z
    .array(
      z.object({
        id: z.string().describe("Mã duy nhất của nút, vd n1, n2…"),
        parentId: z.string().nullable().describe("Mã nút cha; null cho đúng một nút gốc"),
        label: z.string().describe("Nhãn ngắn (≤ 6 từ)"),
        note: z.string().optional(),
        citations: cites.optional(),
      }),
    )
    .min(2),
});
export type MindmapOutput = z.infer<typeof mindmapOutputSchema>;

export const dataTableOutputSchema = z.object({
  title: z.string(),
  columns: z.array(z.object({ key: z.string().describe("Khoá cột không dấu, vd ten_du_an"), label: z.string() })).min(1),
  rows: z.array(
    z.object({
      cells: z.array(z.string()).describe("Giá trị theo đúng thứ tự cột; chuỗi rỗng nếu nguồn không có"),
      citations: cites,
    }),
  ),
});
export type DataTableOutput = z.infer<typeof dataTableOutputSchema>;

/** Loại do framework sinh bằng generator nội bộ (khác slide_deck/infographic của engine riêng). */
export const INTERNAL_GENERATOR_TYPES: readonly ArtifactTypeName[] = ARTIFACT_TYPE_LIST.filter(
  (t) => t !== "slide_deck" && t !== "infographic",
);
