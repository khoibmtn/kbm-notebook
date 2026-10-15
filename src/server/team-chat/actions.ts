import "server-only";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { canViewArtifact } from "@/server/auth/permissions";
import { emitToChannel } from "@/server/chat/realtime";
import { db } from "@/server/db";
import {
  artifacts,
  channelMembers,
  files,
  messageAttachments,
  messageReactions,
  notebookMembers,
  notes,
  sources,
  teamMessages,
  type TeamMessageContentJson,
} from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { hasRole } from "@/lib/roles";
import { toPlainPreview } from "@/lib/team-chat/markdown";
import { parseMentionIds } from "@/lib/team-chat/mentions";
import type { AttachmentDTO, MessageDTO, ReactionDTO, RefType } from "@/lib/team-chat/types";
import type { PostMessageInput } from "@/lib/validators/team-chat";
import type { ChannelAccess } from "./access";
import { notifyForMessage } from "./notify";
import { getMessageDTO, toMessageDTOs, type TeamMessageRow } from "./serialize";

type Actor = { id: string; name: string };

const MAX_REACTION_KINDS = 20;

/* ------------------------------ Tiện ích ------------------------------ */

async function loadMessage(access: ChannelAccess, messageId: string, opts: { allowRecalled?: boolean } = {}): Promise<TeamMessageRow> {
  const [row] = await db
    .select()
    .from(teamMessages)
    .where(and(eq(teamMessages.id, messageId), eq(teamMessages.channelId, access.channel.id), isNull(teamMessages.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.notFound("Không tìm thấy tin nhắn");
  if (row.recalledAt && !opts.allowRecalled) throw ApiError.conflict("Tin nhắn đã được thu hồi", "message_recalled");
  return row;
}

/** Người có thể được nhắc tên trong kênh: DM = hai người; kênh khác = mọi thành viên notebook. */
async function mentionableIds(access: ChannelAccess): Promise<Set<string>> {
  if (access.channel.type === "dm") {
    const rows = await db
      .select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(eq(channelMembers.channelId, access.channel.id));
    return new Set(rows.map((r) => r.userId));
  }
  const rows = await db
    .select({ userId: notebookMembers.userId })
    .from(notebookMembers)
    .where(eq(notebookMembers.notebookId, access.channel.notebookId));
  return new Set(rows.map((r) => r.userId));
}

function resolveMentions(content: string, extra: string[] | undefined, allowed: Set<string>, senderId: string): string[] {
  const ids = new Set<string>();
  for (const id of [...parseMentionIds(content), ...(extra ?? []).map((x) => x.toLowerCase())]) {
    if (allowed.has(id) && id !== senderId) ids.add(id);
  }
  return [...ids];
}

function previewFor(content: string, attachments: { name: string }[], refTitle?: string): string {
  const text = toPlainPreview(content);
  if (text) return text;
  if (refTitle) return refTitle.slice(0, 140);
  if (attachments[0]) return `📎 ${attachments[0].name}`.slice(0, 140);
  return "";
}

function emitMessage(event: "message:new" | "message:edit" | "message:recall", access: ChannelAccess, message: MessageDTO) {
  emitToChannel(access.channel.id, event, {
    notebookId: access.channel.notebookId,
    channelId: access.channel.id,
    message,
  });
}

/* ------------------------------ Gửi tin ------------------------------ */

type RefInfo = { type: RefType; id: string; title: string };

async function validateRef(userId: string, notebookId: string, input: PostMessageInput): Promise<RefInfo | null> {
  const wantsType: RefType | null =
    input.kind === "artifact_ref" ? "artifact" : input.kind === "source_ref" ? "source" : input.kind === "note_ref" ? "note" : null;
  const r = input.refs ?? {};
  const given: { type: RefType; id: string }[] = [];
  if (r.artifactId) given.push({ type: "artifact", id: r.artifactId });
  if (r.sourceId) given.push({ type: "source", id: r.sourceId });
  if (r.noteId) given.push({ type: "note", id: r.noteId });
  if (wantsType === null) {
    if (given.length > 0) throw ApiError.badRequest("Tin nhắn văn bản không kèm tham chiếu; hãy dùng kind artifact_ref/source_ref/note_ref");
    return null;
  }
  const ref = given[0];
  if (!ref || ref.type !== wantsType) throw ApiError.badRequest("Thiếu tham chiếu tương ứng với loại tin nhắn");

  const notFound = () => ApiError.notFound("Không tìm thấy mục được chia sẻ");
  const isPrivate = () => ApiError.badRequest("Không thể chia sẻ mục riêng tư vào chat", "ref_private");
  if (ref.type === "artifact") {
    const [a] = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, ref.id), eq(artifacts.notebookId, notebookId), isNull(artifacts.deletedAt)))
      .limit(1);
    if (!a || !(await canViewArtifact(userId, a))) throw notFound();
    if (a.visibility === "private") throw isPrivate();
    return { type: "artifact", id: a.id, title: a.title };
  }
  if (ref.type === "source") {
    const [s] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, ref.id), eq(sources.notebookId, notebookId), isNull(sources.deletedAt)))
      .limit(1);
    if (!s || (s.visibility === "private" && s.createdBy !== userId)) throw notFound();
    if (s.visibility === "private") throw isPrivate();
    return { type: "source", id: s.id, title: s.title };
  }
  const [n] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, ref.id), eq(notes.notebookId, notebookId), isNull(notes.deletedAt)))
    .limit(1);
  if (!n || (n.visibility === "private" && n.createdBy !== userId)) throw notFound();
  if (n.visibility === "private") throw isPrivate();
  return { type: "note", id: n.id, title: n.title };
}

