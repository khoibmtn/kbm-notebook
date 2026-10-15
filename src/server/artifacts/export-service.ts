import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { emitToUser } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { artifactExports, artifactVersions, files, type Artifact, type ArtifactVersionRow } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/queue";
import { canAccessFile } from "@/server/storage/files";
import { getStorage } from "@/server/storage/local";
import { isAsyncExport, isExportFormatAllowed, type ArtifactExportDto, type ArtifactExportEvent, type ExportFormat } from "@/lib/artifacts/meta";
import { buildExport } from "./exporters";
import { assertEngineAvailable } from "./registry";
import { getVersion } from "./service";

/** Payload job `export_artifact`. */
export type ExportArtifactPayload = {
  artifactId: string;
  versionId: string;
  format: ExportFormat;
  notebookId: string;
  userId: string;
};

function toDto(
  row: { id: string; artifactId: string; versionId: string; format: ExportFormat; fileId: string; createdAt: Date },
  file: { originalName: string; sizeBytes: number },
  versionNo: number | null,
): ArtifactExportDto {
  return {
    id: row.id,
    artifactId: row.artifactId,
    versionId: row.versionId,
    versionNo,
    format: row.format,
    fileId: row.fileId,
    fileName: file.originalName,
    sizeBytes: file.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    url: `/api/files/${row.fileId}?download=1`,
  };
}

export async function listExports(artifactId: string): Promise<ArtifactExportDto[]> {
  const rows = await db
    .select({
      e: artifactExports,
      name: files.originalName,
      size: files.sizeBytes,
      versionNo: artifactVersions.versionNo,
    })
    .from(artifactExports)
    .innerJoin(files, eq(files.id, artifactExports.fileId))
    .leftJoin(artifactVersions, eq(artifactVersions.id, artifactExports.versionId))
    .where(eq(artifactExports.artifactId, artifactId))
    .orderBy(desc(artifactExports.createdAt));
  return rows.map((r) => toDto(r.e, { originalName: r.name, sizeBytes: r.size }, r.versionNo));
}

async function resolveVersion(artifact: Artifact, versionId?: string): Promise<ArtifactVersionRow> {
  const id = versionId ?? artifact.currentVersionId;
  if (!id) throw ApiError.conflict("Artifact chưa có nội dung để xuất", "not_ready");
  return getVersion(artifact.id, id);
}

/** Dựng bản xuất, lưu tệp (chủ tệp = người yêu cầu) và ghi `artifact_exports`. */
export async function produceExport(params: {
  artifact: Pick<Artifact, "id" | "type" | "title">;
  version: ArtifactVersionRow;
  format: ExportFormat;
  userId: string;
}): Promise<ArtifactExportDto> {
  const { artifact, version, format, userId } = params;
  const out = await buildExport(
    {
      type: artifact.type,
      title: artifact.title,
      content: version.content,
      versionNo: version.versionNo,
      resolveImage: async (fileId) => {
        if (!(await canAccessFile(userId, fileId))) return null;
        const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
        if (!f) return null;
        const stream = await getStorage().getStream(f.storageKey);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        return Buffer.concat(chunks);
      },
    },
    format,
  );
  const stored = await getStorage().put(out.buffer, { ownerId: userId, mime: out.mime, name: out.fileName });
  const [row] = await db
    .insert(artifactExports)
    .values({ artifactId: artifact.id, versionId: version.id, format, fileId: stored.id })
    .returning();
  return toDto(row, stored, version.versionNo);
}

export type RequestExportResult =
  | { mode: "sync"; export: ArtifactExportDto }
  | { mode: "async"; jobId: string };

/**
 * Yêu cầu xuất: định dạng cần Chromium (PDF, PNG, SVG mind map) → job `export_artifact` (202);
 * còn lại xuất ngay (200). Người xem được artifact đều được xuất.
 */
export async function requestExport(params: {
  artifact: Artifact;
  userId: string;
  format: ExportFormat;
  versionId?: string;
}): Promise<RequestExportResult> {
  const { artifact, userId, format } = params;
  if (!isExportFormatAllowed(artifact.type, format)) {
    throw ApiError.badRequest(`Định dạng ${format.toUpperCase()} không áp dụng cho loại này`, "unsupported_format");
  }
  if (format === "pptx" || (artifact.type === "infographic" && format !== "json")) assertEngineAvailable(artifact.type);
  const version = await resolveVersion(artifact, params.versionId);
  if (isAsyncExport(artifact.type, format)) {
    const payload: ExportArtifactPayload = { artifactId: artifact.id, versionId: version.id, format, notebookId: artifact.notebookId, userId };
    const job = await enqueue("export_artifact", payload);
    return { mode: "async", jobId: job.id };
  }
  return { mode: "sync", export: await produceExport({ artifact, version, format, userId }) };
}

export function emitExportEvent(userId: string, event: ArtifactExportEvent): void {
  emitToUser(userId, "artifact:export", event);
}

export async function getExportJob(jobId: string, userId: string) {
  const { getJob } = await import("@/server/jobs/queue");
  const job = await getJob(jobId);
  const p = job?.payload as Partial<ExportArtifactPayload> | undefined;
  if (!job || job.type !== "export_artifact" || p?.userId !== userId) return null;
  return job;
}

export async function findExportById(artifactId: string, exportId: string) {
  const [row] = await db
    .select()
    .from(artifactExports)
    .where(and(eq(artifactExports.id, exportId), eq(artifactExports.artifactId, artifactId)))
    .limit(1);
  return row ?? null;
}
