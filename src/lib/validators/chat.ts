import { z } from "zod";
import { modelNameSchema } from "./model";

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const renameConversationSchema = z.object({
  title: z.string().trim().min(1, "Tên không được để trống").max(200),
});

export const chatScopeSchema = z.object({
  sourceIds: z.array(z.string().uuid()).max(500).optional(),
  connectionIds: z.array(z.string().uuid()).max(50).optional(),
  useWeb: z.boolean().optional(),
});

export const askSchema = z.object({
  question: z.string().trim().min(1, "Câu hỏi không được để trống").max(8000, "Câu hỏi quá dài"),
  scope: chatScopeSchema.default({}),
  model: modelNameSchema.optional(),
  /** Tạo lại câu trả lời cho câu hỏi cuối cùng (không lưu thêm tin nhắn người dùng). */
  regenerate: z.boolean().optional(),
});
export type AskInput = z.infer<typeof askSchema>;
