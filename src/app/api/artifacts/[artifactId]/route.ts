import { handleRoute, parseBody } from "@/server/api/errors";
import { getSession, requireUser } from "@/server/auth/session";
import {
  deleteArtifact,
  loadArtifactAccess,
  requireEdit,
  requireManage,
  toArtifactDto,
  toDetailDto,
  updateArtifact,
} from "@/server/artifacts/service";
import { updateArtifactSchema } from "@/lib/artifacts/meta";

type P = { artifactId: string };

/** Chi tiết artifact + nội dung phiên bản hiện tại. Khách chưa đăng nhập xem được artifact `public` (hoặc `link` kèm `?token=`). */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const session = await getSession();
  const token = new URL(req.url).searchParams.get("token");
  const access = await loadArtifactAccess(session?.user.id ?? null, artifactId, { shareToken: token });
  return { artifact: await toDetailDto(access) };
});

/** Sửa tiêu đề và/hoặc nội dung (nội dung → phiên bản mới). Cần quyền sửa (editor+ hoặc được chia sẻ `edit`). */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireEdit(access);
  const input = await parseBody(updateArtifactSchema, req);
  const { artifact, version } = await updateArtifact(access, user.id, input);
  const detail = await toDetailDto({ ...access, artifact });
  return { artifact: detail, version: version ? { id: version.id, versionNo: version.versionNo } : null };
});

/** Xoá mềm (editor+). */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireManage(access);
  await deleteArtifact(access.artifact);
  return { ok: true, artifact: toArtifactDto({ artifact: access.artifact, versionNo: null, creatorName: null }, access) };
});
