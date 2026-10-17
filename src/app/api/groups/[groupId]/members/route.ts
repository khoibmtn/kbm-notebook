import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { addGroupMemberByEmail, listGroupMembers, requireGroupAccess } from "@/server/community/groups";
import { addGroupMemberSchema } from "@/lib/validators/community";

type P = { groupId: string };

export const GET = handleRoute<P>(async (_req, { params }) => {
  const { groupId } = await params;
  const { user } = await requireUser();
  const { group, role } = await requireGroupAccess(user.id, groupId, "member");
  return { members: await listGroupMembers(group.id, role) };
});

/** Thêm thành viên bằng email (admin+; chỉ chủ nhóm thêm quản trị viên). Dùng cho nhóm chỉ theo lời mời. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { groupId } = await params;
  const { user } = await requireUser();
  const { group, role } = await requireGroupAccess(user.id, groupId, "admin");
  const input = await parseBody(addGroupMemberSchema, req);
  await addGroupMemberByEmail(group, role!, input);
  return Response.json({ members: await listGroupMembers(group.id, role) }, { status: 201 });
});
