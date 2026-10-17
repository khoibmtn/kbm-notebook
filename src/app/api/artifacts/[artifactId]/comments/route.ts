import { handleRoute, parseBody, parseQuery } from "@/server/api/errors";
import { getSession, requireUser } from "@/server/auth/session";
import { addComment, listComments, loadViewableArtifact } from "@/server/community/social";
import { commentSchema, commentsQuery } from "@/lib/validators/community";

type P = { artifactId: string };

/** Bình luận (cũ → mới). Khách xem được bình luận của artifact công khai. */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const session = await getSession();
  const token = new URL(req.url).searchParams.get("token");
  const access = await loadViewableArtifact(session?.user.id ?? null, artifactId, token);
  const { limit } = parseQuery(commentsQuery, req);
  return { comments: await listComments(access, session?.user.id ?? null, limit) };
});

/** Viết bình luận (markdown-lite). Cần đăng nhập + quyền xem artifact. 20 bình luận / phút. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadViewableArtifact(user.id, artifactId);
  const { body } = await parseBody(commentSchema, req);
  const comment = await addComment(access, user, body);
  return Response.json({ comment }, { status: 201 });
});
