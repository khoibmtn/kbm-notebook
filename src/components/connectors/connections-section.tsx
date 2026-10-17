"use client";
import { Loader2, Plug, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ConnectionDto } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";
import { ConnectionCard, type ConnectionCardActions } from "./connection-card";
import { ImportFromConnectionDialog } from "./import-from-connection-dialog";
import type { useConnections } from "./use-connections";

type Props = {
  state: ReturnType<typeof useConnections>;
  notebookId: string;
  canEdit: boolean;
  onAdd: () => void;
  /** Sau khi nhập nguồn từ NotebookLM: tải lại danh sách nguồn. */
  onImported: () => void;
};

/** Mục "Kết nối ngoài" dưới danh sách nguồn trong cột Nguồn. */
export function ConnectionsSection({ state, notebookId, canEdit, onAdd, onImported }: Props) {
  const t = useT();
  const { connections, error, sync, setShared, refreshCredentials, remove, reload } = state;
  const [importing, setImporting] = useState<ConnectionDto | null>(null);
  const [removing, setRemoving] = useState<ConnectionDto | null>(null);
  const [busy, setBusy] = useState(false);

  const actions: ConnectionCardActions = {
    onSync: (c) => sync(c.id),
    onImport: (c) => setImporting(c),
    onToggleShared: (c) => setShared(c.id, !c.sharedWithMembers),
    onRefreshCredentials: (c) => refreshCredentials(c.id),
    onRemove: (c) => setRemoving(c),
  };

  return (
    <section className="max-h-[45%] shrink-0 overflow-y-auto border-t p-2" aria-label={t("connectors.section.title")} data-testid="connections-section">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Plug className="size-3.5" aria-hidden /> {t("connectors.section.title")}
        </h3>
        {canEdit && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onAdd} data-testid="add-connection-button">
            <Plus className="size-3.5" /> {t("connectors.section.add")}
          </Button>
        )}
      </div>

      {!connections && !error && <p className="px-1 py-2 text-xs text-muted-foreground">{t("common.loading")}</p>}
      {error && !connections && (
        <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
          <span>{error}</span>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void reload()}>
            {t("sources.retry")}
          </Button>
        </div>
      )}
      {connections && connections.length === 0 && (
        <p className="px-1 py-1 text-xs text-muted-foreground" data-testid="connections-empty">
          {t("connectors.section.empty")}
        </p>
      )}
      {connections && connections.length > 0 && (
        <ul className="space-y-1.5" data-testid="connections-list">
          {connections.map((c) => (
            <ConnectionCard key={c.id} connection={c} actions={actions} canEdit={canEdit} />
          ))}
        </ul>
      )}

      <ImportFromConnectionDialog
        notebookId={notebookId}
        connection={importing}
        onOpenChange={(o) => {
          if (!o) setImporting(null);
        }}
        onImported={onImported}
      />

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("connectors.remove.title")}</DialogTitle>
            <DialogDescription>{t("connectors.remove.description", { label: removing?.label ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                const target = removing;
                if (!target) return;
                setBusy(true);
                await remove(target.id);
                setBusy(false);
                setRemoving(null);
              }}
              data-testid="connection-remove-confirm"
            >
              {busy && <Loader2 className="animate-spin" />} {t("connectors.menu.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
