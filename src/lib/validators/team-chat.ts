import { z } from "zod";
import { isValidReactionEmoji } from "@/lib/team-chat/emoji";

export const MAX_MESSAGE_LENGTH = 8000;
export const MAX_ATTACHMENTS = 10;

const uuid = z.string().uuid();

export const createChannelSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("topic"), name: z.string().trim().min(1, "Tên chủ đề là bắt buộc").max(60) }),
  z.object({ type: z.literal("dm"), userId: uuid }),
]);
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const renameChannelSchema = z.object({ name: z.string().trim().min(1).max(60) });

export const readSchema = z.object({ messageId: uuid });
export const muteSchema = z.object({ muted: z.boolean().default(true) });

export const messageRefsSchema = z
  .object({
    artifactId: uuid.optional(),
    sourceId: uuid.optional(),
    noteId: uuid.optional(),
  })
  .refine((r) => [r.artifactId, r.sourceId, r.noteId].filter(Boolean).length <= 1, "Chỉ được đính kèm một tham chiếu");

export const postMessageSchema = z.object({
  kind: z.enum(["text", "artifact_ref", "source_ref", "note_ref"]).default("text"),
  content: z.string().max(MAX_MESSAGE_LENGTH).default(""),
  replyToId: uuid.optional(),
  mentions: z.array(uuid).max(50).optional(),
  refs: messageRefsSchema.optional(),
  attachmentFileIds: z.array(uuid).max(MAX_ATTACHMENTS).optional(),
});
export type PostMessageInput = z.infer<typeof postMessageSchema>;

export const editMessageSchema = z.object({
  content: z.string().max(MAX_MESSAGE_LENGTH),
  mentions: z.array(uuid).max(50).optional(),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(32).refine(isValidReactionEmoji, "Emoji không hợp lệ"),
});

export const listMessagesQuery = z
  .object({
    before: uuid.optional(),
    after: uuid.optional(),
    around: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((q) => [q.before, q.after, q.around].filter(Boolean).length <= 1, "Chỉ dùng một trong before/after/around");

export const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const toSourceSchema = z.object({ attachmentId: uuid.optional() });

export const notesFromMessagesSchema = z.object({
  channelId: uuid.optional(),
  messageIds: z.array(uuid).min(1).max(200),
  title: z.string().trim().min(1).max(200).optional(),
  timeZone: z.string().max(64).optional(),
});

export const notificationsQuery = z.object({
  unread: z
    .enum(["1", "0", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const markNotificationsSchema = z
  .object({ ids: z.array(uuid).min(1).max(200).optional(), all: z.boolean().optional() })
  .refine((v) => v.all === true || (v.ids && v.ids.length > 0), "Cần ids hoặc all");
