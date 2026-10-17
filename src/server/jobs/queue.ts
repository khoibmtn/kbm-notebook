import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { jobs, type Job } from "@/server/db/schema";

/** Loại job đã biết (docs/02 §3.6). `noop` dùng cho test/health. */
export type JobType = "noop" | "ingest_source" | "generate_artifact" | "export_artifact" | "sync_connection" | (string & {});

export type EnqueueOptions = {
  /** Thời điểm sớm nhất được chạy (mặc định ngay). */
  runAt?: Date;
  /** Số lần thử tối đa (mặc định 3). */
  maxAttempts?: number;
};

/** Đưa job vào hàng đợi (bảng `jobs`); worker nhặt bằng FOR UPDATE SKIP LOCKED. */
export async function enqueue<P = unknown>(type: JobType, payload: P, opts: EnqueueOptions = {}): Promise<Job> {
  const [job] = await db
    .insert(jobs)
    .values({
      type,
      payload: payload as unknown,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .returning();
  return job;
}

export async function getJob(id: string): Promise<Job | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return job ?? null;
}
