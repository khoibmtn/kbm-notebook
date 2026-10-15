"use client";
import { AlertCircle, Eye, Loader2, Lock, MessageSquarePlus, MoreHorizontal, Pencil, RefreshCw, Trash2, Unlock } from "lucide-react";
import { SourceTypeIcon } from "@/components/sources/source-icon";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n-client";
import type { TFunction } from "@/lib/i18n";
import type { SourceDto } from "@/lib/sources";
import { cn } from "@/lib/utils";

export type SourceCardActions = {
  onView: (s: SourceDto) => void;
  onRename: (s: SourceDto) => void;
  onToggleVisibility: (s: SourceDto) => void;
  onReprocess: (s: SourceDto) => void;
  onDelete: (s: SourceDto) => void;
  /** Có → menu có mục "Chia sẻ vào chat" (chỉ nguồn đã sẵn sàng và không riêng tư). */
  onShareToChat?: (s: SourceDto) => void;
};

function compactNumber(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(".", ",")}k` : String(n);
}

/** Phụ đề: "12 trang · ~3,4k token" khi sẵn sàng. */
export function sourceSubtitle(s: SourceDto, t: TFunction): string {
  const parts: string[] = [];
  if (s.pageCount != null && s.pageUnit) parts.push(t(`sources.unit.${s.pageUnit}`, { count: s.pageCount }));
  else if (s.kind === "url") parts.push(t("sources.kind.url"));
  else if (s.kind === "text") parts.push(t("sources.kind.text"));
  if (s.tokenCount != null) parts.push(t("sources.tokens", { count: compactNumber(s.tokenCount) }));
  return parts.join(" · ");
}

function StatusLine({ source }: { source: SourceDto }) {
  const t = useT();
  if (source.status === "ready") {
    const sub = sourceSubtitle(source, t);
    return <span className="truncate">{sub || t("sources.status.ready")}</span>;
  }
  if (source.status === "failed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex min-w-0 items-center gap-1 text-destructive" data-testid="source-failed">
            <AlertCircle className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{source.error ?? t("sources.status.failed")}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          {source.error ?? t("sources.status.failed")}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1" data-testid="source-processing">
      <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      <span className="truncate">
        {source.status === "pending" ? t("sources.status.pending") : t("sources.status.processing", { progress: source.progress })}
      </span>
    </span>
  );
}

type Props = {
  source: SourceDto;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  actions: SourceCardActions;
  /** Người dùng có quyền chỉnh sửa sổ tay (editor+)? */
  canEdit: boolean;
};

export function SourceCard({ source, selected, onSelectedChange, actions, canEdit }: Props) {
  const t = useT();
  const busy = source.status === "pending" || source.status === "processing";
  const selectable = source.status === "ready";
  const canManage = canEdit && source.canManage;
  return (
    <li
      className={cn(
        "group relative flex items-start gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors hover:bg-accent/60",
        selected && "bg-accent/40",
      )}
      data-testid="source-card"
      data-status={source.status}
    >
      <Checkbox
        className="mt-0.5"
        checked={selected && selectable}
        disabled={!selectable}
        onCheckedChange={(v) => onSelectedChange(v === true)}
        aria-label={t("sources.selectSource", { title: source.title })}
      />
      <SourceTypeIcon source={source} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => actions.onView(source)}
          className="block w-full truncate text-left text-sm font-medium leading-5 outline-none hover:underline focus-visible:underline"
          title={source.title}
        >
          {source.title}
        </button>
        <div className="flex items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          {source.visibility === "private" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="size-3 shrink-0" aria-label={t("sources.private")} />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("sources.privateHint")}</TooltipContent>
            </Tooltip>
          )}
          <StatusLine source={source} />
        </div>
        {busy && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={source.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(source.progress, source.status === "pending" ? 2 : 5)}%` }} />
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-70 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={t("sources.menu.more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => actions.onView(source)}>
            <Eye /> {t("sources.menu.view")}
          </DropdownMenuItem>
          {actions.onShareToChat && source.status === "ready" && source.visibility !== "private" && (
            <DropdownMenuItem onSelect={() => actions.onShareToChat?.(source)} data-testid="source-share-to-chat">
              <MessageSquarePlus /> {t("team.share.title")}
            </DropdownMenuItem>
          )}
          {canManage && (
            <>
              <DropdownMenuItem onSelect={() => actions.onRename(source)}>
                <Pencil /> {t("sources.menu.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.onToggleVisibility(source)}>
                {source.visibility === "private" ? <Unlock /> : <Lock />}
                {source.visibility === "private" ? t("sources.menu.makeShared") : t("sources.menu.makePrivate")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy || source.kind === "youtube"} onSelect={() => actions.onReprocess(source)}>
                <RefreshCw /> {t("sources.menu.reprocess")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(source)}>
                <Trash2 /> {t("sources.menu.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
