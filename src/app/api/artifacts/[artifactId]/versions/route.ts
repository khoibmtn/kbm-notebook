import { handleRoute } from "@/server/api/errors";
import { getSession } from "@/server/auth/session";
import { listVersions, loadArtifactAccess } from "@/server/artifacts/service";

type P = { artifactId: string };

/** Lịch sử phiên bản (mới nhất trước). Khách (liên kết/công khai) chỉ thấy bản hiện tại. */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const session = await getSession();
  const token = new URL(req.url).searchParams.get("token");
  const access = await loadArtifactAccess(session?.user.id ?? null, artifactId, { shareToken: token });
  const all = await listVersions(access.artifact.id);
  // Khách chỉ thấy phiên bản hiện tại (lịch sử có thể chứa nội dung đã bị gỡ trước khi chia sẻ).
  return { versions: access.internal ? all : all.filter((v) => v.isCurrent) };
});
