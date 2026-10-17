import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { updateProfileSchema } from "@/lib/validators/settings";
import { getProfileSettings, updateProfileSettings } from "@/server/settings/service";

export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  return { profile: await getProfileSettings(user.id) };
});

export const PATCH = handleRoute(async (req) => {
  const { user } = await requireUser();
  const input = await parseBody(updateProfileSchema, req);
  return { profile: await updateProfileSettings(user.id, input) };
});
