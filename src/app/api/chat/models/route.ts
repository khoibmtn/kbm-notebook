import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { getAiProviderForUser, getUserModels } from "@/server/ai";

/** Danh sách model chat để chọn trong ô nhập: model mặc định của người dùng + các model nhà cung cấp trả về (nếu liệt kê được). */
export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  const models = await getUserModels(user.id);
  const names = new Set<string>([models.chat]);
  try {
    const provider = await getAiProviderForUser(user.id);
    if (provider.id === "mock") names.add("mock-chat");
    else for (const m of (await provider.listModels?.()) ?? []) if (/gemini/i.test(m) && !/embed|image|tts|imagen|aqa|live/i.test(m)) names.add(m.replace(/^models\//, ""));
  } catch {
    // chưa cấu hình AI / không liệt kê được: chỉ trả model mặc định
  }
  return { default: models.chat, models: [...names] };
});
