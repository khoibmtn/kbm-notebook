import type { Metadata } from "next";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { AppHeader } from "@/components/shared/app-header";
import { getT } from "@/i18n/server";
import { ARTIFACT_TYPES, DEFAULT_PROMPTS } from "@/server/ai/prompts/defaults";
import { requirePageSession } from "@/server/auth/page-session";
import { getAiSettings, getProfileSettings, getPrompts } from "@/server/settings/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("settings.title") };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user } = await requirePageSession("/settings");
  const { tab } = await searchParams;
  const t = await getT();
  const [profile, ai, prompts] = await Promise.all([
    getProfileSettings(user.id),
    getAiSettings(user.id),
    getPrompts(user.id),
  ]);
  const defaults = Object.fromEntries(
    ARTIFACT_TYPES.map((type) => [type, { system: DEFAULT_PROMPTS[type].system, user: DEFAULT_PROMPTS[type].user }]),
  );
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
        <h1 className="mb-6 text-xl font-semibold">{t("settings.title")}</h1>
        <SettingsTabs
          initialTab={tab}
          profile={profile}
          ai={ai}
          prompts={prompts}
          promptDefaults={defaults}
          artifactTypes={[...ARTIFACT_TYPES]}
        />
      </main>
    </div>
  );
}
