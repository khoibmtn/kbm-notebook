import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { recallMessage } from "@/server/team-chat/actions";

type P = { channelId: string; messageId: string };

/** Thu hồi (Zalo): nội dung biến mất với mọi người, tin còn lại dưới dạng dấu "đã thu hồi". Chỉ người gửi. */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { channelId, messageId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  const message = await recallMessage(access, { id: user.id, name: user.name }, messageId);
  return { message };
});
