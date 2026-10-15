import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { emitToNotebook, emitToUser, joinNotebookToChannel, joinUserToChannel } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { channelMembers, channels, notebookMembers, notebooks, users, type Role } from "@/server/db/schema";
import { hasRole } from "@/lib/roles";
import { toPlainPreview } from "@/lib/team-chat/markdown";
import type { ChannelDTO, ChannelEvent, MessageKind, PersonDTO } from "@/lib/team-chat/types";
import type { ChannelRow } from "./access";

type UnreadRow = { channel_id: string; unread: number };
type LastRow = {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_name: string;
  kind: MessageKind;
  content: string;
  recalled_at: Date | null;
  created_at: Date;
};

function iso(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

/**
 * Bảo đảm notebook có kênh `general` và mọi thành viên notebook đều thuộc `general` + các kênh chủ đề.
 * Trả về các kênh mà `userId` vừa được thêm vào (để cho socket của họ vào phòng).
 */
export async function ensureChannelMemberships(notebookId: string, userId: string): Promise<string[]> {
  const [general] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.notebookId, notebookId), eq(channels.type, "general")))
    .limit(1);
  if (!general) {
    const [nb] = await db.select({ ownerId: notebooks.ownerId }).from(notebooks).where(eq(notebooks.id, notebookId)).limit(1);
    await db
      .insert(channels)
      .values({ notebookId, type: "general", name: "general", createdBy: nb?.ownerId ?? userId })
      .onConflictDoNothing();
  }
  // Mọi thành viên notebook → mọi kênh general/topic (idempotent).
  await db.execute(sql`
    insert into channel_members (channel_id, user_id)
    select c.id, nm.user_id
    from channels c
    join notebook_members nm on nm.notebook_id = c.notebook_id
    where c.notebook_id = ${notebookId} and c.type in ('general', 'topic')
    on conflict do nothing
  `);
  // Kênh mà user đã thuộc nhưng socket có thể chưa vào phòng: trả toàn bộ kênh không-DM của user.
  const rows = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
    .where(and(eq(channels.notebookId, notebookId), eq(channelMembers.userId, userId), inArray(channels.type, ["general", "topic"])));
  return rows.map((r) => r.id);
}

/** Tổng số tin chưa đọc theo kênh của user trong notebook (bỏ tin của chính mình, đã xoá, đã thu hồi). */
async function unreadByChannel(userId: string, notebookId: string): Promise<Map<string, number>> {
  const res = await db.execute<UnreadRow>(sql`
    select tm.channel_id, count(*)::int as unread
    from team_messages tm
    join channels c on c.id = tm.channel_id and c.notebook_id = ${notebookId}
    join channel_members cm on cm.channel_id = tm.channel_id and cm.user_id = ${userId}
    join notebook_members nm on nm.notebook_id = c.notebook_id and nm.user_id = ${userId}
    where tm.deleted_at is null
      and tm.recalled_at is null
      and tm.kind <> 'system'
      and tm.sender_id <> ${userId}
      and tm.created_at > coalesce(cm.last_read_at, nm.joined_at)
    group by tm.channel_id
  `);
  return new Map(res.rows.map((r) => [r.channel_id, Number(r.unread)]));
}

function previewOf(row: Pick<LastRow, "kind" | "content" | "recalled_at">): string {
  if (row.recalled_at) return "";
  return toPlainPreview(row.content);
}

