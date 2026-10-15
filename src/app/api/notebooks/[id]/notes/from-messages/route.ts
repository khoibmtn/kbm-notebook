import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { createNoteFromMessages } from "@/server/team-chat/notes";
import { notesFromMessagesSchema } from "@/lib/validators/team-chat";

type P = { id: string };

/** Tạo note (origin='team_chat') từ các tin nhắn đã chọn (editor+). Giao diện Notes do module Ghi chú đảm nhiệm. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "editor");
  const input = await parseBody(notesFromMessagesSchema, req);
  const note = await createNoteFromMessages({ userId: user.id, notebookId: id, ...input });
  return Response.json({ noteId: note.id, note }, { status: 201 });
});
