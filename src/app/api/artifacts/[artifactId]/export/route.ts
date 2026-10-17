import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requestExport } from "@/server/artifacts/export-service";
import { loadArtifactAccess } from "@/server/artifacts/service";
import { exportArtifactSchema } from "@/lib/artifacts/meta";

type P = { artifactId: string };

/**
 * Xuất artifact. Định dạng nhẹ (docx, md, csv, json, pptx, svg infographic…) trả ngay `200 { export }`;
 * PDF/PNG/SVG mind map cần Chromium nên trả `202 { jobId }` — client chờ sự kiện `artifact:export`
 * hoặc hỏi lại `GET /exports?jobId=`. Mọi người xem được artifact đều xuất được.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  const input = await parseBody(exportArtifactSchema, req);
  const result = await requestExport({ artifact: access.artifact, userId: user.id, format: input.format, versionId: input.versionId });
  if (result.mode === "sync") return Response.json({ status: "done", export: result.export }, { status: 200 });
  return Response.json({ status: "queued", jobId: result.jobId }, { status: 202 });
});