export async function createMessage(access: ChannelAccess, actor: Actor, input: PostMessageInput): Promise<MessageDTO> {
  const { channel } = access;
  const content = input.content.trim();

  const ref = await validateRef(actor.id, channel.notebookId, input);

  // Tệp đính kèm: phải do chính người gửi tải lên và chưa gắn vào tin nào.
  const fileIds = [...new Set(input.attachmentFileIds ?? [])];
  let fileRows: (typeof files.$inferSelect)[] = [];
  if (fileIds.length > 0) {
    fileRows = await db.select().from(files).where(and(inArray(files.id, fileIds), eq(files.ownerId, actor.id)));
    if (fileRows.length !== fileIds.length) throw ApiError.badRequest("Tệp đính kèm không hợp lệ", "invalid_attachment");
    const used = await db
      .select({ fileId: messageAttachments.fileId })
      .from(messageAttachments)
      .where(inArray(messageAttachments.fileId, fileIds))
      .limit(1);
    if (used.length > 0) throw ApiError.badRequest("Tệp đã được đính kèm vào tin nhắn khác", "attachment_used");
  }

  if (!content && !ref && fileRows.length === 0) throw ApiError.badRequest("Tin nhắn trống", "empty_message");

  let replyToId: string | null = null;
  if (input.replyToId) {
    const [target] = await db
      .select({ id: teamMessages.id })
      .from(teamMessages)
      .where(and(eq(teamMessages.id, input.replyToId), eq(teamMessages.channelId, channel.id), isNull(teamMessages.deletedAt)))
      .limit(1);
    if (!target) throw ApiError.badRequest("Tin nhắn được trả lời không tồn tại trong kênh này", "invalid_reply");
    replyToId = target.id;
  }

  const allowed = await mentionableIds(access);
  const mentions = resolveMentions(content, input.mentions, allowed, actor.id);

  const kind = ref ? (`${ref.type}_ref` as "artifact_ref" | "source_ref" | "note_ref") : fileRows.length > 0 ? "file" : "text";
  const contentJson: TeamMessageContentJson = {};
  if (mentions.length > 0) contentJson.mentions = mentions;
  if (ref) contentJson.refs = [ref];
  if (fileRows.length > 0) {
    contentJson.attachments = fileRows.map((f) => ({ fileId: f.id, name: f.originalName, mime: f.mime, size: f.sizeBytes }));
  }

  const created = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(teamMessages)
      .values({
        channelId: channel.id,
        senderId: actor.id,
        kind,
        content,
        contentJson: Object.keys(contentJson).length > 0 ? contentJson : null,
        replyToId,
      })
      .returning();
    if (fileRows.length > 0) {
      await tx.insert(messageAttachments).values(
        fileRows.map((f) => ({ messageId: m.id, fileId: f.id, name: f.originalName, mime: f.mime, size: f.sizeBytes })),
      );
    }
    // Người gửi coi như đã đọc đến tin này.
    await tx
      .update(channelMembers)
      .set({ lastReadAt: m.createdAt, lastReadMessageId: m.id })
      .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.userId, actor.id)));
    return m;
  });

  const [dto] = await toMessageDTOs([created], { viewerId: actor.id, notebookId: channel.notebookId });
  emitMessage("message:new", access, dto);
  emitToChannel(channel.id, "read", {
    notebookId: channel.notebookId,
    channelId: channel.id,
    userId: actor.id,
    messageId: created.id,
    lastReadAt: created.createdAt.toISOString(),
  });

  // Thông báo (không để lỗi thông báo làm hỏng việc gửi tin).
  try {
    let dmRecipients: string[] = [];
    if (channel.type === "dm") {
      const rows = await db
        .select({ userId: channelMembers.userId, muted: channelMembers.muted })
        .from(channelMembers)
        .where(eq(channelMembers.channelId, channel.id));
      dmRecipients = rows.filter((r) => r.userId !== actor.id && !r.muted).map((r) => r.userId);
    }
    await notifyForMessage({
      notebookId: channel.notebookId,
      channelId: channel.id,
      channelType: channel.type,
      channelName: channel.type === "dm" ? null : channel.name,
      messageId: created.id,
      senderId: actor.id,
      senderName: actor.name,
      preview: previewFor(content, dto.attachments, ref?.title),
      mentioned: mentions,
      dmRecipients,
    });
  } catch (err) {
    console.error("[team-chat] notify failed", err);
  }
  return dto;
}

