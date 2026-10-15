import { StudioPanel } from "@/components/studio/studio-panel";
import { getT } from "@/i18n/server";

export default async function StudioPage() {
  const t = await getT();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6">
        <h1 className="text-lg font-semibold">{t("nav.studio")}</h1>
        <p className="text-sm text-muted-foreground">{t("studio.page.description")}</p>
      </div>
      <StudioPanel variant="page" />
    </div>
  );
}
