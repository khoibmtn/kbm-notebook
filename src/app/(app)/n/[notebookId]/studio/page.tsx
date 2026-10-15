import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { getT } from "@/i18n/server";

export default async function StudioPage() {
  const t = await getT();
  return (
    <EmptyState
      icon={Sparkles}
      title={t("studio.empty.title")}
      description={t("studio.empty.description")}
      badge={t("module.comingSoon")}
    />
  );
}
