import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { hasRole, requireNotebookRole } from "@/server/auth/permissions";
import { inviteMemberSchema } from "@/lib/validators/notebooks";
import { inviteMember, listMembers, listPendingInvites } from "@/server/notebooks/service";

type P = { id: string };

export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "viewer");
  const members = await listMembers(id);
  // Lời mời đang chờ (kèm token) chỉ hiển thị cho admin+.
  const invites = hasRole(role, "admin") ? await listPendingInvites(id) : [];
  return { members, invites, role };
});

export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const actorRole = await requireNotebookRole(user.id, id, "admin");
  const input = await parseBody(inviteMemberSchema, req);
  const result = await inviteMember({
    notebookId: id,
    actorId: user.id,
    actorRole,
    email: input.email,
    role: input.role,
  });
  return Response.json(result, { status: 201 });
});