/* ------------------------------ Sửa / xoá / thu hồi ------------------------------ */

export async function editMessage(
  access: ChannelAccess,
  actor: Actor,
  messageId: string,
  input: { content: string; mentions?: string[] },
): Promise<MessageDTO> {
  const row = await loadMessage(access, messageId);
  if (row.senderId !== actor.id) throw ApiError.forbidden("Chỉ sửa được tin nhắn của chính bạn");
  if (row.kind !== "text" && row.kind !== "file") throw ApiError.badRequest("Loại tin nhắn này không sửa được", "not_editable");

  const content = input.content.trim();
  const [{ n: attachmentCount }] = await db
    .select({ n: count() })
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, row.id));
  if (!content && Number(attachmentCount) === 0) throw ApiError.badRequest("Tin nhắn trống", "empty_message");

  if (content === row.content) {
    const dto = await getMessageDTO(row.id, { viewerId: actor.id, notebookId: access.channel.notebookId });
    if (!dto) throw ApiError.notFound("Không tìm thấy tin nhắn");
    return dto;
  }

  const allowed = await mentionableIds(access);
  const mentions = resolveMentions(content, input.mentions, allowed, actor.id);
  const before = new Set(row.contentJson?.mentions ?? []);
  const contentJson: TeamMessageContentJson = { ...(row.contentJson ?? {}) };
  if (mentions.length > 0) contentJson.mentions = mentions;
  else delete contentJson.mentions;

  const [updated] = await db
    .update(teamMessages)
    .set({ content, contentJson: Object.keys(contentJson).length > 0 ? contentJson : null, editedAt: new Date() })
    .where(eq(teamMessages.id, row.id))
    .returning();
  const [dto] = await toMessageDTOs([updated], { viewerId: actor.id, notebookId: access.channel.notebookId });
  emitMessage("message:edit", access, dto);

  const fresh = mentions.filter((id) => !before.has(id));
  if (fresh.length > 0) {
    try {
      await notifyForMessage({
        notebookId: access.channel.notebookId,
        channelId: access.channel.id,
        channelType: access.channel.type,
        channelName: access.channel.type === "dm" ? null : access.channel.name,
        messageId: row.id,
        senderId: actor.id,
        senderName: actor.name,
        preview: previewFor(content, dto.attachments),
        mentioned: fresh,
        dmRecipients: [],
      });
    } catch (err) {
      console.error("[team-chat] notify failed", err);
    }
  }
  return dto;
}

/** Xoá mềm: ẩn với mọi người. Chỉ tin của chính mình, hoặc admin+ của notebook. */
export async function deleteMessage(access: ChannelAccess, actor: Actor, messageId: string): Promise<void> {
  const row = await loadMessage(access, messageId, { allowRecalled: true });
  if (row.senderId !== actor.id && !hasRole(access.role, "admin")) throw ApiError.forbidden();
  await db.update(teamMessages).set({ deletedAt: new Date(), pinned: false }).where(eq(teamMessages.id, row.id));
  emitToChannel(access.channel.id, "message:delete", {
    notebookId: access.channel.notebookId,
    channelId: access.channel.id,
    messageId: row.id,
  });
}

/**
 * Thu hồi kiểu Zalo: chỉ người gửi; nội dung/tệp/reaction bị gỡ khỏi DB, tin còn lại như một dấu "đã thu hồi".
 */
