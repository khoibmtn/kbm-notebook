import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { sourceChunks, sources } from "@/server/db/schema";
import { hashEmbed } from "@/server/ai/mock";
import { estimateTokens } from "@/lib/sources";
import { claimJob, runJob } from "@/server/jobs/worker";

/** Nguồn `ready` có chunk + embedding thật (băm xác định của mock) — không cần chạy pipeline ingest. */
export async function insertReadySource(
  notebookId: string,
  createdBy: string,
  opts: { title?: string; pages: string[]; summary?: string; keyTopics?: string[]; visibility?: "shared" | "private" },
) {
  const raw = opts.pages.join("\n\n");
  const [src] = await db
    .insert(sources)
    .values({
      notebookId,
      createdBy,
      kind: "text",
      title: opts.title ?? "Nguồn thử",
      rawText: raw,
      status: "ready",
      visibility: opts.visibility ?? "shared",
      summary: opts.summary ?? opts.pages[0]?.slice(0, 200) ?? null,
      keyTopics: opts.keyTopics ?? null,
      pageCount: opts.pages.length,
      tokenCount: estimateTokens(raw),
      metadata: { unit: "page", progress: 100 },
    })
    .returning();
  let offset = 0;
  const rows = opts.pages.map((text, idx) => {
    const row = {
      sourceId: src.id,
      notebookId,
      idx,
      text,
      tokenCount: estimateTokens(text),
      page: idx + 1,
      startChar: offset,
      endChar: offset + text.length,
      embedding: hashEmbed(text),
    };
    offset += text.length + 2;
    return row;
  });
  if (rows.length) await db.insert(sourceChunks).values(rows);
  return src;
}

/** Chạy hết các job thuộc `types` đang chờ; trả về danh sách kết quả. */
export async function runJobsOfType(...types: string[]): Promise<string[]> {
  const out: string[] = [];
  for (;;) {
    const job = await claimJob("test-worker", types);
    if (!job) break;
    out.push(await runJob(job));
  }
  return out;
}

export const SAMPLE_PAGES = [
  "Quang hợp là quá trình thực vật chuyển hoá ánh sáng mặt trời, nước và khí cacbonic thành glucose và oxy trong lục lạp của tế bào.",
  "Ty thể là bào quan tạo ra ATP thông qua hô hấp tế bào, thường được gọi là nhà máy năng lượng của tế bào.",
  "Ribosome tổng hợp protein dựa trên thông tin di truyền do RNA thông tin mang đến từ nhân tế bào.",
];

/**
 * "Đỗ" các job đang chờ của một sổ tay (đẩy `run_at` sang ngày mai) để file test khác chạy song song trên cùng DB
 * (vd. `runIngestJobs` / `runJobsOfType`) không nhặt nhầm job của test này. Gọi ngay sau khi tạo job.
 */
export async function parkJobs(notebookId: string): Promise<void> {
  await db.execute(
    sql`UPDATE jobs SET run_at = now() + interval '1 day' WHERE status = 'queued' AND payload->>'notebookId' = ${notebookId}`,
  );
}
