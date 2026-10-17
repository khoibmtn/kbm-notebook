"use client";
import { Loader2, PenLine, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useNotebook } from "@/components/notebook/notebook-context";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/api-client";
import type { ArtifactTypeName, CreateArtifactInput } from "@/lib/artifacts/meta";
import { useT } from "@/lib/i18n-client";
import { hasRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { ArtifactList } from "./artifact-list";
import { CustomizeDialog, type CustomizeResult } from "./customize-dialog";
import { STUDIO_TYPES, TYPE_DESC_KEY, TYPE_ICONS, TYPE_NAME_KEY } from "./type-meta";
import { useArtifacts, useStudioScope } from "./use-artifacts";

type Props = {
  /** `panel`: cột phải 360px (lưới 2 cột); `page`: trang đầy đủ `/n/[id]/studio` (lưới rộng). */
  variant?: "panel" | "page";
  className?: string;
};

/**
 * Studio: lưới thẻ loại artifact (bấm = tạo nhanh, ✎ = hộp "Tuỳ chỉnh") + danh sách artifact đã tạo
 * với trạng thái realtime (`artifact:status`).
 */
export function StudioPanel({ variant = "panel", className }: Props) {
  const t = useT();
  const { notebook, role } = useNotebook();
  const canEdit = hasRole(role, "editor");
  const { artifacts, error, progress, create, rename, fork, remove, reload } = useArtifacts(notebook.id);
  const scope = useStudioScope(notebook.id);
  const [customizing, setCustomizing] = useState<ArtifactTypeName | null>(null);
  const [creating, setCreating] = useState<ArtifactTypeName | null>(null);

  const noSources = scope.loaded && scope.scopeIds.length === 0;

  const disabledReason = (): string | null => {
    if (!canEdit) return t("studio.disabled.viewer");
    if (noSources) return t("studio.disabled.noSources");
    return null;
  };

  const doCreate = async (type: ArtifactTypeName, extra: Partial<CreateArtifactInput> = {}) => {
    setCreating(type);
    try {
      await create({ type, scope: { sourceIds: scope.scopeIds }, ...extra });
    } finally {
      setCreating(null);
    }
  };

  const regenerate = async (id: string) => {
    try {
      await api(`/api/artifacts/${id}/regenerate`, { method: "POST", json: {} });
      toast.success(t("studio.toast.regenerating"));
      await reload();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  };

  const onCustomSubmit = async (r: CustomizeResult) => {
    if (!customizing) return;
    await doCreate(customizing, { customPrompt: r.customPrompt, options: r.options, model: r.model });
    setCustomizing(null);
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4 p-3", variant === "page" && "mx-auto w-full max-w-5xl p-4 sm:p-6", className)} data-testid="studio-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="studio-scope">
          {!scope.loaded ? t("common.loading") : noSources ? t("studio.scope.none") : t("studio.scope.count", { count: scope.scopeIds.length })}
        </p>
        {!canEdit && <Badge variant="secondary">{t("studio.viewerBadge")}</Badge>}
      </div>

      <div className={cn("grid gap-2", variant === "page" ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4" : "grid-cols-2")} data-testid="studio-type-grid">
        {STUDIO_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type];
          const reason = disabledReason();
          const name = t(TYPE_NAME_KEY[type]);
          const busy = creating === type;
          return (
            <div key={type} className={cn("group relative rounded-xl border bg-card transition-colors", !reason && "hover:border-primary/40 hover:bg-accent/40", reason && "opacity-70")} data-testid={`studio-card-${type}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-1.5 rounded-xl p-3 pr-9 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed"
                    disabled={Boolean(reason) || Boolean(creating)}
                    onClick={() => void doCreate(type)}
                    aria-label={t("studio.createType", { name })}
                    data-testid={`studio-create-${type}`}
                  >
                    <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">{busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" aria-hidden />}</span>
                    <span className="text-sm font-medium leading-tight">{name}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{t(TYPE_DESC_KEY[type])}</span>
                  </button>
                </TooltipTrigger>
                {reason && <TooltipContent>{reason}</TooltipContent>}
              </Tooltip>
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1.5 top-1.5"
                disabled={Boolean(reason)}
                onClick={() => setCustomizing(type)}
                aria-label={t("studio.customizeType", { name })}
                title={t("studio.customize")}
                data-testid={`studio-customize-${type}`}
              >
                <PenLine />
              </Button>
            </div>
          );
        })}
      </div>

      <section aria-label={t("studio.list.title")} className="flex min-h-0 flex-1 flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {t("studio.list.title")}
          {artifacts && artifacts.length > 0 ? <span className="ml-1.5 font-normal text-muted-foreground">({artifacts.length})</span> : null}
        </h3>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : artifacts === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : artifacts.length === 0 ? (
          <EmptyState icon={Sparkles} title={t("studio.list.empty.title")} description={canEdit ? t("studio.list.empty.description") : t("studio.list.empty.viewer")} className="p-4" />
        ) : (
          <ArtifactList
            notebookId={notebook.id}
            artifacts={artifacts}
            progress={progress}
            isNotebookOwner={role === "owner"}
            onRename={rename}
            onFork={fork}
            onDelete={remove}
            onRegenerate={regenerate}
          />
        )}
      </section>

      {customizing && (
        <CustomizeDialog
          type={customizing}
          open
          onOpenChange={(o) => !o && setCustomizing(null)}
          scopeCount={scope.scopeIds.length}
          creating={creating !== null}
          onSubmit={onCustomSubmit}
        />
      )}
    </div>
  );
}
