import { ApiError, handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { markChannelRead } from "@/server/team-chat/actions";
import { requireChannelAccess } from "@/server/team-chat/access";
import { readSchema } from "@/lib/validators/team-chat";

type P = { id: string; channelId: string };

/** Đánh dấu đã đọc đến một tin nhắn. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id, channelId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  if (access.channel.notebookId !== id) throw ApiError.notFound("Không tìm thấy kênh");
  const { messageId } = await parseBody(readSchema, req);
  return markChannelRead(access, user.id, messageId);
});
