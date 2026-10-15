"use client";
import { AlertCircle, ArrowLeft, Check, Copy, Download, History, Loader2, MoreHorizontal, RefreshCw, RotateCcw, Save, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNotebook } from "@/components/notebook/notebook-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import {
  EXPORT_FORMATS_BY_TYPE,
  type ArtifactDetailDto,
  type ArtifactStatusEvent,
  type ArtifactVersionDto,
} from "@/lib/artifacts/meta";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { useRealtime, useRealtimeEvent } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { ArtifactBody } from "./artifact-body";
import { ShareDialog } from "./share-dialog";
import { FORMAT_LABEL_KEY, TYPE_ICONS, TYPE_NAME_KEY } from "./type-meta";
import { useArtifactExport } from "./use-export";

type Preview = { id: string; versionNo: number; content: unknown };

function StatusBadge({ artifact, progress }: { artifact: ArtifactDetailDto; progress?: { progress: number; stage?: string } }) {
  const t = useT();
  if (artifact.status === "ready") return null;
  if (artifact.status === "failed") return <Badge variant="destructive">{t("studio.status.failed")}</Badge>;
  return (
    <Badge variant="secondary" className="gap-1" data-testid="artifact-status-badge">
      <Loader2 className="size-3 animate-spin" aria-hidden />
      {artifact.status === "queued" ? t("studio.status.queued") : (progress?.stage ?? t("studio.status.generating"))}
      {artifact.status === "generating" && progress ? ` · ${progress.progress}%` : ""}
    </Badge>
  );
}

