import "server-only";
import { and, asc, desc, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { canViewSource, hasRole, type Role } from "@/server/auth/permissions";
import { emitToNotebook, emitToUser } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { notes, sourceChunks, sources, type Source } from "@/server/db/schema";
import { env } from "@/server/env";
import { enqueue } from "@/server/jobs/queue";
import { getStorage } from "@/server/storage/local";
import {
  detectFileType,
  type SourceChunkRef,
  type SourceDetailDto,
  type SourceDto,
  type SourceFileType,
  type SourcePageUnit,
  type SourceStatus,
  type SourceStatusEvent,
  type SourceTextPage,
  type SourceVisibility,
} from "@/lib/sources";
import type { Span } from "./ingest/chunk";

/** Payload của job `ingest_source`. */
export type IngestPayload = { sourceId: string; notebookId: string; userId: string };

/** Dòng nguồn không kèm văn bản đầy đủ và không kèm spans (nhẹ cho danh sách). */
export type SourceListRow = Omit<Source, "rawText">;

const { rawText: _rawText, ...listColumns } = getTableColumns(sources);
void _rawText;
const LIST_SELECT = {
  ...listColumns,
  metadata: sql<Record<string, unknown>>`${sources.metadata} - 'spans'`.as("metadata"),
};

const GENERIC_NAME = "Nguồn không tên";

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

function metaString(meta: Record<string, unknown> | null, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" ? v : null;
}

export function toSourceDto(row: SourceListRow, viewer: { userId: string; role: Role }): SourceDto {
  const meta = row.metadata ?? {};
  const fileType = (metaString(meta, "fileType") as SourceFileType | null) ?? (row.kind === "file" ? detectFileType(row.title, row.mime) : null);
  const progress = typeof meta.progress === "number" ? meta.progress : row.status === "ready" ? 100 : 0;
  return {
    id: row.id,
    notebookId: row.notebookId,
    kind: row.kind,
    fileType,
    title: row.title,
    mime: row.mime,
    url: row.url,
    fileId: row.fileId,
    visibility: row.visibility,
    status: row.status,
    progress,
    error: row.error,
    pageCount: row.pageCount,
    pageUnit: metaString(meta, "unit") as SourcePageUnit | null,
    tokenCount: row.tokenCount,
    summary: row.summary,
    keyTopics: row.keyTopics,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canManage: row.createdBy === viewer.userId || hasRole(viewer.role, "admin"),
  };
}

/* -------------------------------------------------------------------------- */
/* Realtime                                                                    */
/* -------------------------------------------------------------------------- */

type EventRow = Pick<Source, "id" | "notebookId" | "status" | "error" | "visibility" | "createdBy" | "metadata">;

/** Phát `source:status`: nguồn riêng tư chỉ tới chủ nguồn; nguồn chia sẻ tới cả sổ tay. */
export function emitSourceEvent(row: EventRow, change: SourceStatusEvent["change"], opts: { toNotebook?: boolean } = {}): void {
  const progress = typeof row.metadata?.progress === "number" ? (row.metadata.progress as number) : row.status === "ready" ? 100 : 0;
  const payload: SourceStatusEvent = {
    sourceId: row.id,
    notebookId: row.notebookId,
    status: row.status,
    progress,
    error: row.error,
    visibility: row.visibility,
    createdBy: row.createdBy,
    change,
  };
  if (row.visibility === "shared" || opts.toNotebook) emitToNotebook(row.notebookId, "source:status", payload);
  else emitToUser(row.createdBy, "source:status", payload);
}

type StatusPatch = {
  status: SourceStatus;
  progress?: number;
  error?: string | null;
  /** Các cột bổ sung cập nhật cùng lúc. */
  set?: Partial<typeof sources.$inferInsert>;
  /** Trộn thêm vào `metadata`. */
  meta?: Record<string, unknown>;
  change?: SourceStatusEvent["change"];
};

/** Cập nhật trạng thái/tiến độ nguồn (bỏ qua nếu đã xoá) và phát sự kiện realtime. */
export async function setSourceStatus(sourceId: string, patch: StatusPatch): Promise<Source | null> {
  const metaPatch: Record<string, unknown> = { ...(patch.meta ?? {}) };
  if (patch.progress !== undefined) metaPatch.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
  else if (patch.status === "ready") metaPatch.progress = 100;
  const [row] = await db
    .update(sources)
    .set({
      ...(patch.set ?? {}),
      status: patch.status,
      error: patch.error === undefined ? (patch.status === "failed" ? "Lỗi không xác định" : null) : patch.error,
      metadata: sql`${sources.metadata} || ${JSON.stringify(metaPatch)}::jsonb`,
    })
    .where(and(eq(sources.id, sourceId), isNull(sources.deletedAt)))
    .returning();
  if (!row) return null;
  emitSourceEvent(row, patch.change ?? "status");
  return row;
}

/* -------------------------------------------------------------------------- */
/* Truy vấn                                                                    */
/* -------------------------------------------------------------------------- */

/** Nguồn trong notebook mà user được xem (shared + nguồn riêng của chính họ). */
export async function listSources(notebookId: string, viewer: { userId: string; role: Role }): Promise<SourceDto[]> {
  const rows = await db
    .select(LIST_SELECT)
    .from(sources)
    .where(
      and(
        eq(sources.notebookId, notebookId),
        isNull(sources.deletedAt),
        or(eq(sources.visibility, "shared"), eq(sources.createdBy, viewer.userId)),
      ),
    )
    .orderBy(desc(sources.createdAt));
  return rows.map((r) => toSourceDto(r as SourceListRow, viewer));
}

/** Nạp nguồn đầy đủ; 404 nếu không tồn tại / sai notebook / không được xem (nguồn riêng của người khác). */
export async function getSourceOrThrow(userId: string, notebookId: string, sourceId: string): Promise<Source> {
  const [row] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.notebookId, notebookId)))
    .limit(1);
  if (!row || !(await canViewSource(userId, row))) throw ApiError.notFound("Không tìm thấy nguồn");
  return row;
}