/** Danh sách kênh user nhìn thấy trong notebook, kèm chưa đọc, tin cuối, thành viên DM. */
export async function listChannelsForUser(userId: string, notebookId: string): Promise<ChannelDTO[]> {
  const healed = await ensureChannelMemberships(notebookId, userId);
  for (const id of healed) joinUserToChannel(userId, id);

  const rows = await db
    .select({ channel: channels, member: channelMembers })
    .from(channels)
    .innerJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, userId)))
    .where(eq(channels.notebookId, notebookId))
    .orderBy(asc(channels.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.channel.id);
  const unread = await unreadByChannel(userId, notebookId);

  const lastRes = await db.execute<LastRow>(sql`
    select distinct on (tm.channel_id)
      tm.id, tm.channel_id, tm.sender_id, u.name as sender_name, tm.kind, tm.content, tm.recalled_at, tm.created_at
    from team_messages tm
    join users u on u.id = tm.sender_id
    where tm.channel_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) and tm.deleted_at is null
    order by tm.channel_id, tm.created_at desc, tm.id desc
  `);
  const lastBy = new Map(lastRes.rows.map((r) => [r.channel_id, r]));

  const dmIds = rows.filter((r) => r.channel.type === "dm").map((r) => r.channel.id);
  const dmMembers = new Map<string, PersonDTO[]>();
  if (dmIds.length > 0) {
    const ms = await db
      .select({ channelId: channelMembers.channelId, id: users.id, name: users.name, image: users.image })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(inArray(channelMembers.channelId, dmIds));
    for (const m of ms) {
      const list = dmMembers.get(m.channelId) ?? [];
      list.push({ id: m.id, name: m.name, image: m.image });
      dmMembers.set(m.channelId, list);
    }
  }

  return rows.map(({ channel, member }): ChannelDTO => {
    const last = lastBy.get(channel.id);
    return {
      id: channel.id,
      notebookId: channel.notebookId,
      type: channel.type,
      name: channel.name,
      createdBy: channel.createdBy,
      createdAt: iso(channel.createdAt),
      unread: unread.get(channel.id) ?? 0,
      muted: member.muted,
      lastReadAt: member.lastReadAt ? iso(member.lastReadAt) : null,
      lastMessage: last
        ? {
            id: last.id,
            senderId: last.sender_id,
            senderName: last.sender_name,
            kind: last.kind,
            preview: previewOf(last),
            recalled: last.recalled_at != null,
            createdAt: iso(last.created_at),
          }
        : null,
      lastActivityAt: iso(last?.created_at ?? channel.createdAt),
      members: dmMembers.get(channel.id) ?? [],
    };
  });
}

/** Tổng chưa đọc (bỏ kênh đã tắt tiếng) cho badge ở sidebar. */
export async function unreadSummary(userId: string, notebookId: string): Promise<{ unread: number }> {
  await ensureChannelMemberships(notebookId, userId);
  const byChannel = await unreadByChannel(userId, notebookId);
  if (byChannel.size === 0) return { unread: 0 };
  const muted = await db
    .select({ id: channelMembers.channelId })
    .from(channelMembers)
    .where(and(eq(channelMembers.userId, userId), eq(channelMembers.muted, true), inArray(channelMembers.channelId, [...byChannel.keys()])));
  const mutedSet = new Set(muted.map((m) => m.id));
  let total = 0;
  for (const [id, n] of byChannel) if (!mutedSet.has(id)) total += n;
  return { unread: total };
}

function channelEvent(channel: ChannelRow, members: PersonDTO[]): ChannelEvent {
  return {
    notebookId: channel.notebookId,
    channel: {
      id: channel.id,
      notebookId: channel.notebookId,
      type: channel.type,
      name: channel.name,
      createdBy: channel.createdBy,
      createdAt: iso(channel.createdAt),
      lastActivityAt: iso(channel.createdAt),
      members,
    },
  };
}

async function emptyChannelDTO(userId: string, channelId: string): Promise<ChannelDTO> {
  const [row] = await db
    .select({ channel: channels, member: channelMembers })
    .from(channels)
    .innerJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, userId)))
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!row) throw ApiError.notFound("Không tìm thấy kênh");
  const members: PersonDTO[] =
    row.channel.type === "dm"
      ? await db
          .select({ id: users.id, name: users.name, image: users.image })
          .from(channelMembers)
          .innerJoin(users, eq(users.id, channelMembers.userId))
          .where(eq(channelMembers.channelId, channelId))
      : [];
  return {
    id: row.channel.id,
    notebookId: row.channel.notebookId,
    type: row.channel.type,
    name: row.channel.name,
    createdBy: row.channel.createdBy,
    createdAt: iso(row.channel.createdAt),
    unread: 0,
    muted: row.member.muted,
    lastReadAt: row.member.lastReadAt ? iso(row.member.lastReadAt) : null,
    lastMessage: null,
    lastActivityAt: iso(row.channel.createdAt),
    members,
  };
}