export async function recallMessage(access: ChannelAccess, actor: Actor, messageId: string): Promise<MessageDTO> {
  const row = await loadMessage(access, messageId, { allowRecalled: true });
  if (row.senderId !== actor.id) throw ApiError.forbidden("Chỉ thu hồi được tin nhắn của chính bạn");
  if (!row.recalledAt) {
    await db.transaction(async (tx) => {
      await tx
        .update(teamMessages)
        .set({ recalledAt: new Date(), content: "", contentJson: null, pinned: false })
        .where(eq(teamMessages.id, row.id));
      await tx.delete(messageAttachments).where(eq(messageAttachments.messageId, row.id));
      await tx.delete(messageReactions).where(eq(messageReactions.messageId, row.id));
    });
  }
  const dto = await getMessageDTO(row.id, { viewerId: actor.id, notebookId: access.channel.notebookId });
  if (!dto) throw ApiError.notFound("Không tìm thấy tin nhắn");
  emitMessage("message:recall", access, dto);
  return dto;
}

/* ------------------------------ Reaction / ghim ------------------------------ */

export async function aggregateReactions(messageId: string): Promise<ReactionDTO[]> {
  const rows = await db
    .select({ emoji: messageReactions.emoji, userId: messageReactions.userId })
    .from(messageReactions)
    .where(eq(messageReactions.messageId, messageId))
    .orderBy(messageReactions.createdAt);
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.emoji, [...(map.get(r.emoji) ?? []), r.userId]);
  return [...map.entries()].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }));
}

export async function toggleReaction(
  access: ChannelAccess,
  actor: Actor,
  messageId: string,
  emoji: string,
): Promise<{ reactions: ReactionDTO[]; active: boolean }> {
  const row = await loadMessage(access, messageId);
  const existing = await db
    .select({ one: sql`1` })
    .from(messageReactions)
    .where(and(eq(messageReactions.messageId, row.id), eq(messageReactions.userId, actor.id), eq(messageReactions.emoji, emoji)))
    .limit(1);
  let active: boolean;
  if (existing.length > 0) {
    await db
      .delete(messageReactions)
      .where(and(eq(messageReactions.messageId, row.id), eq(messageReactions.userId, actor.id), eq(messageReactions.emoji, emoji)));
    active = false;
  } else {
    const kinds = await db
      .select({ emoji: messageReactions.emoji })
      .from(messageReactions)
      .where(eq(messageReactions.messageId, row.id))
      .groupBy(messageReactions.emoji);
    if (kinds.length >= MAX_REACTION_KINDS && !kinds.some((k) => k.emoji === emoji)) {
      throw ApiError.badRequest("Tin nhắn đã có quá nhiều loại cảm xúc", "too_many_reactions");
    }
    await db.insert(messageReactions).values({ messageId: row.id, userId: actor.id, emoji }).onConflictDoNothing();
    active = true;
  }
  const reactions = await aggregateReactions(row.id);
  emitToChannel(access.channel.id, "message:reaction", {
    notebookId: access.channel.notebookId,
    channelId: access.channel.id,
    messageId: row.id,
    reactions,
  });
  return { reactions, active };
}

/** Ghim/bỏ ghim (editor+; kiểm tra vai trò ở route). */
export async function togglePin(access: ChannelAccess, actor: Actor, messageId: string): Promise<MessageDTO> {
  const row = await loadMessage(access, messageId);
  await db.update(teamMessages).set({ pinned: !row.pinned }).where(eq(teamMessages.id, row.id));
  const dto = await getMessageDTO(row.id, { viewerId: actor.id, notebookId: access.channel.notebookId });
  if (!dto) throw ApiError.notFound("Không tìm thấy tin nhắn");
  emitToChannel(access.channel.id, "message:pin", {
    notebookId: access.channel.notebookId,
    channelId: access.channel.id,
    messageId: row.id,
    pinned: dto.pinned,
    message: dto,
  });
  return dto;
}

/* ------------------------------ Đã đọc / tắt tiếng ------------------------------ */

/**
 * Đặt mốc đã đọc của user = thời điểm tin `messageId` (không lùi). Bỏ trống messageId = tin mới nhất.
 * Đồng thời đánh dấu đã đọc các thông báo mention/dm thuộc kênh này, tới mốc đó.
 */
