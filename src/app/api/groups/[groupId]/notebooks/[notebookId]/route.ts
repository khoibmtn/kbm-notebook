import { ApiError, handleRoute, isUuid } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireGroupAccess, unlinkNotebook } from "@/server/community/groups";

type P = { groupId: string; notebookId: string };

/** Gỡ liên kết: admin+ của sổ tay hoặc admin+ của nhóm. */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { groupId, notebookId } = await params;
  const { user } = await requireUser();
  const { group } = await requireGroupAccess(user.id, groupId, "member");
  if (!isUuid(notebookId)) throw ApiError.notFound("Không tìm thấy sổ tay");
  await unlinkNotebook(group, user.id, notebookId);
  return { ok: true };
});
