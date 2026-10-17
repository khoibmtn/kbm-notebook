import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { deleteGroup, listGroupMembers, listGroupNotebooks, requireGroupAccess, summarizeGroup, updateGroup } from "@/server/community/groups";
import { updateGroupSchema } from "@/lib/validators/community";

type P = { groupId: string };

/** Chi tiết nhóm: mô tả, số thành viên, sổ tay liên kết (chỉ những sổ tay người xem được truy cập, trừ thành viên nhóm thấy cả tiêu đề bị khoá). */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { groupId } = await params;
  const { user } = await requireUser();
  const { group, role } = await requireGroupAccess(user.id, groupId);
  return {
    group: await summarizeGroup(group, user.id),
    members: role ? await listGroupMembers(group.id, role) : [],
    notebooks: await listGroupNotebooks(group, user.id, role),
  };
});

/** Sửa tên/mô tả/chế độ tham gia (admin+ của nhóm). */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { groupId } = await params;
  const { user } = await requireUser();
  const { group } = await requireGroupAccess(user.id, groupId, "admin");
  const patch = await parseBody(updateGroupSchema, req);
  const row = await updateGroup(group, patch);
  return { group: await summarizeGroup(row, user.id) };
});

/** Xoá nhóm (chỉ chủ nhóm). */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { groupId } = await params;
  const { user } = await requireUser();
  const { group } = await requireGroupAccess(user.id, groupId, "owner");
  await deleteGroup(group.id);
  return { ok: true };
});
