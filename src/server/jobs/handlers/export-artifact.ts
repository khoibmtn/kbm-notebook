import "server-only";
import { eq } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { artifacts } from "@/server/db/schema";
import { emitExportEvent, produceExport, type ExportArtifactPayload } from "@/server/artifacts/export-service";
import { getVersion } from "@/server/artifacts/service";
import { registerJobHandler, type JobHandler } from "../worker";

export type ExportOutcome =
  | { ok: true; exportId: string; fileId: string; format: string }
  | { ok: false; error: string };

/**
 * Lõi job `export_artifact` (PDF/PNG/SVG mind map cần Chromium): dựng tệp → `files` + `artifact_exports`
 * → phát `artifact:export` tới người yêu cầu. Lỗi vĩnh viễn (artifact đã xoá, định dạng sai, thiếu engine) không retry.
 */
export async function exportArtifactNow(payload: ExportArtifactPayload, attempt: { attempts: number; maxAttempts: number }, jobId = ""): Promise<ExportOutcome> {
  const fail = (error: string): ExportOutcome => {
    emitExportEvent(payload.userId, { artifactId: payload.artifactId, jobId, status: "failed", error });
    return { ok: false, error };
  };
  try {
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, payload.artifactId)).limit(1);
    if (!artifact || artifact.deletedAt) return fail("Artifact đã bị xoá");
    const version = await getVersion(artifact.id, payload.versionId);
    const dto = await produceExport({ artifact, version, format: payload.format, userId: payload.userId });
    emitExportEvent(payload.userId, { artifactId: artifact.id, jobId, status: "done", export: dto });
    return { ok: true, exportId: dto.id, fileId: dto.fileId, format: dto.format };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Không xuất được tệp";
    const permanent = err instanceof ApiError && err.status < 500 ? true : err instanceof ApiError && err.status === 501;
    if (permanent || attempt.attempts >= attempt.maxAttempts) {
      fail(message);
      if (permanent) return { ok: false, error: message };
    }
    throw err;
  }
}

export function createExportArtifactHandler(): JobHandler<ExportArtifactPayload> {
  return async ({ job, payload }) => {
    const out = await exportArtifactNow(payload, { attempts: job.attempts, maxAttempts: job.maxAttempts }, job.id);
    return out;
  };
}

/** Đăng ký handler `export_artifact` — gọi từ `server.ts`. */
export function registerExportArtifactHandler(): void {
  registerJobHandler<ExportArtifactPayload>("export_artifact", createExportArtifactHandler());
}
