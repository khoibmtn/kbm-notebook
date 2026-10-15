/**
 * Điểm vào của worker thread trích xuất văn bản. Được đóng gói riêng thành JS (esbuild) — xem `extract-sandbox.ts`.
 * Nhận `workerData: ExtractJob`, gửi lại đúng một thông điệp `ExtractWorkerReply` rồi thoát.
 */
import { parentPort, workerData } from "node:worker_threads";
import { IngestError } from "./errors";
import { runExtractJob, type ExtractJob } from "./extract";
import type { ExtractWorkerReply } from "./extract-sandbox";

async function main(): Promise<ExtractWorkerReply> {
  try {
    const result = await runExtractJob(workerData as ExtractJob);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof IngestError) return { ok: false, message: err.message, permanent: err.permanent };
    const message = err instanceof Error && err.message ? err.message : "Lỗi không xác định khi trích xuất";
    return { ok: false, message: `Không trích xuất được nội dung: ${message}`, permanent: true };
  }
}

void main().then((reply) => parentPort?.postMessage(reply));
