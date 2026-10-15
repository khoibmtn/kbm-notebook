import { handleRoute, parseQuery } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { listNotifications } from "@/server/team-chat/notify";
import { notificationsQuery } from "@/lib/validators/team-chat";

/** Thông báo của người dùng hiện tại (`?unread=1` chỉ chưa đọc). */
export const GET = handleRoute(async (req) => {
  const { user } = await requireUser();
  const { unread, limit } = parseQuery(notificationsQuery, req);
  return listNotifications(user.id, { unreadOnly: unread, limit });
});
