import { SourcesPanel } from "@/components/sources/sources-panel";
import { getT } from "@/i18n/server";
import { isUuid } from "@/server/api/errors";
import { env } from "@/server/env";

/** `/n/[id]/sources` — danh sách nguồn; `?source=<id>` (liên kết từ thẻ nguồn trong chat nhóm) mở thẳng Source viewer. */
export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getT();
  const { source, add } = await searchParams;
  const sourceId = typeof source === "string" && isUuid(source) ? source : null;
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-lg font-semibold">{t("nav.sources")}</h1>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
        <SourcesPanel key={`${sourceId ?? "list"}-${add ?? ""}`} maxUploadMb={env().MAX_UPLOAD_MB} initialViewSourceId={sourceId} initialAddOpen={add === "1"} />
      </div>
    </div>
  );
}
