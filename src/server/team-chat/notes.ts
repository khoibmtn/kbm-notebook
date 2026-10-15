import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { channelMembers, channels, messageAttachments, notes, teamMessages, users } from "@/server/db/schema";
import { plainText } from "@/lib/team-chat/mentions";

const DEFAULT_TZ = "Asia/Ho_Chi_Minh";

function safeTimeZone(tz: string | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("vi-VN", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export type TranscriptMessage = {
  senderName: string;
  createdAt: Date;
  content: string;
  attachmentNames: string[];
  refTitles: string[];
};

/** Bản ghi hội thoại: mỗi tin một đoạn `**Tên** (hh:mm): nội dung`. Hàm thuần để dễ kiểm thử. */
export function formatTranscript(messages: TranscriptMessage[], timeZone: string = DEFAULT_TZ): string {
  const time = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  const lines: string[] = [];
  for (const m of messages) {
    const parts: string[] = [];
    const text = plainText(m.content).trim();
    if (text) parts.push(text);
    for (const n of m.attachmentNames) parts.push(`📎 ${n}`);
    for (const t of m.refTitles) parts.push(`🔗 ${t}`);
    if (parts.length === 0) continue;
    lines.push(`**${m.senderName}** (${time.format(m.createdAt)}): ${parts.join("\n")}`);
  }
  return lines.join("\n\n");
}

export async function createNoteFromMessages(opts: {
  userId: string;
  notebookId: string;
  messageIds: string[];
  channelId?: string;
  title?: string;
  timeZone?: string;
}): Promise<{ id: string; title: string }> {
  const ids = [...new Set(opts.messageIds)];
  const rows = await db
    .select({ m: teamMessages, ch: channels, senderName: users.name })
    .from(teamMessages)
    .innerJoin(channels, eq(channels.id, teamMessages.channelId))
    .innerJoin(users, eq(users.id, teamMessages.senderId))
    .where(and(inArray(teamMessages.id, ids), isNull(teamMessages.deletedAt)));
  // Không phân biệt "không tồn tại" và "không có quyền" để không lộ thông tin.
  if (rows.length !== ids.length) throw ApiError.notFound("Không tìm thấy tin nhắn");
  if (rows.some((r) => r.ch.notebookId !== opts.notebookId)) throw ApiError.notFound("Không tìm thấy tin nhắn");
  const channelIds = [...new Set(rows.map((r) => r.ch.id))];
  if (channelIds.length > 1) throw ApiError.badRequest("Các tin nhắn phải thuộc cùng một kênh", "mixed_channels");
  const channel = rows[0].ch;
  if (opts.channelId && opts.channelId !== channel.id) throw ApiError.badRequest("Tin nhắn không thuộc kênh đã chọn", "channel_mismatch");

  // Người dùng phải thuộc kênh (DM riêng tư!). Kênh chung/chủ đề: mọi thành viên notebook (đã kiểm ở route).
  if (channel.type === "dm") {
    const [m] = await db
      .select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.userId, opts.userId)))
      .limit(1);
    if (!m) throw ApiError.notFound("Không tìm thấy tin nhắn");
  }

  const usable = rows.filter((r) => !r.m.recalledAt).sort((a, b) => a.m.createdAt.getTime() - b.m.createdAt.getTime() || a.m.id.localeCompare(b.m.id));
  if (usable.length === 0) throw ApiError.badRequest("Các tin nhắn đã chọn đều đã được thu hồi", "all_recalled");

  const atts = await db
    .select()
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, usable.map((u) => u.m.id)))
    .orderBy(asc(messageAttachments.name));
  const attBy = new Map<string, string[]>();
  for (const a of atts) attBy.set(a.messageId, [...(attBy.get(a.messageId) ?? []), a.name]);

  const tz = safeTimeZone(opts.timeZone);
  const contentMd = formatTranscript(
    usable.map((u) => ({
      senderName: u.senderName,
      createdAt: u.m.createdAt,
      content: u.m.content,
      attachmentNames: attBy.get(u.m.id) ?? [],
      refTitles: (u.m.contentJson?.refs ?? []).map((r) => r.title ?? "").filter(Boolean),
    })),
    tz,
  );

  const date = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz }).format(usable[0].m.createdAt);
  const label = channel.type === "dm" ? "tin nhắn riêng" : `#${channel.name ?? "general"}`;
  const title = opts.title ?? `Trao đổi ${label} – ${date}`;

  const [note] = await db
    .insert(notes)
    .values({
      notebookId: opts.notebookId,
      createdBy: opts.userId,
      title,
      contentMd,
      origin: "team_chat",
      originRef: { channelId: channel.id, messageIds: usable.map((u) => u.m.id) },
      // Nội dung từ DM không được lộ cho cả sổ tay.
      visibility: channel.type === "dm" ? "private" : "shared",
    })
    .returning({ id: notes.id, title: notes.title });
  return note;
}
