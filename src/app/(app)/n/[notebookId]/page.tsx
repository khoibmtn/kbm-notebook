import { Sparkles } from "lucide-react";
import { MainTabs } from "@/components/notebook/main-tabs";
import { NotebookWorkspace } from "@/components/notebook/notebook-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { SourcesPanel } from "@/components/sources/sources-panel";
import { getT } from "@/i18n/server";
import { env } from "@/server/env";

export default async function NotebookHomePage() {
  const t = await getT();
  return (
    <NotebookWorkspace
      sources={<SourcesPanel maxUploadMb={env().MAX_UPLOAD_MB} />}
      main={<MainTabs />}
      studio={
        <EmptyState icon={Sparkles} title={t("studio.empty.title")} description={t("module.comingSoon.description")} badge={t("module.comingSoon")} />
      }
    />
  );
}
