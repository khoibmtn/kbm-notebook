import { ApiError, handleRoute, isUuid, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { removeGroupMember, requireGroupAccess, setGroupMemberRole } from "@/server/community/groups";
import { updateGroupMemberSchema } from "@/lib/validators/community";

type P = { groupId: string; userId: string };

/** Đổi vai trò admin/thành viên (chỉ chủ nhóm). */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { groupId, userId } = await params;
  const { user } = await requireUser();
  const { group } = await requireGroupAccess(user.id, groupId, "owner");
  if (!isUuid(userId)) throw ApiError.notFound("Không tìm thấy thành viên");
  const { role } = await parseBody(updateGroupMemberSchema, req);
  await setGroupMemberRole(group, userId, role);
  return { ok: true };
});

/** Rời nhóm (userId = chính mình) hoặc xoá thành viên (admin+). */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { groupId, userId } = await params;
  const { user } = await requireUser();
  const { group, role } = await requireGroupAccess(user.id, groupId, "member");
  if (!isUuid(userId)) throw ApiError.notFound("Không tìm thấy thành viên");
  await removeGroupMember(group, { id: user.id, role: role! }, userId);
  return { ok: true };
});