/** Trang artifact `/n/[id]/artifacts/[artifactId]`: tiêu đề, phiên bản, chia sẻ, xuất, nhân bản, tạo lại, xoá + trình xem/sửa theo loại. */
export function ArtifactPage({ artifactId }: { artifactId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const { notebook, role } = useNotebook();
  const { connected } = useRealtime();
  const { exportAs } = useArtifactExport();

  const [artifact, setArtifact] = useState<ArtifactDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ progress: number; stage?: string } | undefined>();
  const [versions, setVersions] = useState<ArtifactVersionDto[] | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(search.get("versions") === "1");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ artifact: ArtifactDetailDto }>(`/api/artifacts/${artifactId}`);
      setArtifact(res.artifact);
      setError(null);
      return res.artifact;
    } catch (e) {
      setError(errorMessage(e, t("common.error")));
      return null;
    }
  }, [artifactId, t]);

  useEffect(() => {
    let cancelled = false;
    api<{ artifact: ArtifactDetailDto }>(`/api/artifacts/${artifactId}`)
      .then((res) => {
        if (!cancelled) setArtifact(res.artifact);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, t("common.error")));
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, t]);

  const loadVersions = useCallback(async () => {
    try {
      const res = await api<{ versions: ArtifactVersionDto[] }>(`/api/artifacts/${artifactId}/versions`);
      setVersions(res.versions);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  }, [artifactId, t]);

  useEffect(() => {
    if (!versionsOpen) return;
    let cancelled = false;
    api<{ versions: ArtifactVersionDto[] }>(`/api/artifacts/${artifactId}/versions`)
      .then((res) => {
        if (!cancelled) setVersions(res.versions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [versionsOpen, artifactId, artifact?.currentVersionId]);

  useRealtimeEvent<ArtifactStatusEvent>("artifact:status", (ev) => {
    if (ev.artifactId !== artifactId) return;
    if (ev.change === "status") {
      setProgress({ progress: ev.progress, stage: ev.stage });
      setArtifact((a) => (a ? { ...a, status: ev.status, error: ev.error } : a));
      return;
    }
    setProgress(undefined);
    if (ev.change === "deleted") {
      router.replace(`/n/${notebook.id}/studio`);
      return;
    }
    void load();
  });

  // Mất socket khi đang tạo → hỏi lại định kỳ.
  const busy = artifact?.status === "queued" || artifact?.status === "generating";
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!busy || connected) return;
    const id = setInterval(() => void loadRef.current(), 4000);
    return () => clearInterval(id);
  }, [busy, connected]);

  // Cảnh báo khi rời trang với thay đổi chưa lưu.
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(artifact?.content ?? null);
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!artifact || draft === null) return;
    setSaving(true);
    try {
      const res = await api<{ artifact: ArtifactDetailDto; version: { versionNo: number } | null }>(`/api/artifacts/${artifact.id}`, {
        method: "PATCH",
        json: { content: draft, baseVersionId: artifact.currentVersionId ?? undefined },
      });
      setArtifact(res.artifact);
      setDraft(null);
      toast.success(t("studio.toast.saved", { n: res.version?.versionNo ?? res.artifact.currentVersionNo ?? 0 }));
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "version_conflict") {
        toast.error(t("studio.toast.conflict"), {
          action: {
            label: t("studio.toast.reload"),
            onClick: () => {
              setDraft(null);
              void load();
            },
          },
        });
      } else toast.error(errorMessage(e, t("common.error")));
    } finally {
      setSaving(false);
    }
  }, [artifact, draft, load, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const commitTitle = async () => {
    setEditingTitle(false);
    const next = title.trim();
    if (!artifact || !next || next === artifact.title) return;
    try {
      const res = await api<{ artifact: ArtifactDetailDto }>(`/api/artifacts/${artifact.id}`, { method: "PATCH", json: { title: next } });
      setArtifact((a) => (a ? { ...a, title: res.artifact.title } : a));
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  const openPreview = async (v: ArtifactVersionDto) => {
    if (v.isCurrent) {
      setPreview(null);
      return;
    }
    try {
      const res = await api<{ version: { id: string; versionNo: number; content: unknown } }>(`/api/artifacts/${artifactId}/versions/${v.id}`);
      setPreview({ id: res.version.id, versionNo: res.version.versionNo, content: res.version.content });
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  const restore = async () => {
    if (!preview) return;
    try {
      const res = await api<{ artifact: ArtifactDetailDto }>(`/api/artifacts/${artifactId}/versions/${preview.id}/restore`, { method: "POST" });
      setArtifact(res.artifact);
      setPreview(null);
      setDraft(null);
      void loadVersions();
      toast.success(t("studio.toast.restored", { n: preview.versionNo }));
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  const regenerate = async () => {
    try {
      await api(`/api/artifacts/${artifactId}/regenerate`, { method: "POST", json: {} });
      toast.success(t("studio.toast.regenerating"));
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  const fork = async () => {
    try {
      const res = await api<{ artifact: ArtifactDetailDto }>(`/api/artifacts/${artifactId}/fork`, { method: "POST" });
      toast.success(t("studio.toast.forked", { name: res.artifact.title }));
      router.push(`/n/${notebook.id}/artifacts/${res.artifact.id}`);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  const doDelete = async () => {
    try {
      await api(`/api/artifacts/${artifactId}`, { method: "DELETE" });
      toast.success(t("studio.toast.deleted"));
      router.replace(`/n/${notebook.id}/studio`);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  if (error && !artifact) {
    return (
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle className="size-8 text-destructive" aria-hidden />
        <p className="text-sm" role="alert">
          {error}
        </p>
        <Button asChild variant="outline">
          <Link href={`/n/${notebook.id}/studio`}>{t("studio.back")}</Link>
        </Button>
      </div>
    );
  }
  if (!artifact) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const Icon = TYPE_ICONS[artifact.type];
  const hasContent = artifact.content !== null && artifact.content !== undefined;
  const shownContent = preview ? preview.content : (draft ?? artifact.content);
  const readOnly = !artifact.canEdit || Boolean(preview) || busy;
  const formats = EXPORT_FORMATS_BY_TYPE[artifact.type];
  const canExport = artifact.status === "ready" || hasContent;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="artifact-page" data-status={artifact.status}>
      <header className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:px-4">
        <Button asChild variant="ghost" size="icon" aria-label={t("studio.back")}>
          <Link href={`/n/${notebook.id}/studio`}>
            <ArrowLeft />
          </Link>
        </Button>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {editingTitle && artifact.canEdit ? (
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              maxLength={200}
              autoFocus
              className="w-full rounded-md border bg-background px-2 py-1 text-base font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label={t("studio.rename.label")}
              data-testid="artifact-title-input"
            />
          ) : (
            <h1 className="truncate text-base font-semibold">
              {artifact.canEdit ? (
                <button type="button" className="max-w-full truncate rounded px-1 text-left hover:bg-accent" onClick={() => { setTitle(artifact.title); setEditingTitle(true); }} title={t("studio.rename.hint")} data-testid="artifact-title">
                  {artifact.title}
                </button>
              ) : (
                <span data-testid="artifact-title">{artifact.title}</span>
              )}
            </h1>
          )}
          <p className="flex flex-wrap items-center gap-x-2 truncate px-1 text-xs text-muted-foreground">
            <span>{t(TYPE_NAME_KEY[artifact.type])}</span>
            {artifact.createdByName && <span>· {artifact.createdByName}</span>}
            <span>· {formatRelative(artifact.updatedAt, locale)}</span>
            {artifact.forkedFromId && (
              <Link href={`/n/${notebook.id}/artifacts/${artifact.forkedFromId}`} className="underline-offset-2 hover:underline">
                · {t("studio.forkedFrom")}
              </Link>
            )}
          </p>
        </div>

        <StatusBadge artifact={artifact} progress={progress} />

        <div className="flex flex-wrap items-center gap-1.5">
          {dirty && !preview && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving} data-testid="artifact-discard">
                <RotateCcw /> {t("studio.discard")}
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving} data-testid="artifact-save">
                {saving ? <Loader2 className="animate-spin" /> : <Save />} {t("common.save")}
              </Button>
            </>
          )}

          <DropdownMenu open={versionsOpen} onOpenChange={setVersionsOpen}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={!artifact.currentVersionNo} data-testid="version-menu">
                <History /> {artifact.currentVersionNo ? `v${preview?.versionNo ?? artifact.currentVersionNo}` : t("studio.versions")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
              <DropdownMenuLabel>{t("studio.versions")}</DropdownMenuLabel>
              {versions === null ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : (
                versions.map((v) => {
                  const active = preview ? preview.id === v.id : v.isCurrent;
                  return (
                    <DropdownMenuItem key={v.id} onSelect={() => void openPreview(v)} data-testid="version-item" className="items-start">
                      <span className="mt-0.5 w-4">{active && <Check className="size-4" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          v{v.versionNo}
                          {v.isCurrent ? ` · ${t("studio.version.current")}` : ""}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {v.note ?? ""} {v.createdByName ? `· ${v.createdByName}` : ""} · {formatRelative(v.createdAt, locale)}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" variant="outline" onClick={() => setShareOpen(true)} data-testid="artifact-share">
            <Share2 /> <span className="hidden sm:inline">{t("studio.menu.share")}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={!canExport} data-testid="artifact-export">
                <Download /> <span className="hidden sm:inline">{t("studio.menu.export")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {formats.map((f) => (
                <DropdownMenuItem key={f} onSelect={() => void exportAs(artifact.id, f, preview?.id)} data-testid={`export-${f}`}>
                  {t(FORMAT_LABEL_KEY[f])}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {artifact.canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="outline" aria-label={t("studio.more")} data-testid="artifact-more">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void fork()} disabled={!hasContent}>
                  <Copy /> {t("studio.menu.fork")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void regenerate()} disabled={busy} data-testid="artifact-regenerate">
                  <RefreshCw /> {t("studio.menu.regenerate")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 /> {t("studio.menu.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {preview && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-warning/15 px-4 py-2 text-sm" role="status" data-testid="preview-banner">
          <History className="size-4" aria-hidden />
          <span className="flex-1">{t("studio.preview.banner", { n: preview.versionNo })}</span>
          {artifact.canEdit && (
            <Button size="sm" onClick={() => void restore()} data-testid="version-restore">
              {t("studio.preview.restore")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
            {t("studio.preview.back")}
          </Button>
        </div>
      )}

      {artifact.status === "failed" && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert" data-testid="failed-banner">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{artifact.error ?? t("studio.status.failed")}</span>
          {artifact.canManage && (
            <Button size="sm" variant="outline" onClick={() => void regenerate()}>
              <RefreshCw /> {t("studio.retry")}
            </Button>
          )}
        </div>
      )}

      <div className={cn("min-h-0 flex-1 overflow-y-auto p-4 sm:p-6")}>
        {hasContent ? (
          <>
            {busy && (
              <p className="mx-auto mb-3 flex max-w-3xl items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" /> {t("studio.regeneratingHint")}
              </p>
            )}
            <ArtifactBody
              artifactId={artifact.id}
              type={artifact.type}
              content={shownContent}
              onChange={artifact.canEdit && !preview && !busy ? (c) => setDraft(c) : undefined}
              readOnly={readOnly}
              notebookId={notebook.id}
            />
          </>
        ) : busy ? (
          <div className="mx-auto flex max-w-sm flex-1 flex-col items-center gap-3 py-16 text-center" role="status" data-testid="artifact-generating">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <p className="text-sm font-medium">{progress?.stage ?? (artifact.status === "queued" ? t("studio.status.queued") : t("studio.status.generating"))}</p>
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress?.progress ?? 5}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{t("studio.generatingHint")}</p>
          </div>
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">{t("studio.noContent")}</p>
        )}
      </div>

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} artifact={artifact} isNotebookOwner={role === "owner"} onChanged={(a) => setArtifact((cur) => (cur ? { ...cur, visibility: a.visibility, shareToken: a.shareToken } : a))} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("studio.delete.title")}</DialogTitle>
            <DialogDescription>{t("studio.delete.description", { name: artifact.title })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void doDelete()} data-testid="delete-confirm">
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
