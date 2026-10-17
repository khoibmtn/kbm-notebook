import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { deleteMessage, editMessage } from "@/server/team-chat/actions";
import { editMessageSchema } from "@/lib/validators/team-chat";

type P = { channelId: string; messageId: string };

/** Sửa tin nhắn văn bản của chính mình (đặt `editedAt`). */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { channelId, messageId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  const input = await parseBody(editMessageSchema, req);
  const message = await editMessage(access, { id: user.id, name: user.name }, messageId, input);
  return { message };
});

/** Xoá mềm (ẩn với mọi người): tin của mình, hoặc admin+. */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { channelId, messageId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  await deleteMessage(access, { id: user.id, name: user.name }, messageId);
  return { ok: true };
});
