"use client";
import { FileText, FolderOpen, Share2, Sparkles, StickyNote } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";
import type { RefDTO } from "@/lib/team-chat/types";
import { cn } from "@/lib/utils";
import { ShareToChatDialog } from "./share-to-chat-dialog";

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
  const [shareOpen, setShareOpen] = useState(false);
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
    "flex min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-foreground",
    refItem.available && "transition-colors hover:bg-accent",
  );
  if (!refItem.available) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-lg border bg-background/70 opacity-70" data-testid="ref-card">
        <div className={cls}>{body}</div>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-1 rounded-lg border bg-background/70 pr-1" data-testid="ref-card">
      <Link href={refHref(notebookId, refItem)} className={cls}>
        {body}
      </Link>
      <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setShareOpen(true)} aria-label={t("team.share.title")} title={t("team.share.title")}>
        <Share2 />
      </Button>
      {shareOpen && (
        <ShareToChatDialog
          open
          onOpenChange={setShareOpen}
          notebookId={notebookId}
          item={{ type: refItem.type, id: refItem.id, title: refItem.title }}
        />
      )}
    </div>
  );
}
