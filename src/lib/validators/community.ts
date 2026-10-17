import { z } from "zod";
import { ARTIFACT_TYPE_LIST } from "@/lib/artifacts/content";
import { SEARCH_TYPES, SLUG_MAX, SLUG_MIN, SLUG_RE } from "@/lib/community";

const uuid = z.string().uuid();

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(SLUG_MIN, `Đường dẫn cần ít nhất ${SLUG_MIN} ký tự`)
  .max(SLUG_MAX)
  .regex(SLUG_RE, "Chỉ dùng chữ thường không dấu, số và dấu gạch ngang");

const page = z.coerce.number().int().min(1).max(500).default(1);
const q = z.string().trim().max(200).optional();

export const exploreArtifactsQuery = z.object({
  q,
  type: z.enum(ARTIFACT_TYPE_LIST).optional(),
  sort: z.enum(["new", "likes"]).default("new"),
  page,
});
export const exploreNotebooksQuery = z.object({ q, page });
export const exploreGroupsQuery = z.object({ q, page });

export const commentSchema = z.object({ body: z.string().trim().min(1, "Bình luận không được để trống").max(2000, "Bình luận tối đa 2000 ký tự") });
export const commentsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });

export const publishNotebookSchema = z.object({
  isPublic: z.boolean(),
  slug: slugSchema.optional(),
});

export const joinRequestSchema = z.object({ message: z.string().trim().max(500).optional() });

export const createGroupSchema = z.object({
  name: z.string().trim().min(2, "Tên nhóm cần ít nhất 2 ký tự").max(80),
  slug: slugSchema.optional(),
  description: z.string().trim().max(1000).nullish(),
  visibility: z.enum(["private", "public"]).default("public"),
});
export const updateGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(1000).nullable(),
    visibility: z.enum(["private", "public"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Cần ít nhất một trường để cập nhật");
export const addGroupMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ").max(254),
  role: z.enum(["admin", "member"]).default("member"),
});
export const updateGroupMemberSchema = z.object({ role: z.enum(["admin", "member"]) });
export const linkGroupNotebookSchema = z.object({ notebookId: uuid });

export const globalSearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.enum(SEARCH_TYPES)).max(SEARCH_TYPES.length)),
  notebookId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(30).default(8),
});
