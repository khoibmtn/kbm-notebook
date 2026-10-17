import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { pushNote } from "@/server/connectors/connections";
import { pushNoteSchema } from "@/lib/validators/connectors";

type P = { id: string; connectionId: string };

/** "Lưu vào NotebookLM": tạo ghi chú trong notebook ngoài (Bridge `POST /notebooks/{id}/notes`). */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id, connectionId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "editor");
  const input = await parseBody(pushNoteSchema, req);
  const note = await pushNote({ notebookId: id, connectionId, userId: user.id, title: input.title, content: input.content });
  return Response.json({ note }, { status: 201 });
});
