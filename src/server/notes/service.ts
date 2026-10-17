import "server-only";
import { and, desc, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { ApiError, isUuid } from "@/server/api/errors";
import { hasRole, type Role } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { notes, sources, type Source } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import type { IngestPayload } from "@/server/knowledge/sources";
import { emitSourceEvent } from "@/server/knowledge/sources";
import { deriveNoteTitle, markdownExcerpt, type NoteDto, type NoteListItem, type NoteOrigin, type NoteVisibility } from "@/lib/notes";

export type NoteRow = typeof notes.$inferSelect;
type Viewer = { userId: string; role: Role };

export const UNTITLED_NOTE = "Ghi chú không tên";
/** Chờ gom các lần lưu liên tiếp trước khi xử lý lại nguồn được tạo từ ghi chú. */
export const RESYNC_DELAY_MS = 15_000;

export function toNoteDto(row: NoteRow, viewer: Viewer): NoteDto {
  return {
    id: row.id,
    notebookId: row.notebookId,
    createdBy: row.createdBy,
    title: row.title,
    contentMd: row.contentMd,
    origin: row.origin,
    originRef: row.originRef ?? null,
    visibility: row.visibility,
    isSource: row.isSource,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canManage: row.createdBy === viewer.userId || hasRole(viewer.role, "admin"),
  };
}

export function toNoteListItem(row: NoteRow, viewer: Viewer): NoteListItem {
  const { contentMd, ...rest } = toNoteDto(row, viewer);
  return { ...rest, excerpt: markdownExcerpt(contentMd) };
}

/** Ghi chú trong notebook mà user được xem: shared + ghi chú riêng của chính họ. */
function visibleTo(userId: string) {
  return or(eq(notes.visibility, "shared"), eq(notes.createdBy, userId));
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listNotes(notebookId: string, viewer: Viewer, q?: string): Promise<NoteListItem[]> {
  const conds = [eq(notes.notebookId, notebookId), isNull(notes.deletedAt), visibleTo(viewer.userId)];
  const term = q?.trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    conds.push(or(sql`${notes.title} ILIKE ${like}`, sql`${notes.contentMd} ILIKE ${like}`)!);
  }
  // Danh sách chỉ cần đoạn trích: không kéo nguyên `content_md` (tới 500k ký tự mỗi ghi chú) về server (M-11).
  const rows = await db
    .select({ ...getTableColumns(notes), contentMd: sql<string>`left(${notes.contentMd}, 4000)` })
    .from(notes)
    .where(and(...conds))
    .orderBy(desc(notes.updatedAt));
  return rows.map((r) => toNoteListItem(r, viewer));
}

/** 404 nếu không tồn tại / sai notebook / ghi chú riêng của người khác. */
export async function getNoteOrThrow(userId: string, notebookId: string, noteId: string): Promise<NoteRow> {
  if (!isUuid(noteId)) throw ApiError.notFound("Không tìm thấy ghi chú");
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.notebookId, notebookId), isNull(notes.deletedAt), visibleTo(userId)))
    .limit(1);
  if (!row) throw ApiError.notFound("Không tìm thấy ghi chú");
  return row;
}

/** Chỉ tác giả hoặc admin+ được sửa/xoá. */
export function assertCanManageNote(row: Pick<NoteRow, "createdBy">, userId: string, role: Role): void {
  if (row.createdBy !== userId && !hasRole(role, "admin")) throw ApiError.forbidden();
}

export async function createNote(input: {
  notebookId: string;
  userId: string;
  title?: string;
  contentMd?: string;
  visibility?: NoteVisibility;
  origin?: NoteOrigin;
  originRef?: Record<string, unknown> | null;
}): Promise<NoteRow> {
  const contentMd = input.contentMd ?? "";
  const [row] = await db
    .insert(notes)
    .values({
      notebookId: input.notebookId,
      createdBy: input.userId,
      title: deriveNoteTitle(input.title ?? "", contentMd, UNTITLED_NOTE),
      contentMd,
      visibility: input.visibility ?? "shared",
      origin: input.origin ?? "manual",
      originRef: input.originRef ?? null,
    })
    .returning();
  return row;
}

