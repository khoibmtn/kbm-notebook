import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { transferOwnershipSchema } from "@/lib/validators/notebooks";
import { transferOwnership } from "@/server/notebooks/service";

export const POST = handleRoute<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "owner");
  const { userId } = await parseBody(transferOwnershipSchema, req);
  await transferOwnership(id, user.id, userId);
  return { ok: true };
});
