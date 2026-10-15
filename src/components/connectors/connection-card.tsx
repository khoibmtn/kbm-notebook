"use client";
import { ExternalLink, Import, KeyRound, Loader2, MoreHorizontal, Plug, RefreshCw, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { CONNECTION_PROVIDER_LABEL, type ConnectionDto } from "@/lib/connectors";
import { cn } from "@/lib/utils";

export type ConnectionCardActions = {
  onSync: (c: ConnectionDto) => Promise<void> | void;
  onImport: (c: ConnectionDto) => void;
  onToggleShared: (c: ConnectionDto) => Promise<void> | void;
  onRefreshCredentials: (c: ConnectionDto) => Promise<void> | void;
  onRemove: (c: ConnectionDto) => void;
};

const DOT: Record<ConnectionDto["status"], string> = {
  ready: "bg-emerald-500",
  error: "bg-destructive",
  unconfigured: "bg-muted-foreground/50",
};

/** Thẻ một kết nối ngoài: provider, nhãn, chấm trạng thái THẬT (kết quả lời gọi gần nhất), số nguồn, thời điểm đồng bộ, menu ⋯. */
export function ConnectionCard({ connection: c, actions, canEdit }: { connection: ConnectionDto; actions: ConnectionCardActions; canEdit: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const statusLabel = t(`connectors.status.${c.status}`);
  const statusDetail = c.status === "error" && c.lastError ? `${statusLabel}: ${c.lastError}` : statusLabel;
  const isBridge = c.provider === "notebooklm-bridge";
  const hasMenu = c.usable || c.canDelete;

  return (
    <li className="group flex items-start gap-2 rounded-lg border bg-card px-2.5 py-2" data-testid="connection-card" data-status={c.status} data-provider={c.provider}>
      <Plug className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn("size-2 shrink-0 rounded-full", DOT[c.status])} role="img" aria-label={statusDetail} data-testid="connection-status" data-status={c.status} />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72 break-words">
              {statusDetail}
            </TooltipContent>
          </Tooltip>
          <span className="truncate text-sm font-medium leading-5" title={c.label} data-testid="connection-label">
            {c.label}
          </span>
          {busy && <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal" data-testid="connection-provider">
            {CONNECTION_PROVIDER_LABEL[c.provider]}
          </Badge>
          {c.usable ? (
            <span data-testid="connection-source-count">{t("connectors.card.sources", { count: c.sourceCount })}</span>
          ) : (
            <span>{t("connectors.card.notUsable", { name: c.ownerName ?? "?" })}</span>
          )}
          {c.usable && <span>· {c.lastSyncedAt ? t("connectors.card.synced", { time: formatRelative(c.lastSyncedAt, locale) }) : t("connectors.card.neverSynced")}</span>}
          {c.sharedWithMembers && (
            <span className="inline-flex items-center gap-0.5">
              · <Users className="size-3" aria-hidden /> {t("connectors.card.shared")}
            </span>
          )}
          {!c.isMine && c.usable && c.ownerName && <span>· {t("connectors.card.by", { name: c.ownerName })}</span>}
        </div>
        {c.status === "error" && c.lastError && c.usable && (
          <p className="mt-1 line-clamp-2 break-words text-xs text-destructive" data-testid="connection-error">
            {c.lastError}
          </p>
        )}
      </div>
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-70 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={t("connectors.card.menu")} data-testid="connection-menu">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {c.usable && canEdit && (
              <DropdownMenuItem onSelect={() => void run(() => actions.onSync(c))} data-testid="connection-sync">
                <RefreshCw /> {t("connectors.menu.sync")}
              </DropdownMenuItem>
            )}
            {c.usable && canEdit && isBridge && (
              <DropdownMenuItem onSelect={() => actions.onImport(c)} data-testid="connection-import">
                <Import /> {t("connectors.menu.import")}
              </DropdownMenuItem>
            )}
            {c.externalUrl && c.usable && (
              <DropdownMenuItem asChild>
                <a href={c.externalUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> {t("connectors.menu.open")}
                </a>
              </DropdownMenuItem>
            )}
            {c.isMine && canEdit && (
              <>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    void run(() => actions.onToggleShared(c));
                  }}
                  data-testid="connection-share"
                >
                  <Users /> {c.sharedWithMembers ? t("connectors.menu.shareOff") : t("connectors.menu.shareOn")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void run(() => actions.onRefreshCredentials(c))}>
                  <KeyRound /> {t("connectors.menu.refreshCredentials")}
                </DropdownMenuItem>
              </>
            )}
            {c.canDelete && canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => actions.onRemove(c)} data-testid="connection-remove">
                  <Trash2 /> {t("connectors.menu.remove")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
