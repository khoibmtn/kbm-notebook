import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { isUuid } from "@/server/api/errors";
import { db } from "@/server/db";
import {
  artifactExports,
  artifactFiles,
  artifacts,
  channelMembers,
  files,
  messageAttachments,
  notebooks,
  sources,
  teamMessages,
  type FileRow,
} from "@/server/db/schema";
import { canViewArtifact, canViewSource } from "@/server/auth/permissions";
import { getStorage } from "./local";

export async function getFile(fileId: string): Promise<FileRow | null> {
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  return row ?? null;
}

/** Xoá cả byte lẫn dòng `files`. */
export async function deleteStoredFile(fileId: string): Promise<void> {
  const row = await getFile(fileId);
  if (!row) return;
  await db.delete(files).where(eq(files.id, fileId));
  await getStorage().delete(row.storageKey);
}

/** Luật truy cập tệp: trả true nếu user được xem tệp. Các phase sau đăng ký thêm luật. */
export type FileAccessRule = (userId: string, file: FileRow) => Promise<boolean>;

const rules: FileAccessRule[] = [];

export function registerFileAccessRule(rule: FileAccessRule): void {
  rules.push(rule);
}

/** Chủ sở hữu tệp. */
registerFileAccessRule(async (userId, file) => file.ownerId === userId);

/** Tệp được tham chiếu bởi một nguồn mà user được xem (thành viên notebook, tôn trọng private). */
registerFileAccessRule(async (userId, file) => {
  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.fileId, file.id), isNull(sources.deletedAt)));
  for (const s of rows) if (await canViewSource(userId, s)) return true;
  return false;
});

/** Tệp đính kèm tin nhắn nhóm: user là thành viên kênh. */
registerFileAccessRule(async (userId, file) => {
  const rows = await db
    .select({ one: sql`1` })
    .from(messageAttachments)
    .innerJoin(teamMessages, eq(teamMessages.id, messageAttachments.messageId))
    .innerJoin(channelMembers, eq(channelMembers.channelId, teamMessages.channelId))
    .where(and(eq(messageAttachments.fileId, file.id), eq(channelMembers.userId, userId), isNull(teamMessages.deletedAt)))
    .limit(1);
  return rows.length > 0;
});

/** Tệp xuất từ artifact mà user được xem. */
registerFileAccessRule(async (userId, file) => {
  const rows = await db
    .select({ a: artifacts })
    .from(artifactExports)
    .innerJoin(artifacts, eq(artifacts.id, artifactExports.artifactId))
    .where(eq(artifactExports.fileId, file.id));
  for (const { a } of rows) if (await canViewArtifact(userId, a)) return true;
  return false;
});

/**
 * Ảnh của artifact (slide `image.fileId`, infographic `imageFileId`): chỉ các tệp mà SERVER đã đăng ký cho artifact
 * trong bảng `artifact_files` (khi tải ảnh lên / sinh ảnh). Nội dung JSON do người sửa gửi lên KHÔNG đủ để cấp quyền đọc tệp.
 * Ai `canViewArtifact` đều đọc được. Tra cứu theo khoá chính — không quét `artifact_versions`.
 */
registerFileAccessRule(async (userId, file) => {
  const rows = await db
    .select({ a: artifacts })
    .from(artifactFiles)
    .innerJoin(artifacts, eq(artifacts.id, artifactFiles.artifactId))
    .where(and(eq(artifactFiles.fileId, file.id), isNull(artifacts.deletedAt)));
  for (const { a } of rows) if (await canViewArtifact(userId, a)) return true;
  return false;
});

/** Ghi nhận (phía server) một tệp ảnh thuộc artifact. */
export async function registerArtifactFile(artifactId: string, fileId: string): Promise<void> {
  await db.insert(artifactFiles).values({ artifactId, fileId }).onConflictDoNothing();
}

/**
 * Khách mở liên kết chia sẻ (`?share=<token>`): trước hết quy token về MỘT artifact (cột `share_token` có unique index),
 * artifact phải còn sống, sổ tay chưa xoá, visibility link/public; sau đó chỉ kiểm tệp có thuộc artifact đó
 * (khoá chính `artifact_files`) và đang được phiên bản HIỆN TẠI của nó tham chiếu. Không quét bảng phiên bản.
 */
