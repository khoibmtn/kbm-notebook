import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  artifactExports,
  artifacts,
  channelMembers,
  files,
  messageAttachments,
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

