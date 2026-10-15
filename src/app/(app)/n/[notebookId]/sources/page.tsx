import { SourcesPanel } from "@/components/sources/sources-panel";
import { getT } from "@/i18n/server";
import { env } from "@/server/env";

export default async function SourcesPage() {
  const t = await getT();
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-lg font-semibold">{t("nav.sources")}</h1>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
        <SourcesPanel maxUploadMb={env().MAX_UPLOAD_MB} />
      </div>
    </div>
  );
}
