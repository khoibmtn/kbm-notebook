"use client";
import { FolderOpen, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNotebook } from "@/components/notebook/notebook-context";
import { EmptyState } from "@/components/shared/empty-state";
import { AddSourceDialog } from "@/components/sources/add-source-dialog";
import { SourceCard, type SourceCardActions } from "@/components/sources/source-card";
import { SourceViewerSheet } from "@/components/sources/source-viewer";
import { useShareToChat } from "@/components/team-chat/share-to-chat-provider";
import { useSources } from "@/components/sources/use-sources";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { hasRole } from "@/lib/roles";
import type { SourceDto } from "@/lib/sources";
import { isSelectionInitialized, useSourceSelection } from "@/lib/use-source-selection";
import { cn } from "@/lib/utils";

type Props = {
  /** Giới hạn dung lượng tệp (MB) do server cấu hình (MAX_UPLOAD_MB). */
  maxUploadMb: number;
  /** Mở sẵn Source viewer cho nguồn này (liên kết sâu `?source=<id>`). */
  initialViewSourceId?: string | null;
  /** Mở sẵn hộp "Thêm nguồn" (từ bảng lệnh ⌘K). */
  initialAddOpen?: boolean;
  className?: string;
};

/**
 * Bảng Nguồn: thêm nguồn, danh sách thẻ nguồn với trạng thái realtime, chọn nguồn làm phạm vi cho Chat/Studio.
 * Dùng trong cột trái của `NotebookWorkspace` và ở trang `/n/[id]/sources`.
 */
export function SourcesPanel({ maxUploadMb, initialViewSourceId = null, initialAddOpen = false, className }: Props) {
  const t = useT();
  const { notebook, role, user } = useNotebook();
  const canEdit = hasRole(role, "editor");
  const { sources, error, reload, rename, setVisibility, remove, reprocess } = useSources(notebook.id, user.id);
  const shareToChat = useShareToChat();
  const selection = useSourceSelection(notebook.id);
  const { prune, add, setAll, toggle, isSelected } = selection;

  const [addOpen, setAddOpen] = useState(initialAddOpen && canEdit);
  const [viewing, setViewing] = useState<string | null>(initialViewSourceId);
  const [renaming, setRenaming] = useState<SourceDto | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<SourceDto | null>(null);
  const [busy, setBusy] = useState(false);

  const readyIds = useMemo(() => (sources ?? []).filter((s) => s.status === "ready").map((s) => s.id), [sources]);

  // Lần đầu (chưa có lựa chọn lưu) chọn sẵn mọi nguồn đã sẵn sàng; sau đó bỏ id không còn tồn tại.
  useEffect(() => {
    if (!sources) return;
    if (!isSelectionInitialized(notebook.id)) setAll(readyIds);
    else prune(sources.map((s) => s.id));
  }, [sources, readyIds, notebook.id, setAll, prune]);

  const selectedReady = readyIds.filter(isSelected);
  const allChecked = readyIds.length > 0 && selectedReady.length === readyIds.length;
  const someChecked = selectedReady.length > 0 && !allChecked;

  const onAdded = useCallback(
    (created: SourceDto[]) => {
      add(created.map((s) => s.id)); // nguồn mới mặc định được chọn
      void reload();
    },
    [add, reload],
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  };

  const actions: SourceCardActions = {
    onView: (s) => setViewing(s.id),
    onRename: (s) => {
      setRenaming(s);
      setRenameValue(s.title);
    },
    onToggleVisibility: (s) => void run(() => setVisibility(s.id, s.visibility === "private" ? "shared" : "private")),
    onReprocess: (s) => void run(() => reprocess(s.id)),
    onDelete: (s) => setDeleting(s),
    onShareToChat: shareToChat ? (s) => shareToChat({ type: "source", id: s.id, title: s.title }) : undefined,
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid="sources-panel">
      <div className="space-y-2 border-b p-3">
        <Button className="w-full" onClick={() => setAddOpen(true)} disabled={!canEdit} data-testid="add-source-button">
          <Plus /> {t("sources.add")}
        </Button>
        {!canEdit && <p className="text-xs text-muted-foreground">{t("sources.readOnlyHint")}</p>}
        {sources && sources.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                disabled={readyIds.length === 0}
                onCheckedChange={() => setAll(allChecked ? [] : readyIds)}
                aria-label={t("sources.selectAll")}
                data-testid="select-all-sources"
              />
              {t("sources.selectAll")}
            </label>
            <span data-testid="sources-count" title={t("sources.selectedCount", { selected: selectedReady.length, count: sources.length })}>
              {selectedReady.length > 0 && selectedReady.length < sources.length
                ? `${selectedReady.length}/${sources.length}`
                : t("sources.count", { count: sources.length })}
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!sources && !error && (
          <div className="space-y-2 p-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {error && !sources && (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              {t("sources.retry")}
            </Button>
          </div>
        )}
        {sources && sources.length === 0 && (
          <EmptyState
            icon={FolderOpen}
            title={t("sources.emptyTitle")}
            description={t("sources.emptyDescription")}
            action={
              canEdit ? (
                <Button onClick={() => setAddOpen(true)}>
                  <Plus /> {t("sources.add")}
                </Button>
              ) : undefined
            }
          />
        )}
        {sources && sources.length > 0 && (
          <ul className="space-y-0.5 p-2">
            {sources.map((s) => (
              <SourceCard
                key={s.id}
                source={s}
                selected={isSelected(s.id)}
                onSelectedChange={() => toggle(s.id)}
                actions={actions}
                canEdit={canEdit}
              />
            ))}
          </ul>
        )}
      </div>

      <AddSourceDialog notebookId={notebook.id} open={addOpen} onOpenChange={setAddOpen} maxUploadMb={maxUploadMb} onAdded={onAdded} />

      <SourceViewerSheet
        notebookId={notebook.id}
        sourceId={viewing ?? ""}
        open={viewing !== null}
        onOpenChange={(o) => {
          if (!o) setViewing(null);
        }}
      />

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const target = renaming;
              if (!target || !renameValue.trim()) return;
              void run(async () => {
                await rename(target.id, renameValue.trim());
                setRenaming(null);
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("sources.rename.title")}</DialogTitle>
              <DialogDescription className="sr-only">{t("sources.rename.title")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="rename-source">{t("sources.rename.label")}</Label>
              <Input id="rename-source" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={200} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !renameValue.trim()}>
                {busy && <Loader2 className="animate-spin" />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sources.delete.title")}</DialogTitle>
            <DialogDescription>{t("sources.delete.description", { title: deleting?.title ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                void run(async () => {
                  await remove(target.id);
                  setDeleting(null);
                });
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              {t("sources.menu.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
