import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { userSettings } from "@/server/db/schema";
import { decrypt } from "@/server/crypto";
import { env } from "@/server/env";
import { GeminiProvider } from "./gemini";
import { MockAiProvider } from "./mock";
import { AiNotConfiguredError, DEFAULT_MODELS, type AiProvider } from "./provider";

export * from "./provider";

/**
 * Chọn provider cho người dùng (docs/02 §3.1):
 * `AI_PROVIDER=mock` → mock; ngược lại khoá người dùng → khoá server → AiNotConfiguredError (HTTP 412).
 */
export async function getAiProviderForUser(userId: string): Promise<AiProvider> {
  const e = env();
  if (e.AI_PROVIDER === "mock") return new MockAiProvider();

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const models = {
    chatModel: settings?.defaultChatModel ?? undefined,
    embeddingModel: settings?.embeddingModel ?? undefined,
  };
  if (settings?.geminiApiKeyEnc) {
    return new GeminiProvider({ apiKey: decrypt(settings.geminiApiKeyEnc), ...models });
  }
  if (e.GEMINI_API_KEY) return new GeminiProvider({ apiKey: e.GEMINI_API_KEY, ...models });
  throw new AiNotConfiguredError();
}

/** Model mặc định người dùng đã chọn (fallback về mặc định hệ thống). */
export async function getUserModels(userId: string) {
  const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return {
    chat: s?.defaultChatModel || DEFAULT_MODELS.chat,
    artifact: s?.defaultArtifactModel || DEFAULT_MODELS.artifact,
    embedding: s?.embeddingModel || DEFAULT_MODELS.embedding,
    embeddingDim: s?.embeddingDim ?? 768,
  };
}

export { GeminiProvider, MockAiProvider };
