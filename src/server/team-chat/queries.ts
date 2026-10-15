import "server-only";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { ApiError, isUuid } from "@/server/api/errors";
import { db } from "@/server/db";
import { channelMembers, channels, teamMessages, users } from "@/server/db/schema";
import type { MessageDTO, MessagesPageDTO, ReadReceiptDTO } from "@/lib/team-chat/types";
import type { ChannelRow } from "./access";
import { toMessageDTOs } from "./serialize";

type ListOpts = {
  viewerId: string;
  channel: ChannelRow;
  before?: string;
  after?: string;
  around?: string;
  limit: number;
};

/** Điều kiện keyset: (created_at, id) so với tin làm mốc, tính trong SQL để giữ độ chính xác microsecond. */
function cursorOf(channelId: string, messageId: string) {
  return sql`(select tm.created_at, tm.id from team_messages tm where tm.id = ${messageId} and tm.channel_id = ${channelId})`;
}

async function assertCursor(channelId: string, messageId: string): Promise<void> {
  if (!isUuid(messageId)) throw ApiError.badRequest("Mốc phân trang không hợp lệ");
  const [row] = await db
    .select({ id: teamMessages.id })
    .from(teamMessages)
    .where(and(eq(teamMessages.id, messageId), eq(teamMessages.channelId, channelId)))
    .limit(1);
  if (!row) throw ApiError.badRequest("Mốc phân trang không thuộc kênh này");
}

const visible = (channelId: string) => and(eq(teamMessages.channelId, channelId), isNull(teamMessages.deletedAt));

/**
 * Phân trang keyset, mới nhất trước.
 * - mặc định: `limit` tin mới nhất; `before=<id>`: cũ hơn tin đó; `after=<id>`: mới hơn tin đó; `around=<id>`: cửa sổ quanh tin đó.
 */
export async function listMessages(opts: ListOpts): Promise<MessagesPageDTO> {
  const { channel, limit, viewerId } = opts;
  const ctx = { viewerId, notebookId: channel.notebookId };
  const base = visible(channel.id);
  const colsDesc = [desc(teamMessages.createdAt), desc(teamMessages.id)];
  let rows;
  let hasMore = false;
  let hasNewer = false;

  if (opts.around) {
    await assertCursor(channel.id, opts.around);
    const half = Math.max(1, Math.floor(limit / 2));
    const cur = cursorOf(channel.id, opts.around);
    const older = await db
      .select()
      .from(teamMessages)
      .where(and(base, sql`(${teamMessages.createdAt}, ${teamMessages.id}) <= ${cur}`))
      .orderBy(...colsDesc)
      .limit(half + 1);
    const newer = await db
      .select()
      .from(teamMessages)
      .where(and(base, sql`(${teamMessages.createdAt}, ${teamMessages.id}) > ${cur}`))
      .orderBy(asc(teamMessages.createdAt), asc(teamMessages.id))
      .limit(half + 1);
    hasMore = older.length > half;
    hasNewer = newer.length > half;
    rows = [...newer.slice(0, half).reverse(), ...older.slice(0, half)];
  } else if (opts.after) {
    await assertCursor(channel.id, opts.after);
    const cur = cursorOf(channel.id, opts.after);
    const newer = await db
      .select()
      .from(teamMessages)
      .where(and(base, sql`(${teamMessages.createdAt}, ${teamMessages.id}) > ${cur}`))
      .orderBy(asc(teamMessages.createdAt), asc(teamMessages.id))
      .limit(limit + 1);
    hasNewer = newer.length > limit;
    hasMore = true;
    rows = newer.slice(0, limit).reverse();
  } else {
    let cond = base;
    if (opts.before) {
      await assertCursor(channel.id, opts.before);
      cond = and(base, sql`(${teamMessages.createdAt}, ${teamMessages.id}) < ${cursorOf(channel.id, opts.before)}`);
    }
    const page = await db
      .select()
      .from(teamMessages)
      .where(cond)
      .orderBy(...colsDesc)
      .limit(limit + 1);
    hasMore = page.length > limit;
    rows = page.slice(0, limit);
  }

  const messages = await toMessageDTOs(rows, ctx);
  const result: MessagesPageDTO = { messages, hasMore, hasNewer };

  if (!opts.before && !opts.after && !opts.around) {
    result.pinned = await listPinned(viewerId, channel);
    result.reads = await listReads(viewerId, channel.id);
  }
  return result;
}

export async function listPinned(viewerId: string, channel: ChannelRow): Promise<MessageDTO[]> {
  const rows = await db
    .select()
    .from(teamMessages)
    .where(and(visible(channel.id), eq(teamMessages.pinned, true), isNull(teamMessages.recalledAt)))
    .orderBy(desc(teamMessages.createdAt))
    .limit(50);
  return toMessageDTOs(rows, { viewerId, notebookId: channel.notebookId });
}

/** Vị trí đã đọc của các thành viên khác (cho dấu "đã xem"). */
export async function listReads(viewerId: string, channelId: string): Promise<ReadReceiptDTO[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, image: users.image, lastReadAt: channelMembers.lastReadAt })
    .from(channelMembers)
    .innerJoin(users, eq(users.id, channelMembers.userId))
    .where(and(eq(channelMembers.channelId, channelId), ne(channelMembers.userId, viewerId)));
  return rows
    .filter((r): r is typeof r & { lastReadAt: Date } => r.lastReadAt != null)
    .map((r) => ({ userId: r.userId, name: r.name, image: r.image, lastReadAt: r.lastReadAt.toISOString() }));
}

function escapeLike(q: string): string {
  return q.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * Tìm tin nhắn bằng full-text (`tsv`) + ILIKE dự phòng, giới hạn ở các kênh user thuộc về.
 * `channelId` bỏ trống → mọi kênh của user trong notebook.
 */
export async function searchMessages(opts: {
  viewerId: string;
  notebookId: string;
  channelId?: string;
  q: string;
  limit: number;
}): Promise<(MessageDTO & { channelName: string | null; channelType: ChannelRow["type"] })[]> {
  const { viewerId, notebookId, channelId, q, limit } = opts;
  const like = `%${escapeLike(q)}%`;
  const where = and(
    eq(channels.notebookId, notebookId),
    eq(channelMembers.userId, viewerId),
    channelId ? eq(teamMessages.channelId, channelId) : undefined,
    isNull(teamMessages.deletedAt),
    isNull(teamMessages.recalledAt),
    sql`(${teamMessages.tsv} @@ plainto_tsquery('simple', ${q}) or ${teamMessages.content} ilike ${like})`,
  );
  const rows = await db
    .select({ m: teamMessages, channelName: channels.name, channelType: channels.type })
    .from(teamMessages)
    .innerJoin(channels, eq(channels.id, teamMessages.channelId))
    .innerJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, viewerId)))
    .where(where)
    .orderBy(desc(teamMessages.createdAt), desc(teamMessages.id))
    .limit(limit);
  const dtos = await toMessageDTOs(
    rows.map((r) => r.m),
    { viewerId, notebookId },
  );
  return dtos.map((d, i) => ({ ...d, channelName: rows[i].channelName, channelType: rows[i].channelType }));
}
