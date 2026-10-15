"use client";
import { AlertCircle, ExternalLink, Loader2, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourceTypeIcon } from "@/components/sources/source-icon";
import { sourceSubtitle } from "@/components/sources/source-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { useRealtimeEvent } from "@/lib/realtime";
import {
  resolveHighlightRange,
  splitForHighlight,
  type SourceDetailDto,
  type SourceStatusEvent,
  type SourceTextPage,
  type ViewerHighlight,
} from "@/lib/sources";

type Props = {
  notebookId: string;
  sourceId: string;
  /** Đoạn cần cuộn tới và tô sáng (từ chip trích dẫn hoặc `?chunk=`/`?page=&start=&end=`). */
  highlight?: ViewerHighlight;
};

function pageLabel(p: SourceTextPage, unit: SourceDetailDto["pageUnit"], t: ReturnType<typeof useT>): string | null {
  if (p.slide != null) return t("sources.viewer.slide", { n: p.slide });
  if (p.page != null) return unit === "sheet" ? t("sources.viewer.sheet", { n: p.page }) : t("sources.viewer.page", { n: p.page });
  return null;
}

/** Nội dung viewer: tiêu đề, tóm tắt, chủ đề, toàn văn theo trang với đoạn được tô sáng. */
export function SourceViewer({ notebookId, sourceId, highlight }: Props) {
  const t = useT();
  const [source, setSource] = useState<SourceDetailDto | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const url = `/api/notebooks/${notebookId}/sources/${sourceId}`;

  const load = useCallback(async () => {
    try {
      const res = await api<{ source: SourceDetailDto }>(url);
      setSource(res.source);
      setError(null);
    } catch (e) {
      setError({ notFound: e instanceof ApiClientError && e.status === 404, message: errorMessage(e, t("sources.viewer.loadError")) });
    }
  }, [url, t]);

  // Tải lần đầu; đổi nguồn thì component được tạo lại nhờ `key` ở nơi dùng.
  useEffect(() => {
    let cancelled = false;
    api<{ source: SourceDetailDto }>(url)
      .then((res) => {
        if (cancelled) return;
        setSource(res.source);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError({ notFound: e instanceof ApiClientError && e.status === 404, message: errorMessage(e, t("sources.viewer.loadError")) });
      });
    return () => {
      cancelled = true;
    };
  }, [url, t]);

  useRealtimeEvent<SourceStatusEvent>("source:status", (ev) => {
    if (ev.sourceId === sourceId && (ev.status === "ready" || ev.status === "failed" || ev.change === "updated")) void load();
  });

  const range = useMemo(() => (source ? resolveHighlightRange(source.chunks, highlight ?? {}) : null), [source, highlight]);

  // Cuộn tới đoạn tô sáng (hoặc tới trang được chỉ định) sau khi nội dung hiển thị.
  const highlightKey = `${highlight?.chunk ?? ""}|${highlight?.page ?? ""}|${highlight?.start ?? ""}|${highlight?.end ?? ""}`;
  useEffect(() => {
    if (!source || !bodyRef.current) return;
    const root = bodyRef.current;
    const target =
      root.querySelector<HTMLElement>("[data-highlight]") ??
      (highlight?.page != null ? root.querySelector<HTMLElement>(`[data-page="${highlight.page}"]`) : null);
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ cuộn khi nguồn tải xong hoặc đích tô sáng đổi
  }, [source?.id, source?.updatedAt, highlightKey]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center" role="alert">
        <AlertCircle className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{error.notFound ? t("sources.viewer.notFound") : error.message}</p>
        {!error.notFound && (
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("sources.retry")}
          </Button>
        )}
      </div>
    );
  }
  if (!source) {
    return (
      <div className="space-y-3 p-4" aria-busy>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const busy = source.status === "pending" || source.status === "processing";
  return (
    <article className="space-y-5 p-4" data-testid="source-viewer">
      <header className="space-y-2">
        <div className="flex items-start gap-2">
          <SourceTypeIcon source={source} className="mt-1 size-5" />
          <h2 className="min-w-0 flex-1 break-words text-lg font-semibold leading-snug">{source.title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {sourceSubtitle(source, t) && <span>{sourceSubtitle(source, t)}</span>}
          {source.visibility === "private" && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="size-3" aria-hidden />
              {t("sources.private")}
            </Badge>
          )}
          {source.fileId && (
            <a className="inline-flex items-center gap-1 hover:underline" href={`/api/files/${source.fileId}?download=1`}>
              <ExternalLink className="size-3" aria-hidden />
              {t("sources.viewer.openOriginal")}
            </a>
          )}
          {source.url && (
            <a className="inline-flex items-center gap-1 hover:underline" href={source.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3" aria-hidden />
              {t("sources.viewer.openUrl")}
            </a>
          )}
        </div>
      </header>

      {busy && (
        <p className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("sources.viewer.notReady")}
        </p>
      )}
      {source.status === "failed" && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("sources.viewer.failed", { error: source.error ?? t("common.error") })}
        </p>
      )}

      {source.status === "ready" && (
        <section aria-labelledby="source-summary" className="space-y-2">
          <h3 id="source-summary" className="text-sm font-semibold">
            {t("sources.viewer.summary")}
          </h3>
          <p className="text-sm leading-relaxed text-foreground/90">{source.summary || t("sources.viewer.noSummary")}</p>
          {source.keyTopics && source.keyTopics.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">{t("sources.viewer.topics")}</h4>
              <ul className="flex flex-wrap gap-1.5">
                {source.keyTopics.map((topic) => (
                  <li key={topic}>
                    <Badge variant="secondary">{topic}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="source-fulltext" className="space-y-3">
        <h3 id="source-fulltext" className="text-sm font-semibold">
          {t("sources.viewer.fullText")}
        </h3>
        <div ref={bodyRef} className="space-y-4">
          {source.pages.length === 0 && !busy && <p className="text-sm text-muted-foreground">{t("sources.viewer.noText")}</p>}
          {source.pages.map((p) => {
            const label = pageLabel(p, source.pageUnit, t);
            const num = p.slide ?? p.page;
            const parts = splitForHighlight(p.text, p.start, range);
            return (
              <div
                key={`${p.start}`}
                data-page={num ?? undefined}
                className={highlight?.page != null && num === highlight.page && !parts ? "rounded-md bg-primary/5 p-2 -m-2" : undefined}
              >
                {(label || p.section) && (
                  <div className="mb-1 flex items-center gap-2 border-b pb-1 text-xs font-medium text-muted-foreground">
                    {label && <span>{label}</span>}
                    {p.section && <span className="truncate font-normal">{p.section}</span>}
                  </div>
                )}
                <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                  {parts ? (
                    <>
                      {parts.before}
                      <mark
                        data-highlight
                        title={t("sources.viewer.highlighted")}
                        className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-500/40"
                      >
                        {parts.mark}
                      </mark>
                      {parts.after}
                    </>
                  ) : (
                    p.text
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </article>
  );
}

/** Viewer dạng panel trượt (mở từ danh sách nguồn hoặc chip trích dẫn trong chat). */
export function SourceViewerSheet({
  notebookId,
  sourceId,
  highlight,
  open,
  onOpenChange,
}: Props & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl" aria-describedby={undefined}>
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{t("sources.viewer.title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("sources.viewer.fullText")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {open && sourceId && <SourceViewer key={sourceId} notebookId={notebookId} sourceId={sourceId} highlight={highlight} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