function spansOf(row: Source): Span[] {
  const spans = row.metadata?.spans;
  return Array.isArray(spans) ? (spans as Span[]) : [];
}

/** Chi tiết cho viewer: metadata + văn bản theo từng trang/slide/mục + danh sách chunk (không kèm văn bản). */
export async function getSourceDetail(row: Source, viewer: { userId: string; role: Role }): Promise<SourceDetailDto> {
  const { rawText, ...rest } = row;
  const dto = toSourceDto(rest, viewer);
  const text = rawText ?? "";
  const spans = spansOf(row);
  let pages: SourceTextPage[];
  if (spans.length > 0) {
    pages = spans.map((s) => ({
      page: s.page ?? null,
      slide: s.slide ?? null,
      section: s.section ?? null,
      start: s.start,
      end: s.end,
      text: text.slice(s.start, s.end),
    }));
  } else if (text) {
    pages = [{ page: null, slide: null, section: null, start: 0, end: text.length, text }];
  } else {
    pages = [];
  }
  const chunkRows = await db
    .select({
      id: sourceChunks.id,
      idx: sourceChunks.idx,
      page: sourceChunks.page,
      startChar: sourceChunks.startChar,
      endChar: sourceChunks.endChar,
    })
    .from(sourceChunks)
    .where(eq(sourceChunks.sourceId, row.id))
    .orderBy(asc(sourceChunks.idx));
  const chunks: SourceChunkRef[] = chunkRows;
  return { ...dto, pages, chunks };
}

/* -------------------------------------------------------------------------- */
/* Tạo / sửa / xoá                                                             */
/* -------------------------------------------------------------------------- */

async function enqueueIngest(row: Source): Promise<void> {
  const payload: IngestPayload = { sourceId: row.id, notebookId: row.notebookId, userId: row.createdBy };
  await enqueue("ingest_source", payload);
}

function cleanTitle(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const t = base.replace(/\s+/g, " ").trim().slice(0, 200);
  return t || GENERIC_NAME;
}

export const MIME_BY_TYPE: Record<SourceFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  json: "application/json",
};

/** Lưu tệp tải lên + tạo nguồn `pending` + xếp job ingest. Ném 415 (loại không hỗ trợ) / 413 (quá lớn). */
export async function createSourceFromFile(input: {
  notebookId: string;
  userId: string;
  file: File;
  visibility: SourceVisibility;
}): Promise<Source> {
  const { file } = input;
  const type = detectFileType(file.name, file.type);
  if (!type) {
    throw new ApiError(415, "unsupported_type", `Định dạng tệp "${file.name}" chưa được hỗ trợ (PDF, DOCX, PPTX, XLSX, CSV, MD, TXT, HTML, JSON)`);
  }
  const maxMb = env().MAX_UPLOAD_MB;
  if (file.size > maxMb * 1024 * 1024) {
    throw new ApiError(413, "payload_too_large", `Tệp "${file.name}" vượt quá giới hạn ${maxMb}MB`);
  }
  if (file.size === 0) throw ApiError.badRequest(`Tệp "${file.name}" trống`);
  const mime = MIME_BY_TYPE[type];
  const stored = await getStorage().put(Buffer.from(await file.arrayBuffer()), {
    ownerId: input.userId,
    mime: file.type && file.type !== "application/octet-stream" ? file.type : mime,
    name: cleanTitle(file.name),
  });
  const [row] = await db
    .insert(sources)
    .values({
      notebookId: input.notebookId,
      createdBy: input.userId,
      kind: "file",
      title: cleanTitle(file.name),
      mime: stored.mime,
      fileId: stored.id,
      visibility: input.visibility,
      status: "pending",
      metadata: { fileType: type, progress: 0, originalName: cleanTitle(file.name) },
    })
    .returning();
  await enqueueIngest(row);
  emitSourceEvent(row, "created");
  return row;
}

