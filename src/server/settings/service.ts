import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { userProfiles, userSettings, users, type PromptOverride } from "@/server/db/schema";
import { decrypt, encrypt, maskSecret } from "@/server/crypto";
import { env } from "@/server/env";
import { DEFAULT_MODELS } from "@/server/ai/provider";
import type { UpdateAiSettingsInput } from "@/lib/validators/settings";

export async function ensureUserSettings(userId: string) {
  await db.insert(userSettings).values({ userId }).onConflictDoNothing();
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return row;
}

export type AiSettingsView = {
  provider: "gemini" | "mock";
  hasUserKey: boolean;
  keyMask: string | null;
  serverKeyAvailable: boolean;
  defaultChatModel: string | null;
  defaultArtifactModel: string | null;
  embeddingModel: string;
  embeddingDim: number;
  fallbackModels: { chat: string; artifact: string };
};

export async function getAiSettings(userId: string): Promise<AiSettingsView> {
  const s = await ensureUserSettings(userId);
  let keyMask: string | null = null;
  if (s.geminiApiKeyEnc) {
    try {
      keyMask = maskSecret(decrypt(s.geminiApiKeyEnc));
    } catch {
      keyMask = "••••";
    }
  }
  const e = env();
  return {
    provider: e.AI_PROVIDER,
    hasUserKey: Boolean(s.geminiApiKeyEnc),
    keyMask,
    serverKeyAvailable: Boolean(e.GEMINI_API_KEY),
    defaultChatModel: s.defaultChatModel,
    defaultArtifactModel: s.defaultArtifactModel,
    embeddingModel: s.embeddingModel,
    embeddingDim: s.embeddingDim,
    fallbackModels: { chat: DEFAULT_MODELS.chat, artifact: DEFAULT_MODELS.artifact },
  };
}

export async function updateAiSettings(userId: string, input: UpdateAiSettingsInput) {
  await ensureUserSettings(userId);
  const patch: Partial<typeof userSettings.$inferInsert> = {};
  if (input.geminiApiKey === null) patch.geminiApiKeyEnc = null;
  else if (typeof input.geminiApiKey === "string") patch.geminiApiKeyEnc = encrypt(input.geminiApiKey);
  if (input.defaultChatModel !== undefined) patch.defaultChatModel = input.defaultChatModel || null;
  if (input.defaultArtifactModel !== undefined) patch.defaultArtifactModel = input.defaultArtifactModel || null;
  if (input.embeddingModel !== undefined) patch.embeddingModel = input.embeddingModel;
  if (Object.keys(patch).length > 0) {
    await db.update(userSettings).set(patch).where(eq(userSettings.userId, userId));
  }
  return getAiSettings(userId);
}

export async function getSavedApiKey(userId: string): Promise<string | null> {
  const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return s?.geminiApiKeyEnc ? decrypt(s.geminiApiKeyEnc) : null;
}

export async function getPrompts(userId: string): Promise<Record<string, PromptOverride>> {
  const s = await ensureUserSettings(userId);
  return s.prompts ?? {};
}

export async function savePrompts(userId: string, prompts: Record<string, PromptOverride>) {
  await ensureUserSettings(userId);
  // bỏ các mục rỗng
  const cleaned: Record<string, PromptOverride> = {};
  for (const [k, v] of Object.entries(prompts)) {
    if (v.system?.trim() || v.user?.trim() || (v.options && Object.keys(v.options).length)) cleaned[k] = v;
  }
  await db.update(userSettings).set({ prompts: cleaned }).where(eq(userSettings.userId, userId));
  return cleaned;
}

export async function getProfileSettings(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  const s = await ensureUserSettings(userId);
  return {
    name: u.name,
    email: u.email,
    image: u.image,
    title: p?.title ?? null,
    bio: p?.bio ?? null,
    locale: (p?.locale ?? "vi") as "vi" | "en",
    theme: (p?.theme ?? "system") as "system" | "light" | "dark",
    notifyEmail: s.notifyEmail,
  };
}

export async function updateProfileSettings(
  userId: string,
  input: { name?: string; title?: string | null; bio?: string | null; locale?: "vi" | "en"; theme?: "system" | "light" | "dark" },
) {
  if (input.name) {
    await db.update(users).set({ name: input.name }).where(eq(users.id, userId));
  }
  const profilePatch: Partial<typeof userProfiles.$inferInsert> = {};
  if (input.name) profilePatch.displayName = input.name;
  if (input.title !== undefined) profilePatch.title = input.title;
  if (input.bio !== undefined) profilePatch.bio = input.bio;
  if (input.locale) profilePatch.locale = input.locale;
  if (input.theme) profilePatch.theme = input.theme;
  await db.insert(userProfiles).values({ userId, ...profilePatch }).onConflictDoUpdate({
    target: userProfiles.userId,
    set: profilePatch,
  });
  return getProfileSettings(userId);
}

export async function setNotifyEmail(userId: string, notifyEmail: boolean) {
  await ensureUserSettings(userId);
  await db.update(userSettings).set({ notifyEmail }).where(eq(userSettings.userId, userId));
}
