import { MessageSquare } from "lucide-react";
import { NotebookWorkspace } from "@/components/notebook/notebook-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { SourcesPanel } from "@/components/sources/sources-panel";
import { StudioPanel } from "@/components/studio/studio-panel";
import { getT } from "@/i18n/server";
import { env } from "@/server/env";

export default async function NotebookHomePage() {
  const t = await getT();
  return (
    <NotebookWorkspace
      sources={<SourcesPanel maxUploadMb={env().MAX_UPLOAD_MB} />}
      main={
        <EmptyState icon={MessageSquare} title={t("chat.empty.title")} description={t("chat.empty.description")} badge={t("module.comingSoon")} />
      }
      studio={<StudioPanel />}
    />
  );
}
