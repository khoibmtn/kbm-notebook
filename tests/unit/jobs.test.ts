import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { jobs } from "@/server/db/schema";
import { enqueue, getJob } from "@/server/jobs/queue";
import { registerBuiltinHandlers } from "@/server/jobs/handlers";
import { backoffMs, claimJob, processNextJob, registerJobHandler, requeueStaleJobs } from "@/server/jobs/worker";

registerBuiltinHandlers();

// Mỗi test dùng loại job riêng để không giẫm lên nhau khi chạy song song.
const uniqueType = () => `test_${randomUUID().slice(0, 8)}`;

async function drain(type: string, workerId = "t") {
  const job = await claimJob(workerId, [type]);
  return job;
}

describe("job queue", () => {
  it("enqueue ghi job ở trạng thái queued", async () => {
    const type = uniqueType();
    const job = await enqueue(type, { a: 1 });
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect((await getJob(job.id))?.payload).toEqual({ a: 1 });
  });

  it("handler noop chạy xong → done, progress 100, có result", async () => {
    const job = await enqueue("noop", { steps: 4, tag: randomUUID() });
    // noop là handler dùng chung; claim đúng job vừa tạo bằng cách chạy cho tới khi gặp nó
    let ran = false;
    for (let i = 0; i < 50 && !ran; i++) {
      const r = await processNextJob("t-noop");
      if (!r) break;
      if (r.job.id === job.id) {
        ran = true;
        expect(r.outcome).toBe("done");
      }
    }
    expect(ran).toBe(true);
    const done = await getJob(job.id);
    expect(done?.status).toBe("done");
    expect(done?.progress).toBe(100);
    expect(done?.result).toEqual({ ok: true });
    expect(done?.lockedBy).toBeNull();
  });

  it("job lỗi được thử lại với backoff rồi failed khi hết lượt", async () => {
    const type = uniqueType();
    registerJobHandler(type, async () => {
      throw new Error("hỏng rồi");
    });
    const job = await enqueue(type, {}, { maxAttempts: 2 });

    const first = await drain(type);
    expect(first?.id).toBe(job.id);
    await import("@/server/jobs/worker").then((m) => m.runJob(first!));
    const afterFirst = await getJob(job.id);
    expect(afterFirst?.status).toBe("queued");
    expect(afterFirst?.attempts).toBe(1);
    expect(afterFirst?.error).toBe("hỏng rồi");
    expect(afterFirst!.runAt.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 2000);
    // chưa đến hạn → không nhận được
    expect(await drain(type)).toBeNull();

    // kéo run_at về quá khứ để thử lần 2
    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, job.id));
    const second = await drain(type);
    expect(second?.attempts).toBe(2);
    const { runJob } = await import("@/server/jobs/worker");
    expect(await runJob(second!)).toBe("failed");
    const failed = await getJob(job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("hỏng rồi");
  });

  it("loại job chưa có handler thì không bị nhận", async () => {
    const type = uniqueType();
    await enqueue(type, {});
    expect(await claimJob("t", [type + "_other"])).toBeNull();
  });

  it("SKIP LOCKED: nhiều worker claim đồng thời không nhận trùng job", async () => {
    const type = uniqueType();
    const created = await Promise.all(Array.from({ length: 6 }, (_, i) => enqueue(type, { i })));
    const claimed = await Promise.all(Array.from({ length: 10 }, (_, i) => claimJob(`w${i}`, [type])));
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(new Set(created.map((j) => j.id))).toEqual(new Set(ids));
  });

  it("progress() ghi vào DB giữa chừng", async () => {
    const type = uniqueType();
    let seen = -1;
    registerJobHandler(type, async ({ job, progress }) => {
      await progress(40);
      seen = (await getJob(job.id))?.progress ?? -1;
      return "ok";
    });
    const job = await enqueue(type, {});
    const claimed = await drain(type);
    const { runJob } = await import("@/server/jobs/worker");
    await runJob(claimed!);
    expect(seen).toBe(40);
    expect((await getJob(job.id))?.result).toBe("ok");
  });

  it("requeueStaleJobs đưa job running bị bỏ rơi về queued", async () => {
    const type = uniqueType();
    registerJobHandler(type, async () => 1);
    const job = await enqueue(type, {});
    await drain(type);
    await db.update(jobs).set({ lockedAt: new Date(Date.now() - 3_600_000) }).where(eq(jobs.id, job.id));
    expect(await requeueStaleJobs(60_000)).toBeGreaterThanOrEqual(1);
    expect((await getJob(job.id))?.status).toBe("queued");
  });
});
