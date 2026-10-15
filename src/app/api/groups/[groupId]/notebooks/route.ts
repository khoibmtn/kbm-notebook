import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { linkNotebook, listGroupNotebooks, requireGroupAccess } from "@/server/community/groups";
import { linkGroupNotebookSchema } from "@/lib/validators/community";

type P = { groupId: string };

/** Liên kết sổ tay vào nhóm: người gọi là thành viên nhóm VÀ admin+ của sổ tay. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { groupId } = await params;
  const { user } = await requireUser();
  const { group, role } = await requireGroupAccess(user.id, groupId, "member");
  const { notebookId } = await parseBody(linkGroupNotebookSchema, req);
  await linkNotebook(group, user.id, notebookId);
  return Response.json({ notebooks: await listGroupNotebooks(group, user.id, role) }, { status: 201 });
});
