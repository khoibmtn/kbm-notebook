import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { updateAiSettingsSchema } from "@/lib/validators/settings";
import { getAiSettings, updateAiSettings } from "@/server/settings/service";

export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  return { settings: await getAiSettings(user.id) };
});

export const PUT = handleRoute(async (req) => {
  const { user } = await requireUser();
  const input = await parseBody(updateAiSettingsSchema, req);
  return { settings: await updateAiSettings(user.id, input) };
});
