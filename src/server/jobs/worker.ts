import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "@/server/db";
import type { Job } from "@/server/db/schema";
import { emitJobProgress } from "@/server/chat/realtime";

export type JobContext<P = unknown> = {
  job: Job;
  payload: P;
  /** Cập nhật tiến độ 0–100 (ghi DB + phát sự kiện realtime `job:progress`). */
  progress(percent: number): Promise<void>;
};

export type JobHandler<P = unknown, R = unknown> = (ctx: JobContext<P>) => Promise<R> | R;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler<P = unknown, R = unknown>(type: string, fn: JobHandler<P, R>): void {
  handlers.set(type, fn as JobHandler);
}

export function getRegisteredJobTypes(): string[] {
  return [...handlers.keys()];
}

/** Backoff giữa các lần thử: 5s, 20s, 80s... */
export function backoffMs(attempt: number): number {
  return 5000 * 4 ** Math.max(0, attempt - 1);
}

type JobRow = {
  id: string;
  type: string;
  payload: unknown;
  status: Job["status"];
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  progress: number;
  result: unknown;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAt: r.run_at,
    lockedAt: r.locked_at,
    lockedBy: r.locked_by,
    progress: r.progress,
    result: r.result,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Nhận 1 job đến hạn (FOR UPDATE SKIP LOCKED) và chuyển sang running. */
export async function claimJob(workerId: string, types = getRegisteredJobTypes()): Promise<Job | null> {
  if (types.length === 0) return null;
  const res = await pool.query<JobRow>(
    `UPDATE jobs SET status = 'running', locked_at = now(), locked_by = $1,
            attempts = attempts + 1, updated_at = now()
      WHERE id = (
        SELECT id FROM jobs
         WHERE status = 'queued' AND run_at <= now() AND type = ANY($2::text[])
         ORDER BY run_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING *`,
    [workerId, types],
  );
  return res.rows[0] ? toJob(res.rows[0]) : null;
}

async function setProgress(job: Job, percent: number): Promise<void> {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  await db.execute(sql`UPDATE jobs SET progress = ${p}, updated_at = now() WHERE id = ${job.id}`);
  emitJobProgress(job.payload, { jobId: job.id, type: job.type, status: "running", progress: p });
}

/** Xử lý một job đã claim: thành công → done; lỗi → retry với backoff hoặc failed. */
export async function runJob(job: Job): Promise<"done" | "retry" | "failed"> {
  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`Không có handler cho loại job "${job.type}"`);
    const result = await handler({
      job,
      payload: job.payload,
      progress: (percent) => setProgress(job, percent),
    });
    await pool.query(
      `UPDATE jobs SET status = 'done', progress = 100, result = $2::jsonb, error = NULL,
              locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1`,
      [job.id, JSON.stringify(result ?? null)],
    );
    emitJobProgress(job.payload, { jobId: job.id, type: job.type, status: "done", progress: 100 });
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.attempts < job.maxAttempts) {
      await pool.query(
        `UPDATE jobs SET status = 'queued', error = $2, run_at = now() + ($3 || ' milliseconds')::interval,
                locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1`,
        [job.id, message, String(backoffMs(job.attempts))],
      );
      return "retry";
    }
    await pool.query(
      `UPDATE jobs SET status = 'failed', error = $2, locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1`,
      [job.id, message],
    );
    emitJobProgress(job.payload, { jobId: job.id, type: job.type, status: "failed", progress: job.progress, error: message });
    return "failed";
  }
}

/** Claim + chạy một job. Trả null nếu hàng đợi trống. */
export async function processNextJob(workerId = "worker"): Promise<{ job: Job; outcome: "done" | "retry" | "failed" } | null> {
  const job = await claimJob(workerId);
  if (!job) return null;
  const outcome = await runJob(job);
  return { job, outcome };
}

/** Job `running` quá lâu (worker chết) → đưa về hàng đợi. */
export async function requeueStaleJobs(staleAfterMs = 10 * 60 * 1000): Promise<number> {
  const res = await pool.query(
    `UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed'::job_status ELSE 'queued'::job_status END,
            error = COALESCE(error, 'Worker bị gián đoạn'), locked_at = NULL, locked_by = NULL, updated_at = now()
      WHERE status = 'running' AND locked_at < now() - ($1 || ' milliseconds')::interval`,
    [String(staleAfterMs)],
  );
  return res.rowCount ?? 0;
}

export type WorkerHandle = { stop(): Promise<void> };

const g = globalThis as unknown as { __kbmWorker?: WorkerHandle };

/** Vòng lặp poll (mặc định 1s, concurrency 2). Idempotent: gọi lại sẽ trả worker đang chạy. */
export function startWorker(opts: { concurrency?: number; pollMs?: number } = {}): WorkerHandle {
  if (g.__kbmWorker) return g.__kbmWorker;
  const concurrency = opts.concurrency ?? 2;
  const pollMs = opts.pollMs ?? 1000;
  const workerId = `w-${process.pid}-${randomUUID().slice(0, 8)}`;
  let stopped = false;
  let active = 0;
  let timer: NodeJS.Timeout | null = null;
  let lastSweep = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      if (Date.now() - lastSweep > 60_000) {
        lastSweep = Date.now();
        await requeueStaleJobs();
      }
      while (!stopped && active < concurrency) {
        const job = await claimJob(workerId);
        if (!job) break;
        active++;
        void runJob(job)
          .catch((e) => console.error("[jobs] runJob lỗi", e))
          .finally(() => {
            active--;
          });
      }
    } catch (err) {
      console.error("[jobs] poll lỗi", err);
    } finally {
      if (!stopped) timer = setTimeout(tick, pollMs);
    }
  };
  timer = setTimeout(tick, 0);

  const handle: WorkerHandle = {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const deadline = Date.now() + 10_000;
      while (active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      g.__kbmWorker = undefined;
    },
  };
  g.__kbmWorker = handle;
  return handle;
}
