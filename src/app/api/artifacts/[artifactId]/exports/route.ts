import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { getExportJob, listExports } from "@/server/artifacts/export-service";
import { loadArtifactAccess } from "@/server/artifacts/service";

type P = { artifactId: string };

/** Các bản đã xuất (mới nhất trước). `?jobId=` kèm trạng thái job xuất của chính người gọi (polling). */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  const exports = await listExports(access.artifact.id);
  const jobId = new URL(req.url).searchParams.get("jobId");
  let job: { id: string; status: string; error: string | null; progress: number } | null = null;
  if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) {
    const j = await getExportJob(jobId, user.id);
    if (j) job = { id: j.id, status: j.status, error: j.error, progress: j.progress };
  }
  return { exports, job };
});
