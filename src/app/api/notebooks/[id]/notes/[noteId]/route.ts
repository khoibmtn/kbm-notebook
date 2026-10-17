import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { assertCanManageNote, deleteNote, getNoteOrThrow, toNoteDto, updateNote } from "@/server/notes/service";
import { updateNoteSchema } from "@/lib/validators/notes";

type P = { id: string; noteId: string };

export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id, noteId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "viewer");
  const row = await getNoteOrThrow(user.id, id, noteId);
  return { note: toNoteDto(row, { userId: user.id, role }) };
});

/** Sửa tiêu đề / nội dung / quyền riêng tư — tác giả hoặc admin+ (editor+). Nếu ghi chú là nguồn, nguồn được đồng bộ & xử lý lại. */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { id, noteId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const row = await getNoteOrThrow(user.id, id, noteId);
  assertCanManageNote(row, user.id, role);
  const patch = await parseBody(updateNoteSchema, req);
  const updated = await updateNote(row, patch);
  return { note: toNoteDto(updated, { userId: user.id, role }) };
});

export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { id, noteId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const row = await getNoteOrThrow(user.id, id, noteId);
  assertCanManageNote(row, user.id, role);
  await deleteNote(row);
  return { ok: true };
});
