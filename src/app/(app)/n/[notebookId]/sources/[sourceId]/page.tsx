import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SourceViewer } from "@/components/sources/source-viewer";
import { getT } from "@/i18n/server";
import { parseViewerHighlight } from "@/lib/sources";
import { isUuid } from "@/server/api/errors";

/** Source viewer toàn trang; `?chunk=<id>` hoặc `?page=n&start=&end=` để cuộn tới và tô sáng đoạn trích dẫn. */
export default async function SourceViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ notebookId: string; sourceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { notebookId, sourceId } = await params;
  if (!isUuid(sourceId)) notFound();
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const t = await getT();
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto">
      <div className="px-4 pt-4 sm:px-6">
        <Link
          href={`/n/${notebookId}/sources`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> {t("sources.viewer.back")}
        </Link>
      </div>
      <SourceViewer key={sourceId} notebookId={notebookId} sourceId={sourceId} highlight={parseViewerHighlight(q)} />
    </div>
  );
}
