"use client";
import { FileText, FolderOpen, Sparkles, StickyNote } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";
import type { RefDTO } from "@/lib/team-chat/types";
import { cn } from "@/lib/utils";

/** Đường dẫn tới mục được tham chiếu. */
export function refHref(notebookId: string, ref: Pick<RefDTO, "type" | "id">): string {
  switch (ref.type) {
    case "artifact":
      return `/n/${notebookId}/artifacts/${ref.id}`;
    case "source":
      return `/n/${notebookId}/sources?source=${ref.id}`;
    case "note":
      return `/n/${notebookId}/notes?note=${ref.id}`;
  }
}

/** Thẻ artifact / nguồn / note được chia sẻ vào chat. */
export function RefCard({ notebookId, refItem }: { notebookId: string; refItem: RefDTO }) {
  const t = useT();
  const Icon = refItem.type === "artifact" ? Sparkles : refItem.type === "source" ? FolderOpen : StickyNote;
  const typeLabel =
    refItem.type === "artifact"
      ? refItem.subtype
        ? t(`artifact.${refItem.subtype}` as MessageKey)
        : t("team.ref.artifact")
      : refItem.type === "source"
        ? t("team.ref.source")
        : t("team.ref.note");

  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {refItem.available ? <Icon className="size-4" /> : <FileText className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {refItem.available ? refItem.title : refItem.title || t("team.ref.unavailable")}
        </span>
        <span className="block text-xs text-muted-foreground">
          {typeLabel}
          {!refItem.available && ` · ${t("team.ref.unavailable")}`}
        </span>
      </span>
    </>
  );
  const cls = cn(
    "mt-1 flex items-center gap-2 rounded-lg border bg-background/70 p-2 text-foreground",
    refItem.available && "transition-colors hover:bg-accent",
  );
  if (!refItem.available) {
    return (
      <div className={cn(cls, "opacity-70")} data-testid="ref-card">
        {body}
      </div>
    );
  }
  return (
    <Link href={refHref(notebookId, refItem)} className={cls} data-testid="ref-card">
      {body}
    </Link>
  );
}
