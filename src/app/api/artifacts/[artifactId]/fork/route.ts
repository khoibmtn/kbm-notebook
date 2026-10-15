import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { forkArtifact, loadArtifactAccess, requireManage, toDetailDto } from "@/server/artifacts/service";

type P = { artifactId: string };

/** Nhân bản artifact (editor+): bản sao độc lập, `forked_from_id` trỏ về bản gốc. */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireManage(access);
  const copy = await forkArtifact(access.artifact, user.id);
  const detail = await toDetailDto({ artifact: copy, role: access.role, canEdit: true, canManage: true });
  return Response.json({ artifact: detail }, { status: 201 });
});