const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

export async function createSourceFromUrl(input: {
  notebookId: string;
  userId: string;
  url: string;
  visibility: SourceVisibility;
}): Promise<Source> {
  const parsed = new URL(input.url);
  const isYoutube = YOUTUBE_HOST.test(parsed.hostname);
  const title = (parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "")).slice(0, 200);
  const [row] = await db
    .insert(sources)
    .values({
      notebookId: input.notebookId,
      createdBy: input.userId,
      kind: isYoutube ? "youtube" : "url",
      title,
      url: parsed.toString(),
      visibility: input.visibility,
      status: isYoutube ? "failed" : "pending",
      error: isYoutube ? "Nguồn YouTube chưa hỗ trợ" : null,
      metadata: { titleAuto: true, progress: 0 },
    })
    .returning();
  if (!isYoutube) await enqueueIngest(row);
  emitSourceEvent(row, "created");
  return row;
}

export async function createSourceFromText(input: {
  notebookId: string;
  userId: string;
  title: string;
  text: string;
  visibility: SourceVisibility;
}): Promise<Source> {
  const [row] = await db
    .insert(sources)
    .values({
      notebookId: input.notebookId,
      createdBy: input.userId,
      kind: "text",
      title: cleanTitle(input.title),
      mime: "text/plain",
      rawText: input.text,
      visibility: input.visibility,
      status: "pending",
      metadata: { progress: 0 },
    })
    .returning();
  await enqueueIngest(row);
  emitSourceEvent(row, "created");
  return row;
}

/** Chỉ chủ nguồn hoặc admin+ được sửa/xoá/xử lý lại. */
export function assertCanManage(row: Pick<Source, "createdBy">, userId: string, role: Role): void {
  if (row.createdBy !== userId && !hasRole(role, "admin")) throw ApiError.forbidden();
}

export async function updateSource(
  row: Source,
  patch: { title?: string; visibility?: SourceVisibility },
): Promise<Source> {
  if (patch.title === undefined && patch.visibility === undefined) return row;
  const [updated] = await db
    .update(sources)
    .set({
      ...(patch.title !== undefined
        ? { title: cleanTitle(patch.title), metadata: sql`${sources.metadata} || '{"titleAuto": false}'::jsonb` }
        : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    })
    .where(eq(sources.id, row.id))
    .returning();
  emitSourceEvent(updated, "updated", { toNotebook: patch.visibility !== undefined });
  return updated;
}

/** Xoá mềm nguồn + xoá chunk (không còn xuất hiện trong retrieval). */
export async function deleteSource(row: Source): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(sources).set({ deletedAt: new Date() }).where(eq(sources.id, row.id));
    await tx.delete(sourceChunks).where(eq(sourceChunks.sourceId, row.id));
    // Nguồn sinh từ ghi chú (P2): ghi chú không còn được coi là nguồn.
    const noteId = row.metadata?.note_id;
    if (typeof noteId === "string") await tx.update(notes).set({ isSource: false }).where(eq(notes.id, noteId));
  });
  emitSourceEvent({ ...row }, "deleted", { toNotebook: true });
}

/** Đặt lại về `pending` và xếp job mới. Chỉ cho nguồn đã `ready`/`failed`. */
export async function reprocessSource(row: Source): Promise<Source> {
  if (row.status === "pending" || row.status === "processing") {
    throw ApiError.conflict("Nguồn đang được xử lý", "already_processing");
  }
  if (row.kind === "youtube") throw ApiError.badRequest("Nguồn YouTube chưa hỗ trợ", "unsupported_type");
  const updated = await setSourceStatus(row.id, { status: "pending", progress: 0, error: null, change: "updated" });
  if (!updated) throw ApiError.notFound("Không tìm thấy nguồn");
  await enqueueIngest(updated);
  return updated;
}

/** Id các nguồn `ready` mà user được dùng trong notebook (cho P2/P3 khi cần mặc định "tất cả"). */
export async function listReadySourceIds(notebookId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.notebookId, notebookId),
        eq(sources.status, "ready"),
        isNull(sources.deletedAt),
        or(eq(sources.visibility, "shared"), eq(sources.createdBy, userId)),
      ),
    );
  return rows.map((r) => r.id);
}

