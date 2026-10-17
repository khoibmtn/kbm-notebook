import { handleRoute, parseBody, parseQuery } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { createNote, listNotes, toNoteDto } from "@/server/notes/service";
import { createNoteSchema, listNotesQuerySchema } from "@/lib/validators/notes";

type P = { id: string };

/** Ghi chú shared + ghi chú riêng của người gọi (viewer+). `?q=` tìm theo tiêu đề/nội dung. */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "viewer");
  const { q } = parseQuery(listNotesQuerySchema, req);
  return { notes: await listNotes(id, { userId: user.id, role }, q) };
});

/** Tạo ghi chú thủ công (editor+). */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const input = await parseBody(createNoteSchema, req);
  const row = await createNote({ notebookId: id, userId: user.id, title: input.title, contentMd: input.contentMd, visibility: input.visibility });
  return Response.json({ note: toNoteDto(row, { userId: user.id, role }) }, { status: 201 });
});
