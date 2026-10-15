import { handleRoute } from "@/server/api/errors";
import { getSession } from "@/server/auth/session";
import { listVersions, loadArtifactAccess } from "@/server/artifacts/service";

type P = { artifactId: string };

/** Lịch sử phiên bản (mới nhất trước). */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const session = await getSession();
  const token = new URL(req.url).searchParams.get("token");
  const access = await loadArtifactAccess(session?.user.id ?? null, artifactId, { shareToken: token });
  return { versions: await listVersions(access.artifact.id) };
});
