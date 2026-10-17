import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { emitToUser } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { notifications, userProfiles } from "@/server/db/schema";
import { isLocale, makeT, type Locale } from "@/lib/i18n";
import type { NotificationDTO } from "@/lib/team-chat/types";

export function toNotificationDTO(n: typeof notifications.$inferSelect): NotificationDTO {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    data: n.data,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function localesOf(userIds: string[]): Promise<Map<string, Locale>> {
  const map = new Map<string, Locale>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({ userId: userProfiles.userId, locale: userProfiles.locale })
    .from(userProfiles)
    .where(inArray(userProfiles.userId, userIds));
  for (const r of rows) if (isLocale(r.locale)) map.set(r.userId, r.locale);
  return map;
}

export type MessageNotificationInput = {
  notebookId: string;
  channelId: string;
  channelType: "general" | "topic" | "dm";
  channelName: string | null;
  messageId: string;
  senderId: string;
  senderName: string;
  preview: string;
  /** Người được nhắc tên (đã lọc hợp lệ, không gồm người gửi). */
  mentioned: string[];
  /** Người nhận DM (đã lọc: không tắt tiếng). */
  dmRecipients: string[];
};

/**
 * Tạo thông báo `mention` cho người được nhắc và `dm` cho người nhận DM (mỗi người tối đa một thông báo
 * cho mỗi tin; mention ưu tiên), rồi phát `notification` tới phòng `user:{id}`.
 */
export async function notifyForMessage(input: MessageNotificationInput): Promise<void> {
  const mentionSet = new Set(input.mentioned.filter((id) => id !== input.senderId));
  const dmSet = new Set(input.dmRecipients.filter((id) => id !== input.senderId && !mentionSet.has(id)));
  const all = [...mentionSet, ...dmSet];
  if (all.length === 0) return;

  const locales = await localesOf(all);
  const link = `/n/${input.notebookId}/team?channel=${input.channelId}&message=${input.messageId}`;
  const channelLabel = input.channelName ? `#${input.channelName}` : "";
  const data = {
    notebookId: input.notebookId,
    channelId: input.channelId,
    messageId: input.messageId,
    senderId: input.senderId,
  };

  const values = all.map((userId) => {
    const t = makeT(locales.get(userId) ?? "vi");
    const isMention = mentionSet.has(userId);
    return {
      userId,
      type: isMention ? "mention" : "dm",
      title: isMention
        ? t("team.notif.mention", { name: input.senderName, channel: channelLabel })
        : t("team.notif.dm", { name: input.senderName }),
      body: input.preview || null,
      link,
      data,
    };
  });
  const rows = await db.insert(notifications).values(values).returning();
  for (const row of rows) emitToUser(row.userId, "notification", { notification: toNotificationDTO(row) });
}

export async function listNotifications(userId: string, opts: { unreadOnly: boolean; limit: number }) {
  const where = and(eq(notifications.userId, userId), opts.unreadOnly ? isNull(notifications.readAt) : undefined);
  const rows = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(opts.limit);
  const unreadCount = await countUnreadNotifications(userId);
  return { notifications: rows.map(toNotificationDTO), unreadCount };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

export async function markNotificationsRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<number> {
  const where = and(
    eq(notifications.userId, userId),
    isNull(notifications.readAt),
    input.all ? undefined : inArray(notifications.id, input.ids ?? []),
  );
  await db.update(notifications).set({ readAt: new Date() }).where(where);
  return countUnreadNotifications(userId);
}
