import { ApiError, handleRoute, isUuid, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { updateMemberSchema } from "@/lib/validators/notebooks";
import { changeMemberRole, removeMember } from "@/server/notebooks/service";

type P = { id: string; userId: string };

export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { id, userId } = await params;
  const { user } = await requireUser();
  const actorRole = await requireNotebookRole(user.id, id, "admin");
  if (!isUuid(userId)) throw ApiError.notFound("Không tìm thấy thành viên");
  const { role } = await parseBody(updateMemberSchema, req);
  await changeMemberRole({ notebookId: id, actorId: user.id, actorRole, targetUserId: userId, role });
  return { ok: true };
});

/** Xoá thành viên (admin+) hoặc tự rời sổ tay (mọi vai trò trừ owner). */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { id, userId } = await params;
  const { user } = await requireUser();
  if (!isUuid(userId)) throw ApiError.notFound("Không tìm thấy thành viên");
  const actorRole = await requireNotebookRole(user.id, id, userId === user.id ? "viewer" : "admin");
  await removeMember({ notebookId: id, actorId: user.id, actorRole, targetUserId: userId });
  return { ok: true };
});
