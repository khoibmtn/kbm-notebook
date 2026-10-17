import { z } from "zod";

export const noteVisibilitySchema = z.enum(["shared", "private"]);

const MAX_NOTE_CHARS = 500_000;

export const createNoteSchema = z.object({
  title: z.string().trim().max(200).default(""),
  contentMd: z.string().max(MAX_NOTE_CHARS, "Ghi chú quá dài").default(""),
  visibility: noteVisibilitySchema.default("shared"),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({
    title: z.string().trim().max(200),
    contentMd: z.string().max(MAX_NOTE_CHARS, "Ghi chú quá dài"),
    visibility: noteVisibilitySchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Cần ít nhất một trường để cập nhật");
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

export const listNotesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
});
