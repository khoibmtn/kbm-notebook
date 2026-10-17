import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { loadArtifactAccess, removeShare, requireManage } from "@/server/artifacts/service";

type P = { artifactId: string; shareId: string };

/** Thu hồi một lượt chia sẻ riêng (editor+). */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { artifactId, shareId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireManage(access);
  await removeShare(access.artifact.id, shareId);
  return { ok: true };
});
