import { ApiError, handleRoute } from "@/server/api/errors";
import { getSession } from "@/server/auth/session";
import { getVersion, loadArtifactAccess } from "@/server/artifacts/service";

type P = { artifactId: string; versionId: string };

/** Nội dung của một phiên bản cũ (để xem trước trước khi khôi phục). */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { artifactId, versionId } = await params;
  const session = await getSession();
  const token = new URL(req.url).searchParams.get("token");
  const access = await loadArtifactAccess(session?.user.id ?? null, artifactId, { shareToken: token });
  const v = await getVersion(access.artifact.id, versionId);
  if (!access.internal && v.id !== access.artifact.currentVersionId) throw ApiError.notFound("Không tìm thấy phiên bản");
  return {
    version: {
      id: v.id,
      artifactId: v.artifactId,
      versionNo: v.versionNo,
      note: v.note,
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
      isCurrent: v.id === access.artifact.currentVersionId,
      content: v.content,
    },
  };
});
