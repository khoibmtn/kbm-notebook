import { handleRoute } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { answerToNote } from "@/server/chat/saved";

type P = { id: string; conversationId: string; messageId: string };

/** Chuyển câu trả lời AI thành ghi chú (origin `chat`); trích dẫn thành danh sách nguồn cuối bài. Cần quyền editor+. */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { id, conversationId, messageId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const note = await answerToNote({ userId: user.id, role, notebookId: id, conversationId, answerMessageId: messageId });
  return Response.json({ note }, { status: 201 });
});
