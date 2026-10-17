import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { updateNotificationsSchema } from "@/lib/validators/settings";
import { setNotifyEmail } from "@/server/settings/service";

export const PUT = handleRoute(async (req) => {
  const { user } = await requireUser();
  const { notifyEmail } = await parseBody(updateNotificationsSchema, req);
  await setNotifyEmail(user.id, notifyEmail);
  return { ok: true, notifyEmail };
});
