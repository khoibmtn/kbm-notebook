import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { updatePromptsSchema } from "@/lib/validators/settings";
import { getPrompts, savePrompts } from "@/server/settings/service";
import { ARTIFACT_TYPES, DEFAULT_PROMPTS, isArtifactType, resolvePrompt } from "@/server/ai/prompts/defaults";
import { ApiError } from "@/server/api/errors";

/**
 * `prompts`: phần người dùng đã ghi đè; `defaults`: mặc định trong code; `effective`: prompt hiệu lực
 * (mặc định ⊕ ghi đè) — hộp "Tuỳ chỉnh" của Studio hiển thị `effective` cho từng loại artifact.
 */
export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  const prompts = await getPrompts(user.id);
  const defaults = Object.fromEntries(ARTIFACT_TYPES.map((t) => [t, DEFAULT_PROMPTS[t]]));
  const effective = Object.fromEntries(ARTIFACT_TYPES.map((t) => [t, resolvePrompt(t, prompts[t])]));
  return { prompts, defaults, effective };
});

export const PUT = handleRoute(async (req) => {
  const { user } = await requireUser();
  const { prompts } = await parseBody(updatePromptsSchema, req);
  for (const key of Object.keys(prompts)) {
    if (!isArtifactType(key)) throw ApiError.badRequest(`Loại artifact không hợp lệ: ${key}`);
  }
  return { prompts: await savePrompts(user.id, prompts) };
});
