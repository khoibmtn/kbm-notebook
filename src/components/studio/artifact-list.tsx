"use client";
import { AlertCircle, Copy, Download, ExternalLink, History, Loader2, MoreHorizontal, Pencil, RefreshCw, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/api-client";
import { EXPORT_FORMATS_BY_TYPE, type ArtifactDetailDto, type ArtifactDto } from "@/lib/artifacts/meta";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { ShareDialog } from "./share-dialog";
import { FORMAT_LABEL_KEY, TYPE_ICONS, TYPE_NAME_KEY } from "./type-meta";
import type { ArtifactProgress } from "./use-artifacts";
import { useArtifactExport } from "./use-export";

type Props = {
  notebookId: string;
  artifacts: ArtifactDto[];
  progress: Record<string, ArtifactProgress>;
  isNotebookOwner: boolean;
  onRename: (id: string, title: string) => Promise<void>;
  onFork: (id: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<boolean>;
  onRegenerate: (id: string) => Promise<void>;
};

function StatusLine({ a, p }: { a: ArtifactDto; p?: ArtifactProgress }) {
  const t = useT();
  const { locale } = useLocale();
  if (a.status === "failed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex min-w-0 items-center gap-1 text-destructive" data-testid="artifact-failed">
            <AlertCircle className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{a.error ?? t("studio.status.failed")}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-72">
          {a.error ?? t("studio.status.failed")}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (a.status === "queued" || a.status === "generating") {
    const label = a.status === "queued" ? t("studio.status.queued") : p?.stage ?? t("studio.status.generating");
    return (
      <span className="flex min-w-0 items-center gap-1" data-testid="artifact-generating" role="status">
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
        <span className="truncate">
          {label}
          {a.status === "generating" && p ? ` · ${p.progress}%` : ""}
        </span>
      </span>
    );
  }
  return (
    <span className="truncate">
      {t(TYPE_NAME_KEY[a.type])} · {formatRelative(a.createdAt, locale)}
      {a.currentVersionNo && a.currentVersionNo > 1 ? ` · v${a.currentVersionNo}` : ""}
    </span>
  );
}

function ArtifactRow({
  a,
  p,
  notebookId,
  isNotebookOwner,
  onRename,
  onFork,
  onDelete,
  onRegenerate,
}: { a: ArtifactDto; p?: ArtifactProgress } & Omit<Props, "artifacts" | "progress">) {
  const t = useT();
  const Icon = TYPE_ICONS[a.type];
  const { exportAs } = useArtifactExport();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(a.title);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState<ArtifactDetailDto | null>(null);
  const [busy, setBusy] = useState(false);
  const href = `/n/${notebookId}/artifacts/${a.id}`;
  const ready = a.status === "ready" && a.currentVersionId;
  const formats = EXPORT_FORMATS_BY_TYPE[a.type];

  const openShare = async () => {
    try {
      const res = await api<{ artifact: ArtifactDetailDto }>(`/api/artifacts/${a.id}`);
      setSharing(res.artifact);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  return (
    <li className="group flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 transition-colors hover:bg-accent/40" data-testid="artifact-row" data-artifact-id={a.id} data-status={a.status}>
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={t("studio.open", { name: a.title })}>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary", a.status === "failed" && "bg-destructive/10 text-destructive")}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" data-testid="artifact-title">
            {a.title}
          </span>
          <span className="block text-xs text-muted-foreground">
            <StatusLine a={a} p={p} />
          </span>
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("studio.menu", { name: a.title })} data-testid="artifact-menu">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={href}>
              <ExternalLink /> {t("studio.menu.open")}
            </Link>
          </DropdownMenuItem>
          {a.canEdit && (
            <DropdownMenuItem onSelect={() => { setName(a.title); setRenaming(true); }}>
              <Pencil /> {t("studio.menu.rename")}
            </DropdownMenuItem>
          )}
          {a.canManage && (
            <DropdownMenuItem disabled={!ready} onSelect={() => void onFork(a.id)}>
              <Copy /> {t("studio.menu.fork")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void openShare()}>
            <Share2 /> {t("studio.menu.share")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!ready}>
              <Download /> {t("studio.menu.export")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {formats.map((f) => (
                <DropdownMenuItem key={f} onSelect={() => void exportAs(a.id, f)} data-testid={`export-${f}`}>
                  {t(FORMAT_LABEL_KEY[f])}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem asChild>
            <Link href={`${href}?versions=1`}>
              <History /> {t("studio.menu.versions")}
            </Link>
          </DropdownMenuItem>
          {a.canManage && (
            <>
              <DropdownMenuItem disabled={a.status === "queued" || a.status === "generating"} onSelect={() => void onRegenerate(a.id)}>
                <RefreshCw /> {t("studio.menu.regenerate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 /> {t("studio.menu.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("studio.menu.rename")}</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus aria-label={t("studio.rename.label")} data-testid="rename-input" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { setBusy(true); void onRename(a.id, name.trim()).finally(() => { setBusy(false); setRenaming(false); }); } }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={busy || !name.trim()}
              onClick={() => {
                setBusy(true);
                void onRename(a.id, name.trim()).finally(() => {
                  setBusy(false);
                  setRenaming(false);
                });
              }}
              data-testid="rename-save"
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("studio.delete.title")}</DialogTitle>
            <DialogDescription>{t("studio.delete.description", { name: a.title })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onDelete(a.id).finally(() => {
                  setBusy(false);
                  setDeleting(false);
                });
              }}
              data-testid="delete-confirm"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sharing && (
        <ShareDialog open onOpenChange={(o) => !o && setSharing(null)} artifact={sharing} isNotebookOwner={isNotebookOwner} onChanged={setSharing} />
      )}
    </li>
  );
}

export function ArtifactList({ artifacts, progress, ...rest }: Props) {
  return (
    <ul className="space-y-1.5" data-testid="artifact-list">
      {artifacts.map((a) => (
        <ArtifactRow key={a.id} a={a} p={progress[a.id]} {...rest} />
      ))}
    </ul>
  );
}
