import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { canViewArtifact } from "@/server/auth/permissions";
import { db } from "@/server/db";
import {
  artifacts,
  messageAttachments,
  messageReactions,
  notes,
  sources,
  teamMessages,
  users,
  type TeamMessageContentJson,
} from "@/server/db/schema";
import { plainText } from "@/lib/team-chat/mentions";
import type {
  AttachmentDTO,
  MessageDTO,
  PersonDTO,
  ReactionDTO,
  RefDTO,
  RefType,
  ReplySnippetDTO,
} from "@/lib/team-chat/types";

export type TeamMessageRow = typeof teamMessages.$inferSelect;

const SNIPPET_LEN = 140;

function iso(d: Date): string {
  return d.toISOString();
}

function snippetOf(row: TeamMessageRow, attachments: AttachmentDTO[], refs: RefDTO[]): string {
  const text = plainText(row.content).replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, SNIPPET_LEN);
  if (refs[0]) return refs[0].title.slice(0, SNIPPET_LEN);
  if (attachments[0]) return `📎 ${attachments[0].name}`.slice(0, SNIPPET_LEN);
  return "";
}

async function resolveRefs(
  viewerId: string,
  notebookId: string,
  wanted: { type: RefType; id: string; title?: string }[],
): Promise<Map<string, RefDTO>> {
  const out = new Map<string, RefDTO>();
  const byType = (t: RefType) => [...new Set(wanted.filter((w) => w.type === t).map((w) => w.id))];

  const artifactIds = byType("artifact");
  if (artifactIds.length > 0) {
    const rows = await db.select().from(artifacts).where(and(inArray(artifacts.id, artifactIds), eq(artifacts.notebookId, notebookId)));
    for (const a of rows) {
      let available = a.deletedAt == null;
      // Artifact chuyển về riêng tư sau khi chia sẻ: chỉ người có quyền thấy mới mở được.
      if (available && a.visibility === "private") available = await canViewArtifact(viewerId, a);
      out.set(`artifact:${a.id}`, { type: "artifact", id: a.id, title: a.title, subtype: a.type, available });
    }
  }
  const sourceIds = byType("source");
  if (sourceIds.length > 0) {
    const rows = await db.select().from(sources).where(and(inArray(sources.id, sourceIds), eq(sources.notebookId, notebookId)));
    for (const s of rows) {
      const available = s.deletedAt == null && (s.visibility === "shared" || s.createdBy === viewerId);
      out.set(`source:${s.id}`, { type: "source", id: s.id, title: s.title, subtype: s.kind, available });
    }
  }
  const noteIds = byType("note");
  if (noteIds.length > 0) {
    const rows = await db.select().from(notes).where(and(inArray(notes.id, noteIds), eq(notes.notebookId, notebookId)));
    for (const n of rows) {
      const available = n.deletedAt == null && (n.visibility === "shared" || n.createdBy === viewerId);
      out.set(`note:${n.id}`, { type: "note", id: n.id, title: n.title, subtype: "note", available });
    }
  }
  // Tham chiếu không còn trong DB.
  for (const w of wanted) {
    const key = `${w.type}:${w.id}`;
    if (!out.has(key)) out.set(key, { type: w.type, id: w.id, title: w.title ?? "", subtype: null, available: false });
  }
  return out;
}

/**
 * Chuyển các dòng `team_messages` (chưa bị xoá mềm) thành DTO. Tin đã thu hồi: nội dung/tệp/tham chiếu/reaction bị ẩn.
 * Một lần gọi = số truy vấn cố định (không N+1).
 */
