import { MembersPanel } from "@/components/notebook/members-panel";
import { getT } from "@/i18n/server";

export default async function MembersPage() {
  const t = await getT();
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mb-6 space-y-1">
        <h1 className="text-lg font-semibold">{t("nav.members")}</h1>
        <p className="text-sm text-muted-foreground">{t("members.description")}</p>
      </div>
      <MembersPanel />
    </div>
  );
}