/** Nguồn văn bản đang liên kết với ghi chú (chưa xoá). */
export async function findLinkedSource(noteId: string): Promise<Source | null> {
  const [src] = await db
    .select()
    .from(sources)
    .where(and(isNull(sources.deletedAt), sql`${sources.metadata}->>'note_id' = ${noteId}`))
    .limit(1);
  return src ?? null;
}

async function enqueueResync(src: Source): Promise<void> {
  const pending = await db.execute<{ id: string }>(sql`
    SELECT id FROM jobs
    WHERE type = 'ingest_source' AND status = 'queued' AND payload->>'sourceId' = ${src.id}
    LIMIT 1
  `);
  if (pending.rows.length > 0) return; // job chưa chạy sẽ đọc bản mới nhất của raw_text
  const payload: IngestPayload = { sourceId: src.id, notebookId: src.notebookId, userId: src.createdBy };
  await enqueue("ingest_source", payload, { runAt: new Date(Date.now() + RESYNC_DELAY_MS) });
}

/** Đồng bộ nguồn sinh từ ghi chú khi nội dung/tiêu đề/quyền riêng tư đổi. */
async function syncLinkedSource(note: NoteRow, changed: { content: boolean; title: boolean; visibility: boolean }): Promise<void> {
  const src = await findLinkedSource(note.id);
  if (!src) {
    // Nguồn đã bị xoá → ghi chú không còn là nguồn.
    await db.update(notes).set({ isSource: false }).where(eq(notes.id, note.id));
    return;
  }
  const [updated] = await db
    .update(sources)
    .set({
      ...(changed.content ? { rawText: note.contentMd } : {}),
      ...(changed.title ? { title: note.title.slice(0, 200) } : {}),
      ...(changed.visibility ? { visibility: note.visibility } : {}),
    })
    .where(eq(sources.id, src.id))
    .returning();
  emitSourceEvent(updated, "updated", { toNotebook: changed.visibility });
  if (changed.content) await enqueueResync(updated);
}

export async function updateNote(
  row: NoteRow,
  patch: { title?: string; contentMd?: string; visibility?: NoteVisibility },
): Promise<NoteRow> {
  const contentMd = patch.contentMd ?? row.contentMd;
  const title = patch.title !== undefined ? deriveNoteTitle(patch.title, contentMd, UNTITLED_NOTE) : row.title;
  const changed = {
    content: patch.contentMd !== undefined && patch.contentMd !== row.contentMd,
    title: title !== row.title,
    visibility: patch.visibility !== undefined && patch.visibility !== row.visibility,
  };
  if (!changed.content && !changed.title && !changed.visibility) return row;
  const [updated] = await db
    .update(notes)
    .set({
      contentMd,
      title,
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    })
    .where(eq(notes.id, row.id))
    .returning();
  if (updated.isSource) await syncLinkedSource(updated, changed);
  return updated;
}

/** Xoá mềm ghi chú. Nguồn đã tạo từ ghi chú được giữ nguyên (đã là nguồn độc lập). */
export async function deleteNote(row: NoteRow): Promise<void> {
  await db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, row.id));
}

/** "Thêm vào Nguồn": tạo nguồn `text` từ ghi chú, xếp job ingest, đặt `is_source`. */
export async function noteToSource(note: NoteRow): Promise<{ note: NoteRow; source: Source }> {
  if (!note.contentMd.trim()) throw ApiError.badRequest("Ghi chú trống, chưa thể thêm vào Nguồn");
  const existing = await findLinkedSource(note.id);
  if (existing) throw ApiError.conflict("Ghi chú này đã được thêm vào Nguồn", "already_source");
  const [source] = await db
    .insert(sources)
    .values({
      notebookId: note.notebookId,
      createdBy: note.createdBy,
      kind: "text",
      title: note.title.slice(0, 200) || UNTITLED_NOTE,
      mime: "text/markdown",
      rawText: note.contentMd,
      visibility: note.visibility,
      status: "pending",
      metadata: { progress: 0, note_id: note.id, fileType: "md" },
    })
    .returning();
  const payload: IngestPayload = { sourceId: source.id, notebookId: source.notebookId, userId: source.createdBy };
  await enqueue("ingest_source", payload);
  const [updated] = await db.update(notes).set({ isSource: true }).where(eq(notes.id, note.id)).returning();
  emitSourceEvent(source, "created");
  return { note: updated, source };
}

