"use client";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ArtifactEvidence } from "@/lib/artifacts/content";
import type { TFunction } from "@/lib/i18n";
import { useT } from "@/lib/i18n-client";
import { sourceViewerHref } from "@/lib/sources";
import { cn } from "@/lib/utils";

/** "trang 3", "slide 2", "mục X" cho vị trí của bằng chứng. */
export function locatorLabel(loc: ArtifactEvidence["locator"], t: TFunction): string {
  const parts: string[] = [];
  if (loc.page != null) parts.push(t("studio.locator.page", { n: loc.page }));
  if (loc.slide != null) parts.push(t("studio.locator.slide", { n: loc.slide }));
  if (loc.section) parts.push(t("studio.locator.section", { name: loc.section }));
  return parts.join(", ");
}

type Props = {
  n: number;
  evidence: ArtifactEvidence[];
  /** Có `notebookId` → chip mở Source viewer ở đúng đoạn; thiếu (trang chia sẻ công khai) → chỉ hiện tooltip. */
  notebookId?: string;
  className?: string;
};

/** Chip trích dẫn `[n]`: hover xem nguồn + trang + trích đoạn, click mở Source viewer. */
export function CitationChip({ n, evidence, notebookId, className }: Props) {
  const t = useT();
  const ev = evidence[n - 1];
  const base = cn(
    "mx-0.5 inline-flex h-[1.35em] min-w-[1.5em] items-center justify-center rounded-full bg-primary/10 px-1.5 align-baseline text-[0.72em] font-medium leading-none text-primary no-underline transition-colors hover:bg-primary/20",
    className,
  );
  if (!ev) return <span className={cn(base, "bg-muted text-muted-foreground")}>{n}</span>;
  const href = notebookId ? sourceViewerHref(notebookId, ev) : null;
  const where = locatorLabel(ev.locator, t);
  const chip = href ? (
    <Link href={href} className={base} data-testid={`citation-${n}`} aria-label={t("studio.citation.aria", { n, title: ev.sourceTitle })}>
      {n}
    </Link>
  ) : (
    <span className={base} data-testid={`citation-${n}`} tabIndex={0} aria-label={t("studio.citation.aria", { n, title: ev.sourceTitle })}>
      {n}
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm space-y-1 text-left">
        <p className="font-medium">
          {ev.sourceTitle}
          {where ? ` · ${where}` : ""}
        </p>
        <p className="line-clamp-4 text-xs opacity-90">{ev.text.slice(0, 280)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Danh sách chip cho `citations` của một câu hỏi/thẻ/nút. */
export function CitationList({ citations, evidence, notebookId }: { citations?: number[]; evidence: ArtifactEvidence[]; notebookId?: string }) {
  if (!citations?.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center">
      {citations.map((n) => (
        <CitationChip key={n} n={n} evidence={evidence} notebookId={notebookId} />
      ))}
    </span>
  );
}
