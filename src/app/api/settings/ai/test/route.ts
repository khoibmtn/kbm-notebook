import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { testAiKeySchema } from "@/lib/validators/settings";
import { GeminiProvider } from "@/server/ai/gemini";
import { getAiProviderForUser } from "@/server/ai";
import { getSavedApiKey } from "@/server/settings/service";

/**
 * Kiểm tra khoá: gọi thật provider.listModels().
 * - body.apiKey: thử khoá vừa nhập (chưa lưu); không có → thử cấu hình hiện hành của người dùng.
 * Lỗi thật từ Gemini được trả lại nguyên văn (HTTP 400/429/502).
 */
export const POST = handleRoute(async (req) => {
  const { user } = await requireUser();
  const raw = await req.json().catch(() => ({}));
  const body = testAiKeySchema.parse(raw ?? {});
  let provider;
  if (body.apiKey) provider = new GeminiProvider({ apiKey: body.apiKey });
  else provider = await getAiProviderForUser(user.id);
  if (!provider.listModels) return { ok: true, provider: provider.id, models: [] };
  const models = await provider.listModels();
  const usingSavedKey = !body.apiKey && provider.id === "gemini" && Boolean(await getSavedApiKey(user.id));
  return { ok: true, provider: provider.id, source: provider.id === "mock" ? "mock" : body.apiKey ? "input" : usingSavedKey ? "user" : "server", models };
});
