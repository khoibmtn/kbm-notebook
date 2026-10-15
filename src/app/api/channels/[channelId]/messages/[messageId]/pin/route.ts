import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { togglePin } from "@/server/team-chat/actions";

type P = { channelId: string; messageId: string };

/** Ghim/bỏ ghim tin nhắn (editor+). */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { channelId, messageId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId, "editor");
  const message = await togglePin(access, { id: user.id, name: user.name }, messageId);
  return { message };
});
