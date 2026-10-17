import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { createJoinRequest, listPendingJoinRequests } from "@/server/community/join-requests";
import { joinRequestSchema } from "@/lib/validators/community";

type P = { id: string };

/** Yêu cầu tham gia đang chờ (admin+). */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "admin");
  return { requests: await listPendingJoinRequests(id) };
});

/** Gửi yêu cầu tham gia sổ tay công khai (không phải thành viên). Sổ tay không công khai → 404. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const { message } = await parseBody(joinRequestSchema, req);
  const request = await createJoinRequest(id, { id: user.id, name: user.name }, message);
  return Response.json({ request }, { status: 201 });
});
