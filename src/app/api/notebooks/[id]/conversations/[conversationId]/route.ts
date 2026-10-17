import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import {
  deleteConversation,
  getConversationOrThrow,
  listMessages,
  renameConversation,
  toConversationDto,
  toMessageDto,
} from "@/server/chat/conversations";
import { renameConversationSchema } from "@/lib/validators/chat";

type P = { id: string; conversationId: string };

/** Cuộc trò chuyện + toàn bộ tin nhắn (theo thứ tự thời gian). */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id, conversationId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const row = await getConversationOrThrow(user.id, id, conversationId);
  const msgs = await listMessages(row.id);
  return { conversation: toConversationDto(row), messages: msgs.map(toMessageDto) };
});

export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { id, conversationId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const row = await getConversationOrThrow(user.id, id, conversationId);
  const { title } = await parseBody(renameConversationSchema, req);
  return { conversation: toConversationDto(await renameConversation(row, title)) };
});

export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { id, conversationId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const row = await getConversationOrThrow(user.id, id, conversationId);
  await deleteConversation(row);
  return { ok: true };
});
