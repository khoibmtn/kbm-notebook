import "server-only";
import { and, eq } from "drizzle-orm";
import { ApiError, isUuid } from "@/server/api/errors";
import { getNotebookRole } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { channelMembers, channels, type Role } from "@/server/db/schema";
import { hasRole } from "@/lib/roles";

export type ChannelRow = typeof channels.$inferSelect;
export type ChannelMemberRow = typeof channelMembers.$inferSelect;

export type ChannelAccess = {
  channel: ChannelRow;
  role: Role;
  member: ChannelMemberRow;
};

/**
 * Điều kiện truy cập một kênh (dùng cho MỌI handler tin nhắn):
 * - phải là thành viên notebook (không → 404, không lộ sự tồn tại);
 * - kênh `dm`: bắt buộc có dòng `channel_members` (không → 404);
 * - kênh `general`/`topic`: mọi thành viên notebook đều thấy; dòng `channel_members` thiếu sẽ tự được tạo.
 * Thiếu vai trò tối thiểu → 403.
 */
export async function requireChannelAccess(
  userId: string,
  channelId: string,
  minRole: Role = "viewer",
): Promise<ChannelAccess> {
  if (!isUuid(channelId)) throw ApiError.notFound("Không tìm thấy kênh");
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) throw ApiError.notFound("Không tìm thấy kênh");

  const role = await getNotebookRole(userId, channel.notebookId);
  if (!role) throw ApiError.notFound("Không tìm thấy kênh");

  let [member] = await db
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  if (!member) {
    if (channel.type === "dm") throw ApiError.notFound("Không tìm thấy kênh");
    [member] = await db
      .insert(channelMembers)
      .values({ channelId, userId })
      .onConflictDoNothing()
      .returning();
    if (!member) {
      [member] = await db
        .select()
        .from(channelMembers)
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
        .limit(1);
    }
  }
  if (!hasRole(role, minRole)) throw ApiError.forbidden();
  return { channel, role, member };
}
