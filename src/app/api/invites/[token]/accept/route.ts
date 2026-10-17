import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { acceptInvite } from "@/server/notebooks/service";

export const POST = handleRoute<{ token: string }>(async (_req, { params }) => {
  const { token } = await params;
  const { user } = await requireUser();
  const res = await acceptInvite(token, { id: user.id, email: user.email });
  return res;
});
