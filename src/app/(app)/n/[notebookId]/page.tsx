import { MessageSquare, FolderOpen, Sparkles } from "lucide-react";
import { NotebookWorkspace } from "@/components/notebook/notebook-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { getT } from "@/i18n/server";

export default async function NotebookHomePage() {
  const t = await getT();
  return (
    <NotebookWorkspace
      sources={
        <EmptyState icon={FolderOpen} title={t("sources.empty.title")} description={t("module.comingSoon.description")} badge={t("module.comingSoon")} />
      }
      main={
        <EmptyState icon={MessageSquare} title={t("chat.empty.title")} description={t("chat.empty.description")} badge={t("module.comingSoon")} />
      }
      studio={
        <EmptyState icon={Sparkles} title={t("studio.empty.title")} description={t("module.comingSoon.description")} badge={t("module.comingSoon")} />
      }
    />
  );
}
