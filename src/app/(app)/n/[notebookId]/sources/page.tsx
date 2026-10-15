import { FolderOpen } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { getT } from "@/i18n/server";

export default async function SourcesPage() {
  const t = await getT();
  return (
    <EmptyState
      icon={FolderOpen}
      title={t("sources.empty.title")}
      description={t("sources.empty.description")}
      badge={t("module.comingSoon")}
    />
  );
}
