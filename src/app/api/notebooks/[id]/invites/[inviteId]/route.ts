import { ApiError, handleRoute, isUuid } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { revokeInvite } from "@/server/notebooks/service";

/** Thu hồi lời mời đang chờ (admin+). */
export const DELETE = handleRoute<{ id: string; inviteId: string }>(async (_req, { params }) => {
  const { id, inviteId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "admin");
  if (!isUuid(inviteId)) throw ApiError.notFound("Không tìm thấy lời mời");
  await revokeInvite(id, inviteId);
  return { ok: true };
});
