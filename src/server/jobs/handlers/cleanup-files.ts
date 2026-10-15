import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { jobs } from "@/server/db/schema";
import { cleanupOrphanFiles } from "@/server/storage/files";
import { enqueue } from "../queue";
import { registerJobHandler } from "../worker";

export const CLEANUP_ORPHAN_FILES = "cleanup_orphan_files";
const HOUR_MS = 60 * 60 * 1000;

/** Job `cleanup_orphan_files`: xoá tệp tải lên từ chat quá 24 giờ mà không còn tham chiếu (L-5 / H-1). */
export function registerCleanupFilesHandler(): void {
  registerJobHandler<Record<string, never> | undefined>(CLEANUP_ORPHAN_FILES, async () => ({ removed: await cleanupOrphanFiles() }));
}

/** Xếp job dọn tệp nếu chưa có job cùng loại đang chờ/chạy. */
export async function enqueueCleanupOrphanFiles(): Promise<boolean> {
  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.type, CLEANUP_ORPHAN_FILES), inArray(jobs.status, ["queued", "running"])));
  if (Number(pending?.n ?? 0) > 0) return false;
  await enqueue(CLEANUP_ORPHAN_FILES, {}, { maxAttempts: 1 });
  return true;
}

/** Lập lịch dọn mỗi giờ (và một lần sau khi khởi động). Trả hàm huỷ. */
export function scheduleCleanupOrphanFiles(intervalMs = HOUR_MS): () => void {
  const run = () => {
    enqueueCleanupOrphanFiles().catch((err) => console.error("[cleanup_orphan_files] không xếp được job:", err));
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
