import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { toggleReaction } from "@/server/team-chat/actions";
import { reactionSchema } from "@/lib/validators/team-chat";

type P = { channelId: string; messageId: string };

/** Bật/tắt (toggle) một emoji reaction của người dùng trên tin nhắn. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { channelId, messageId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  const { emoji } = await parseBody(reactionSchema, req);
  return toggleReaction(access, { id: user.id, name: user.name }, messageId, emoji);
});
