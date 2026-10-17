import "server-only";
import { ingestSource, type IngestDeps } from "@/server/knowledge/ingest/pipeline";
import { IngestError } from "@/server/knowledge/ingest/errors";
import { setSourceStatus, type IngestPayload } from "@/server/knowledge/sources";
import { registerJobHandler, type JobHandler } from "../worker";

/** Lỗi nào thử lại cũng vô ích (tệp hỏng, thiếu cấu hình AI, khoá sai…)? */
export function classifyIngestError(err: unknown): { message: string; permanent: boolean } {
  if (err instanceof IngestError) return { message: err.message, permanent: err.permanent };
  const e = err as { name?: string; message?: string; status?: number | null } | null;
  const message = e?.message ? String(e.message) : "Lỗi không xác định khi xử lý nguồn";
  if (e?.name === "AiNotConfiguredError") return { message, permanent: true };
  if (e?.name === "AiProviderError" && typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.status !== 429) {
    return { message, permanent: true };
  }
  return { message, permanent: false };
}

/** Handler job `ingest_source`: xử lý nguồn; lỗi vĩnh viễn → `failed` (không retry), lỗi tạm → retry theo backoff của worker. */
export function createIngestHandler(deps: IngestDeps = {}): JobHandler<IngestPayload> {
  return async ({ job, payload }) => {
    try {
      return await ingestSource(payload.sourceId, deps);
    } catch (err) {
      const { message, permanent } = classifyIngestError(err);
      const lastAttempt = job.attempts >= job.maxAttempts;
      if (permanent || lastAttempt) {
        await setSourceStatus(payload.sourceId, { status: "failed", error: message, change: "updated" });
        if (permanent) return { failed: true, error: message };
        throw err;
      }
      await setSourceStatus(payload.sourceId, { status: "processing", error: `Lỗi tạm thời, đang thử lại: ${message}` });
      throw err;
    }
  };
}

/** Đăng ký handler `ingest_source` — gọi từ `server.ts` (worker chạy trong module graph của server.ts). */
export function registerIngestHandler(): void {
  registerJobHandler<IngestPayload>("ingest_source", createIngestHandler());
}