export async function toMessageDTOs(
  rows: TeamMessageRow[],
  ctx: { viewerId: string; notebookId: string },
): Promise<MessageDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];

  const senderIds = [...new Set(rows.map((r) => r.senderId))];
  const [senderRows, reactionRows, attachmentRows, replyRows] = await Promise.all([
    db.select({ id: users.id, name: users.name, image: users.image }).from(users).where(inArray(users.id, senderIds)),
    db
      .select()
      .from(messageReactions)
      .where(inArray(messageReactions.messageId, ids))
      .orderBy(asc(messageReactions.createdAt)),
    db
      .select()
      .from(messageAttachments)
      .where(inArray(messageAttachments.messageId, [...ids, ...replyIds])),
    replyIds.length > 0
      ? db
          .select({ m: teamMessages, senderName: users.name })
          .from(teamMessages)
          .innerJoin(users, eq(users.id, teamMessages.senderId))
          .where(inArray(teamMessages.id, replyIds))
      : Promise.resolve([] as { m: TeamMessageRow; senderName: string }[]),
  ]);

  const sender = new Map<string, PersonDTO>(senderRows.map((u) => [u.id, u]));

  const attachmentsBy = new Map<string, AttachmentDTO[]>();
  for (const a of attachmentRows) {
    const list = attachmentsBy.get(a.messageId) ?? [];
    list.push({ id: a.id, fileId: a.fileId, name: a.name, mime: a.mime, size: a.size });
    attachmentsBy.set(a.messageId, list);
  }

  const reactionsBy = new Map<string, Map<string, string[]>>();
  for (const r of reactionRows) {
    const perMsg = reactionsBy.get(r.messageId) ?? new Map<string, string[]>();
    const users_ = perMsg.get(r.emoji) ?? [];
    users_.push(r.userId);
    perMsg.set(r.emoji, users_);
    reactionsBy.set(r.messageId, perMsg);
  }

  // Tham chiếu cần giải quyết cho cả tin gốc và tin được trả lời.
  const allRows = [...rows, ...replyRows.map((x) => x.m)];
  const wanted: { type: RefType; id: string; title?: string }[] = [];
  for (const r of allRows) {
    if (r.recalledAt || r.deletedAt) continue;
    for (const ref of r.contentJson?.refs ?? []) wanted.push(ref);
  }
  const refMap = await resolveRefs(ctx.viewerId, ctx.notebookId, wanted);

  const refsOf = (r: TeamMessageRow): RefDTO[] => {
    if (r.recalledAt || r.deletedAt) return [];
    return (r.contentJson?.refs ?? []).map((ref) => refMap.get(`${ref.type}:${ref.id}`)!).filter(Boolean);
  };
  const attachmentsOf = (r: TeamMessageRow): AttachmentDTO[] =>
    r.recalledAt || r.deletedAt ? [] : (attachmentsBy.get(r.id) ?? []);

  const replyBy = new Map<string, ReplySnippetDTO>();
  for (const { m, senderName } of replyRows) {
    const unavailable = m.deletedAt != null || m.recalledAt != null;
    replyBy.set(m.id, {
      id: m.id,
      senderId: m.senderId,
      senderName,
      snippet: unavailable ? "" : snippetOf(m, attachmentsOf(m), refsOf(m)),
      unavailable,
    });
  }

  return rows.map((r): MessageDTO => {
    const recalled = r.recalledAt != null;
    const perMsg = recalled ? undefined : reactionsBy.get(r.id);
    const reactions: ReactionDTO[] = perMsg
      ? [...perMsg.entries()].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }))
      : [];
    const stored = (r.contentJson as TeamMessageContentJson | null)?.mentions ?? [];
    // Chỉ các mention hợp lệ đã được kiểm tra lúc gửi/sửa (thành viên của kênh, không gồm người gửi).
    const mentions = recalled ? [] : [...new Set(stored.map((x) => x.toLowerCase()))];
    return {
      id: r.id,
      channelId: r.channelId,
      kind: r.kind,
      content: recalled ? "" : r.content,
      sender: sender.get(r.senderId) ?? { id: r.senderId, name: "?", image: null },
      replyTo: r.replyToId
        ? (replyBy.get(r.replyToId) ?? { id: r.replyToId, senderId: null, senderName: null, snippet: "", unavailable: true })
        : null,
      createdAt: iso(r.createdAt),
      editedAt: r.editedAt ? iso(r.editedAt) : null,
      recalledAt: r.recalledAt ? iso(r.recalledAt) : null,
      pinned: recalled ? false : r.pinned,
      mentions,
      reactions,
      attachments: attachmentsOf(r),
      refs: refsOf(r),
    };
  });
}

export async function getMessageDTO(
  messageId: string,
  ctx: { viewerId: string; notebookId: string },
): Promise<MessageDTO | null> {
  const [row] = await db
    .select()
    .from(teamMessages)
    .where(and(eq(teamMessages.id, messageId), isNull(teamMessages.deletedAt)))
    .limit(1);
  if (!row) return null;
  const [dto] = await toMessageDTOs([row], ctx);
  return dto ?? null;
}
