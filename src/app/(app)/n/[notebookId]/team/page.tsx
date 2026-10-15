import { UsersRound } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { getT } from "@/i18n/server";

export default async function TeamPage() {
  const t = await getT();
  return (
    <EmptyState
      icon={UsersRound}
      title={t("team.empty.title")}
      description={t("team.empty.description")}
      badge={t("module.comingSoon")}
    />
  );
}
