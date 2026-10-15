import { FileText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { getT } from "@/i18n/server";

export default async function NotesPage() {
  const t = await getT();
  return (
    <EmptyState
      icon={FileText}
      title={t("notes.empty.title")}
      description={t("notes.empty.description")}
      badge={t("module.comingSoon")}
    />
  );
}
