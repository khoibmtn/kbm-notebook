import { z } from "zod";

export const sourceVisibilitySchema = z.enum(["shared", "private"]);

const MAX_PASTED_CHARS = 2_000_000;

const urlSchema = z
  .string()
  .trim()
  .min(1, "URL không được để trống")
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "URL phải bắt đầu bằng http:// hoặc https://");

/** `POST /sources` — thêm nguồn từ URL hoặc văn bản dán. */
export const createSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    url: urlSchema,
    visibility: sourceVisibilitySchema.default("shared"),
  }),
  z.object({
    kind: z.literal("text"),
    title: z.string().trim().min(1, "Tiêu đề không được để trống").max(200),
    text: z.string().trim().min(1, "Nội dung không được để trống").max(MAX_PASTED_CHARS, "Nội dung quá dài"),
    visibility: sourceVisibilitySchema.default("shared"),
  }),
]);
export type CreateSourceInput = z.infer<typeof createSourceSchema>;

export const updateSourceSchema = z
  .object({
    title: z.string().trim().min(1, "Tên không được để trống").max(200),
    visibility: sourceVisibilitySchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Cần ít nhất một trường để cập nhật");
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;

export const searchSchema = z.object({
  query: z.string().trim().min(1, "Câu truy vấn không được để trống").max(2000),
  sourceIds: z.array(z.string().uuid()).max(200).optional(),
  topK: z.number().int().min(1).max(50).optional(),
});
export type SearchInput = z.infer<typeof searchSchema>;
