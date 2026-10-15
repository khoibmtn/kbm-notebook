import { handleRoute } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { toSourceDto } from "@/server/knowledge/sources";
import { assertCanManageNote, getNoteOrThrow, noteToSource, toNoteDto } from "@/server/notes/service";

type P = { id: string; noteId: string };

/**
 * "Thêm vào Nguồn": tạo nguồn `text` từ ghi chú (metadata.note_id), xếp job ingest, đặt `notes.is_source`.
 * Sửa ghi chú sau đó sẽ xử lý lại nguồn này. Tác giả hoặc admin+ (editor+).
 */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { id, noteId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const row = await getNoteOrThrow(user.id, id, noteId);
  assertCanManageNote(row, user.id, role);
  const { note, source } = await noteToSource(row);
  const viewer = { userId: user.id, role };
  return Response.json({ note: toNoteDto(note, viewer), source: toSourceDto(source, viewer) }, { status: 201 });
});
