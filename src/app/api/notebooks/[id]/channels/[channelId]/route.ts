import { ApiError, handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { renameChannel } from "@/server/team-chat/channels";
import { renameChannelSchema } from "@/lib/validators/team-chat";

type P = { id: string; channelId: string };

/** Đổi tên kênh chủ đề: admin+ hoặc người tạo. */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { id, channelId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  if (access.channel.notebookId !== id) throw ApiError.notFound("Không tìm thấy kênh");
  const { name } = await parseBody(renameChannelSchema, req);
  const channel = await renameChannel(user.id, access.role, access.channel, name);
  return { channel };
});
