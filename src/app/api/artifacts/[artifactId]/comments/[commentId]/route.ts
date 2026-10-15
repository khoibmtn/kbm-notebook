import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { deleteComment, loadViewableArtifact } from "@/server/community/social";

type P = { artifactId: string; commentId: string };

/** Xoá bình luận của chính mình, hoặc bất kỳ bình luận nào nếu là admin+ của sổ tay chứa artifact. */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { artifactId, commentId } = await params;
  const { user } = await requireUser();
  const access = await loadViewableArtifact(user.id, artifactId);
  await deleteComment(access, user.id, commentId);
  return { ok: true };
});
