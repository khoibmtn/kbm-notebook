import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { loadArtifactAccess, toDetailDto } from "@/server/artifacts/service";
import { aiEditSlide, slideAiEditSchema } from "@/server/artifacts/slide-ai-edit";

type P = { artifactId: string; slideId: string };

/**
 * Sửa một slide bằng AI (người sửa được: editor+ hoặc được chia sẻ quyền sửa). Body `{ instruction }`.
 * Lưu thành phiên bản mới; trả `{ artifact, version }` với `artifact.content` là bộ slide đã cập nhật.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { artifactId, slideId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  const input = await parseBody(slideAiEditSchema, req);
  const { version } = await aiEditSlide(access, user.id, slideId, input);
  const fresh = await loadArtifactAccess(user.id, artifactId);
  return { artifact: await toDetailDto(fresh), version: { id: version.id, versionNo: version.versionNo } };
});
