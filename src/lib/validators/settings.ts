import { z } from "zod";

export const updateAiSettingsSchema = z.object({
  /** Chuỗi = lưu khoá mới; null = xoá khoá; bỏ qua = giữ nguyên. */
  geminiApiKey: z.string().trim().min(10, "Khoá API quá ngắn").max(512).nullable().optional(),
  defaultChatModel: z.string().trim().max(120).nullable().optional(),
  defaultArtifactModel: z.string().trim().max(120).nullable().optional(),
  embeddingModel: z.string().trim().min(1).max(120).optional(),
});
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

export const testAiKeySchema = z.object({
  apiKey: z.string().trim().min(10).max(512).optional(),
});

export const updatePromptsSchema = z.object({
  prompts: z.record(
    z.string().max(64),
    z.object({
      system: z.string().max(8000).optional(),
      user: z.string().max(8000).optional(),
      options: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  locale: z.enum(["vi", "en"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
});

export const updateNotificationsSchema = z.object({ notifyEmail: z.boolean() });