export async function createTopicChannel(userId: string, notebookId: string, name: string): Promise<ChannelDTO> {
  const dup = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.notebookId, notebookId), eq(channels.type, "topic"), sql`lower(${channels.name}) = lower(${name})`))
    .limit(1);
  if (dup.length > 0) throw ApiError.conflict("Đã có chủ đề cùng tên", "channel_exists");

  const channel = await db.transaction(async (tx) => {
    const [c] = await tx.insert(channels).values({ notebookId, type: "topic", name, createdBy: userId }).returning();
    await tx.execute(sql`
      insert into channel_members (channel_id, user_id)
      select ${c.id}, nm.user_id from notebook_members nm where nm.notebook_id = ${notebookId}
      on conflict do nothing
    `);
    return c;
  });
  joinNotebookToChannel(notebookId, channel.id);
  emitToNotebook(notebookId, "channel:new", channelEvent(channel, []));
  return emptyChannelDTO(userId, channel.id);
}

/** Tạo (hoặc trả về) DM giữa hai thành viên notebook. */
export async function getOrCreateDm(
  userId: string,
  notebookId: string,
  otherUserId: string,
): Promise<{ channel: ChannelDTO; created: boolean }> {
  if (otherUserId === userId) throw ApiError.badRequest("Không thể nhắn riêng cho chính mình");
  const [other] = await db
    .select({ userId: notebookMembers.userId })
    .from(notebookMembers)
    .innerJoin(notebooks, eq(notebooks.id, notebookMembers.notebookId))
    .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, otherUserId), isNull(notebooks.deletedAt)))
    .limit(1);
  if (!other) throw ApiError.badRequest("Người nhận không phải thành viên của sổ tay", "not_a_member");

  const [a, b] = [userId, otherUserId].sort();
  const result = await db.transaction(async (tx) => {
    // Khoá theo cặp người dùng để hai yêu cầu đồng thời không tạo hai DM.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dm:${notebookId}:${a}:${b}`}))`);
    const existing = await tx.execute<{ id: string }>(sql`
      select c.id
      from channels c
      join channel_members m1 on m1.channel_id = c.id and m1.user_id = ${userId}
      join channel_members m2 on m2.channel_id = c.id and m2.user_id = ${otherUserId}
      where c.notebook_id = ${notebookId} and c.type = 'dm'
      limit 1
    `);
    if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
    const [c] = await tx.insert(channels).values({ notebookId, type: "dm", name: null, createdBy: userId }).returning();
    await tx.insert(channelMembers).values([
      { channelId: c.id, userId },
      { channelId: c.id, userId: otherUserId },
    ]);
    return { id: c.id, created: true, row: c };
  });

  const dto = await emptyChannelDTO(userId, result.id);
  if (result.created && "row" in result && result.row) {
    joinUserToChannel(userId, result.id);
    joinUserToChannel(otherUserId, result.id);
    const ev = channelEvent(result.row, dto.members);
    emitToUser(userId, "channel:new", ev);
    emitToUser(otherUserId, "channel:new", ev);
  }
  return { channel: dto, created: result.created };
}

export async function renameChannel(
  userId: string,
  role: Role,
  channel: ChannelRow,
  name: string,
): Promise<ChannelDTO> {
  if (channel.type !== "topic") throw ApiError.badRequest("Chỉ đổi tên được kênh chủ đề", "not_renamable");
  if (!(hasRole(role, "admin") || channel.createdBy === userId)) throw ApiError.forbidden();
  const dup = await db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        eq(channels.notebookId, channel.notebookId),
        eq(channels.type, "topic"),
        sql`lower(${channels.name}) = lower(${name})`,
        sql`${channels.id} <> ${channel.id}`,
      ),
    )
    .limit(1);
  if (dup.length > 0) throw ApiError.conflict("Đã có chủ đề cùng tên", "channel_exists");
  const [updated] = await db.update(channels).set({ name }).where(eq(channels.id, channel.id)).returning();
  emitToNotebook(channel.notebookId, "channel:update", channelEvent(updated, []));
  return emptyChannelDTO(userId, channel.id);
}
