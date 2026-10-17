import { z } from "zod";
import { NOTEBOOK_COVER_COLORS } from "@/lib/notebook-colors";

export const memberRoleSchema = z.enum(["owner", "admin", "editor", "viewer"]);
export const assignableRoleSchema = z.enum(["admin", "editor", "viewer"]);
export const artifactVisibilitySchema = z.enum(["private", "notebook", "link", "public"]);

const coverColorSchema = z.enum(NOTEBOOK_COVER_COLORS);

export const createNotebookSchema = z.object({
  title: z.string().trim().min(1, "Tiêu đề không được để trống").max(120),
  description: z.string().trim().max(1000).nullish(),
  emoji: z.string().trim().min(1).max(16).nullish(),
  coverColor: coverColorSchema.nullish(),
});
export type CreateNotebookInput = z.infer<typeof createNotebookSchema>;

export const updateNotebookSchema = z
  .object({
    title: z.string().trim().min(1, "Tiêu đề không được để trống").max(120),
    description: z.string().trim().max(1000).nullable(),
    emoji: z.string().trim().min(1).max(16).nullable(),
    coverColor: coverColorSchema.nullable(),
    systemInstruction: z.string().max(8000).nullable(),
    allowWeb: z.boolean(),
    defaultArtifactVisibility: artifactVisibilitySchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Cần ít nhất một trường để cập nhật");
export type UpdateNotebookInput = z.infer<typeof updateNotebookSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ").max(254),
  role: assignableRoleSchema.default("viewer"),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({ role: assignableRoleSchema });
export const transferOwnershipSchema = z.object({ userId: z.string().uuid() });
