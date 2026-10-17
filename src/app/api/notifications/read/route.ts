import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { markNotificationsRead } from "@/server/team-chat/notify";
import { markNotificationsSchema } from "@/lib/validators/team-chat";

/** Đánh dấu đã đọc: `{ ids: string[] }` hoặc `{ all: true }`. Chỉ tác động thông báo của chính user. */
export const POST = handleRoute(async (req) => {
  const { user } = await requireUser();
  const input = await parseBody(markNotificationsSchema, req);
  const unreadCount = await markNotificationsRead(user.id, input);
  return { unreadCount };
});
