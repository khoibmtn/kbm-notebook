import { handleRoute } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { saveExchange } from "@/server/chat/saved";

type P = { id: string; conversationId: string; messageId: string };

/** Lưu cặp hỏi-đáp (câu hỏi + câu trả lời AI) để xem lại trong sổ tay. */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { id, conversationId, messageId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const exchange = await saveExchange({ userId: user.id, notebookId: id, conversationId, answerMessageId: messageId });
  return Response.json({ exchange }, { status: 201 });
});
