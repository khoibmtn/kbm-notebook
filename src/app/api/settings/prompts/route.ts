import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { updatePromptsSchema } from "@/lib/validators/settings";
import { getPrompts, savePrompts } from "@/server/settings/service";
import { isArtifactType } from "@/server/ai/prompts/defaults";
import { ApiError } from "@/server/api/errors";

export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  return { prompts: await getPrompts(user.id) };
});

export const PUT = handleRoute(async (req) => {
  const { user } = await requireUser();
  const { prompts } = await parseBody(updatePromptsSchema, req);
  for (const key of Object.keys(prompts)) {
    if (!isArtifactType(key)) throw ApiError.badRequest(`Loại artifact không hợp lệ: ${key}`);
  }
  return { prompts: await savePrompts(user.id, prompts) };
});