export async function canAccessFileViaShare(shareToken: string, fileId: string): Promise<boolean> {
  if (!shareToken || shareToken.length < 16 || shareToken.length > 128 || !isUuid(fileId)) return false;
  const [row] = await db
    .select({ id: artifacts.id, versionId: artifacts.currentVersionId })
    .from(artifacts)
    .innerJoin(notebooks, and(eq(notebooks.id, artifacts.notebookId), isNull(notebooks.deletedAt)))
    .innerJoin(artifactFiles, and(eq(artifactFiles.artifactId, artifacts.id), eq(artifactFiles.fileId, fileId)))
    .where(and(eq(artifacts.shareToken, shareToken), isNull(artifacts.deletedAt), inArray(artifacts.visibility, ["link", "public"])))
    .limit(1);
  if (!row?.versionId) return false;
  const ref = await db.execute(sql`
    SELECT 1 FROM artifact_versions
    WHERE id = ${row.versionId}
      AND (jsonb_path_exists(content, '$.slides[*].image.fileId ? (@ == $id)', jsonb_build_object('id', ${fileId}::text))
        OR jsonb_path_exists(content, '$.imageFileId ? (@ == $id)', jsonb_build_object('id', ${fileId}::text)))`);
  return ref.rows.length > 0;
}

/**
 * Chủ tệp, hoặc thành viên notebook nơi tệp được tham chiếu (nguồn / tệp đính kèm / artifact export).
 * Trả false nếu tệp không tồn tại.
 */
export async function canAccessFile(userId: string, fileId: string): Promise<boolean> {
  const file = await getFile(fileId);
  if (!file) return false;
  for (const rule of rules) {
    if (await rule(userId, file)) return true;
  }
  return false;
}


/** Còn dòng nào tham chiếu tệp này không (nguồn chưa xoá, đính kèm tin nhắn, tệp xuất, ảnh artifact)? */
async function isFileReferenced(fileId: string, opts: { exceptSourceId?: string } = {}): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1 WHERE
      EXISTS (SELECT 1 FROM sources WHERE file_id = ${fileId} AND deleted_at IS NULL ${opts.exceptSourceId ? sql`AND id <> ${opts.exceptSourceId}` : sql``})
      OR EXISTS (SELECT 1 FROM message_attachments WHERE file_id = ${fileId})
      OR EXISTS (SELECT 1 FROM artifact_exports WHERE file_id = ${fileId})
      OR EXISTS (SELECT 1 FROM artifact_files WHERE file_id = ${fileId})`);
  return res.rows.length > 0;
}

/** Xoá tệp (byte + dòng) khi không còn gì tham chiếu — dùng khi xoá nguồn / thu hồi tin nhắn để dung lượng được trả lại. */
export async function deleteFileIfUnreferenced(fileId: string | null | undefined, opts: { exceptSourceId?: string } = {}): Promise<boolean> {
  if (!fileId) return false;
  if (await isFileReferenced(fileId, opts)) return false;
  await deleteStoredFile(fileId);
  return true;
}

/** Tuổi tối thiểu (giờ) của tệp tải lên từ chat mà chưa gắn vào tin nhắn nào thì bị dọn. */
export const ORPHAN_FILE_MAX_AGE_HOURS = 24;

/**
 * Dọn tệp mồ côi: tệp `origin='chat_upload'` quá hạn mà không còn tin nhắn / nguồn nào tham chiếu
 * (người dùng chọn tệp rồi không gửi, hoặc đã thu hồi). Trả số tệp đã xoá.
 */
export async function cleanupOrphanFiles(opts: { maxAgeHours?: number; limit?: number } = {}): Promise<number> {
  const cutoff = new Date(Date.now() - (opts.maxAgeHours ?? ORPHAN_FILE_MAX_AGE_HOURS) * 3_600_000);
  const rows = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.origin, "chat_upload"), lt(files.createdAt, cutoff)))
    .limit(opts.limit ?? 500);
  let removed = 0;
  for (const { id } of rows) {
    if (await deleteFileIfUnreferenced(id)) removed += 1;
  }
  return removed;
}
