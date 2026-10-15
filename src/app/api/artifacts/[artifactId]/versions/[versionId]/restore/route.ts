import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { loadArtifactAccess, requireEdit, restoreVersion, toDetailDto } from "@/server/artifacts/service";

type P = { artifactId: string; versionId: string };

/** Khôi phục = tạo phiên bản MỚI mang nội dung của phiên bản được chọn (lịch sử không bị ghi đè). */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { artifactId, versionId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireEdit(access);
  const version = await restoreVersion(access.artifact, versionId, user.id);
  const detail = await toDetailDto(await loadArtifactAccess(user.id, artifactId));
  return { artifact: detail, version: { id: version.id, versionNo: version.versionNo } };
});
