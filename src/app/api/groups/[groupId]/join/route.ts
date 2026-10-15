import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { getGroupById, getGroupRole, joinGroup, summarizeGroup } from "@/server/community/groups";
import { ApiError } from "@/server/api/errors";

type P = { groupId: string };

/** Tham gia nhóm mở. Nhóm riêng tư → 404 với người ngoài (không lộ sự tồn tại) vì chỉ vào được bằng lời mời. */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { groupId } = await params;
  const { user } = await requireUser();
  const group = await getGroupById(groupId);
  if (group.visibility !== "public" && !(await getGroupRole(user.id, groupId))) throw ApiError.notFound("Không tìm thấy nhóm");
  await joinGroup(group, user.id);
  return { group: await summarizeGroup(group, user.id) };
});
