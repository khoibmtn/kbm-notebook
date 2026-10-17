import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { updatePromptsSchema } from "@/lib/validators/settings";
import { getPrompts, savePrompts } from "@/server/settings/service";
import {
  ARTIFACT_TYPES,
  CHAT_PROMPT_KEY,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_PROMPTS,
  isArtifactType,
  resolveChatPrompt,
  resolvePrompt,
} from "@/server/ai/prompts/defaults";
import { ApiError } from "@/server/api/errors";

/**
 * `prompts`: phần người dùng đã ghi đè; `defaults`: mặc định trong code; `effective`: prompt hiệu lực
 * (mặc định ⊕ ghi đè) — hộp "Tuỳ chỉnh" của Studio hiển thị `effective` cho từng loại artifact.
 * Ngoài các loại artifact còn có mục `chat` (prompt của Chat AI).
 */
export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  const prompts = await getPrompts(user.id);
  const defaults: Record<string, { system: string; user: string; options?: Record<string, string | number | boolean> }> = Object.fromEntries(
    ARTIFACT_TYPES.map((t) => [t, DEFAULT_PROMPTS[t]]),
  );
  const effective: Record<string, { system: string; user: string; options?: Record<string, string | number | boolean> }> = Object.fromEntries(
    ARTIFACT_TYPES.map((t) => [t, resolvePrompt(t, prompts[t])]),
  );
  defaults[CHAT_PROMPT_KEY] = { system: DEFAULT_CHAT_PROMPT.system, user: DEFAULT_CHAT_PROMPT.user };
  effective[CHAT_PROMPT_KEY] = resolveChatPrompt(prompts[CHAT_PROMPT_KEY]);
  return { prompts, defaults, effective };
});

export const PUT = handleRoute(async (req) => {
  const { user } = await requireUser();
  const { prompts } = await parseBody(updatePromptsSchema, req);
  for (const key of Object.keys(prompts)) {
    if (key !== CHAT_PROMPT_KEY && !isArtifactType(key)) throw ApiError.badRequest(`Loại artifact không hợp lệ: ${key}`);
  }
  return { prompts: await savePrompts(user.id, prompts) };
});
