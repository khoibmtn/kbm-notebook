import { handleRoute } from "@/server/api/errors";
import { getSession, requireUser } from "@/server/auth/session";
import { getSocialSummary, likeArtifact, loadViewableArtifact, unlikeArtifact } from "@/server/community/social";

type P = { artifactId: string };

/** Số lượt thích + trạng thái của người xem. Khách xem được artifact công khai (không thể thích). */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const session = await getSession();
  const token = new URL(req.url).searchParams.get("token");
  await loadViewableArtifact(session?.user.id ?? null, artifactId, token);
  return getSocialSummary(artifactId, session?.user.id ?? null);
});

/** Thích (idempotent). Cần đăng nhập và quyền xem artifact; artifact riêng tư của người khác → 404. */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  await loadViewableArtifact(user.id, artifactId);
  return likeArtifact(artifactId, user.id);
});

export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  await loadViewableArtifact(user.id, artifactId);
  return unlikeArtifact(artifactId, user.id);
});
