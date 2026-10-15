"use client";
import Link from "next/link";
import type { ArtifactEvidence } from "@/lib/artifacts/content";
import { useT } from "@/lib/i18n-client";
import { sourceViewerHref } from "@/lib/sources";
import { locatorLabel } from "./citation-chip";

/** Chân trang "Nguồn": mỗi bằng chứng được trích là một dòng có chip số, tên nguồn, trang và liên kết mở Source viewer. */
export function SourcesFooter({ evidence, notebookId }: { evidence: ArtifactEvidence[]; notebookId?: string }) {
  const t = useT();
  if (evidence.length === 0) return null;
  return (
    <section className="mt-6 border-t pt-4" aria-label={t("studio.sources.title")} data-testid="sources-footer">
      <h3 className="mb-2 text-sm font-semibold">{t("studio.sources.title")}</h3>
      <ol className="space-y-1.5 text-sm">
        {evidence.map((ev, i) => {
          const href = notebookId ? sourceViewerHref(notebookId, ev) : null;
          const where = locatorLabel(ev.locator, t);
          const label = (
            <>
              <span className="font-medium">{ev.sourceTitle}</span>
              {where && <span className="text-muted-foreground"> · {where}</span>}
            </>
          );
          return (
            <li key={`${ev.id}-${i}`} className="flex items-start gap-2" data-testid="source-item">
              <span className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">{i + 1}</span>
              <div className="min-w-0">
                {href ? (
                  <Link href={href} className="hover:underline">
                    {label}
                  </Link>
                ) : (
                  <span>{label}</span>
                )}
                <p className="line-clamp-2 text-xs text-muted-foreground">{ev.text.slice(0, 200)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