export async function markChannelRead(
  access: ChannelAccess,
  userId: string,
  messageId?: string | null,
): Promise<{ lastReadAt: string | null; messageId: string | null }> {
  const { channel } = access;
  const rows = messageId
    ? await db
        .select({ id: teamMessages.id, createdAt: teamMessages.createdAt })
        .from(teamMessages)
        .where(and(eq(teamMessages.id, messageId), eq(teamMessages.channelId, channel.id)))
        .limit(1)
    : await db
        .select({ id: teamMessages.id, createdAt: teamMessages.createdAt })
        .from(teamMessages)
        .where(and(eq(teamMessages.channelId, channel.id), isNull(teamMessages.deletedAt)))
        .orderBy(sql`${teamMessages.createdAt} desc, ${teamMessages.id} desc`)
        .limit(1);
  const target = rows[0];
  if (!target) {
    if (messageId) throw ApiError.badRequest("Tin nhắn không thuộc kênh này", "invalid_message");
    return { lastReadAt: null, messageId: null };
  }

  // Chỉ tiến, không lùi (so sánh ở SQL để giữ độ chính xác microsecond).
  await db.execute(sql`
    update channel_members cm
    set last_read_at = tm.created_at, last_read_message_id = tm.id
    from team_messages tm
    where tm.id = ${target.id}
      and cm.channel_id = ${channel.id}
      and cm.user_id = ${userId}
      and (cm.last_read_at is null or cm.last_read_at < tm.created_at)
  `);
  await db.execute(sql`
    update notifications n
    set read_at = now()
    from team_messages tm
    where n.user_id = ${userId}
      and n.read_at is null
      and n.type in ('mention', 'dm')
      and n.data->>'channelId' = ${channel.id}
      and tm.id::text = n.data->>'messageId'
      and tm.created_at <= (select created_at from team_messages where id = ${target.id})
  `);

  const [cm] = await db
    .select({ lastReadAt: channelMembers.lastReadAt, lastReadMessageId: channelMembers.lastReadMessageId })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.userId, userId)))
    .limit(1);
  const lastReadAt = cm?.lastReadAt ? cm.lastReadAt.toISOString() : target.createdAt.toISOString();
  emitToChannel(channel.id, "read", {
    notebookId: channel.notebookId,
    channelId: channel.id,
    userId,
    messageId: cm?.lastReadMessageId ?? target.id,
    lastReadAt,
  });
  return { lastReadAt, messageId: cm?.lastReadMessageId ?? target.id };
}

export async function setChannelMuted(access: ChannelAccess, userId: string, muted: boolean): Promise<void> {
  await db
    .update(channelMembers)
    .set({ muted })
    .where(and(eq(channelMembers.channelId, access.channel.id), eq(channelMembers.userId, userId)));
}

/* ------------------------------ Tệp đính kèm ------------------------------ */

/* ------------------------------ Chuyển vào Nguồn ------------------------------ */

export type ToSourceResult = { id: string; title: string; status: string; existing: boolean; attachmentId: string };

/** Sao chép tệp đính kèm của tin nhắn thành `sources(kind='chat_attachment')` và xếp job `ingest_source`. */
export async function attachmentsToSources(
  access: ChannelAccess,
  actor: Actor,
  messageId: string,
  attachmentId?: string,
): Promise<ToSourceResult[]> {
  const row = await loadMessage(access, messageId);
  const atts: AttachmentDTO[] = (
    await db.select().from(messageAttachments).where(eq(messageAttachments.messageId, row.id))
  ).map((a) => ({ id: a.id, fileId: a.fileId, name: a.name, mime: a.mime, size: a.size }));
  const picked = attachmentId ? atts.filter((a) => a.id === attachmentId) : atts;
  if (picked.length === 0) throw ApiError.badRequest("Tin nhắn không có tệp đính kèm phù hợp", "no_attachment");

  const out: ToSourceResult[] = [];
  for (const a of picked) {
    const [dup] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.notebookId, access.channel.notebookId), eq(sources.fileId, a.fileId), isNull(sources.deletedAt)))
      .limit(1);
    if (dup) {
      out.push({ id: dup.id, title: dup.title, status: dup.status, existing: true, attachmentId: a.id });
      continue;
    }
    const [created] = await db
      .insert(sources)
      .values({
        notebookId: access.channel.notebookId,
        createdBy: actor.id,
        kind: "chat_attachment",
        title: a.name,
        mime: a.mime,
        fileId: a.fileId,
        // Tệp từ DM không được lộ cho cả sổ tay.
        visibility: access.channel.type === "dm" ? "private" : "shared",
        status: "pending",
        metadata: { origin: "team_chat", channelId: access.channel.id, messageId: row.id, attachmentId: a.id },
      })
      .returning();
    // Handler `ingest_source` do module Nguồn đăng ký; nếu chưa có, dòng nguồn giữ trạng thái pending.
    await enqueue("ingest_source", { sourceId: created.id, notebookId: created.notebookId, userId: actor.id });
    out.push({ id: created.id, title: created.title, status: created.status, existing: false, attachmentId: a.id });
  }
  return out;
}
