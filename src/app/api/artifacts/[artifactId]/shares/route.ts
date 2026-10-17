import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { addShare, listShares, loadArtifactAccess, requireManage } from "@/server/artifacts/service";
import { addArtifactShareSchema } from "@/lib/artifacts/meta";

type P = { artifactId: string };

/** Danh sách người được chia sẻ riêng (editor+). */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireManage(access);
  return { shares: await listShares(access.artifact.id) };
});

/** Chia sẻ trực tiếp cho một người theo `email` hoặc `userId`, vai trò `view` | `edit` (editor+). */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireManage(access);
  const input = await parseBody(addArtifactShareSchema, req);
  const share = await addShare(access.artifact.id, input);
  return Response.json({ share }, { status: 201 });
});
