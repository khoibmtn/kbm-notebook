import { handleRoute } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { decideJoinRequest } from "@/server/community/join-requests";

type P = { id: string; requestId: string };

/** Từ chối yêu cầu (admin+). */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { id, requestId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "admin");
  return decideJoinRequest({ notebookId: id, requestId, actorId: user.id, decision: "reject" });
});
