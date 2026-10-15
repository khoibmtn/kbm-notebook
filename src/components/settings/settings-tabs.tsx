"use client";
import { Plug } from "lucide-react";
import { useState } from "react";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { NotificationsForm } from "@/components/settings/notifications-form";
import { ProfileForm, type ProfileData } from "@/components/settings/profile-form";
import { PromptsForm } from "@/components/settings/prompts-form";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n-client";
import type { AiSettingsView } from "@/server/settings/service";

const TABS = ["profile", "ai", "prompts", "connectors", "notifications"] as const;

export function SettingsTabs({
  initialTab,
  profile,
  ai,
  prompts,
  promptDefaults,
  artifactTypes,
}: {
  initialTab?: string;
  profile: ProfileData;
  ai: AiSettingsView;
  prompts: Record<string, { system?: string; user?: string }>;
  promptDefaults: Record<string, { system: string; user: string }>;
  artifactTypes: string[];
}) {
  const t = useT();
  const [tab, setTab] = useState<string>(TABS.includes(initialTab as (typeof TABS)[number]) ? (initialTab as string) : "profile");
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v);
        window.history.replaceState(null, "", `/settings?tab=${v}`);
      }}
    >
      <TabsList className="mb-4 h-auto flex-wrap justify-start">
        <TabsTrigger value="profile">{t("settings.tab.profile")}</TabsTrigger>
        <TabsTrigger value="ai">{t("settings.tab.ai")}</TabsTrigger>
        <TabsTrigger value="prompts">{t("settings.tab.prompts")}</TabsTrigger>
        <TabsTrigger value="connectors">{t("settings.tab.connectors")}</TabsTrigger>
        <TabsTrigger value="notifications">{t("settings.tab.notifications")}</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">
        <ProfileForm initial={profile} />
      </TabsContent>
      <TabsContent value="ai">
        <AiSettingsForm initial={ai} />
      </TabsContent>
      <TabsContent value="prompts">
        <PromptsForm types={artifactTypes} defaults={promptDefaults} initial={prompts} />
      </TabsContent>
      <TabsContent value="connectors">
        <EmptyState
          icon={Plug}
          title={t("settings.connectors.title")}
          description={t("settings.connectors.description")}
          badge={t("module.comingSoon")}
          className="rounded-xl border border-dashed py-16"
        />
      </TabsContent>
      <TabsContent value="notifications">
        <NotificationsForm initial={profile.notifyEmail} />
      </TabsContent>
    </Tabs>
  );
}
