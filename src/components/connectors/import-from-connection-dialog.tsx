"use client";
import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import type { ConnectionDto, ExternalSource } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";

type ImportResult = {
  imported: { externalSourceId: string; sourceId: string; title: string }[];
  failed: { externalSourceId: string; message: string }[];
};

type Props = {
  notebookId: string;
  connection: ConnectionDto | null;
  onOpenChange: (open: boolean) => void;
  /** Gọi sau khi nhập xong để tải lại danh sách nguồn. */
  onImported: () => void;
};

/** "Nhập nguồn vào sổ tay": liệt kê nguồn hiện có trong notebook NotebookLM, chọn và nhập (văn bản đầy đủ → nguồn text + ingest). */
export function ImportFromConnectionDialog({ notebookId, connection, onOpenChange, onImported }: Props) {
  const t = useT();
  const open = connection !== null;
  const [sources, setSources] = useState<ExternalSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const connId = connection?.id ?? null;

  useEffect(() => {
    if (!connId) return;
    let cancelled = false;
    api<{ sources: ExternalSource[] }>(`/api/notebooks/${notebookId}/connections/${connId}/sources`)
      .then((res) => {
        if (!cancelled) setSources(res.sources);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, t("common.error")));
      });
    return () => {
      cancelled = true;
      setSources(null);
      setError(null);
      setSelected(new Set());
      setResult(null);
    };
  }, [connId, notebookId, t]);

  async function run() {
    if (!connection || selected.size === 0) return;
    setBusy(true);
    try {
      const res = await api<ImportResult>(`/api/notebooks/${notebookId}/connections/${connection.id}/import`, {
        method: "POST",
        json: { externalSourceIds: [...selected], visibility: isPrivate ? "private" : "shared" },
      });
      setResult(res);
      if (res.imported.length > 0) {
        toast.success(t("connectors.import.done", { count: res.imported.length }));
        onImported();
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "bridge_fulltext_unsupported") setError(t("connectors.import.unsupported"));
      else toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="import-connection-dialog">
        <DialogHeader>
          <DialogTitle>{t("connectors.import.title")}</DialogTitle>
          <DialogDescription>{t("connectors.import.description", { label: connection?.label ?? "" })}</DialogDescription>
        </DialogHeader>

        {error && (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" role="alert" data-testid="import-error">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="break-words">{error}</span>
          </p>
        )}
        {!sources && !error && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-busy>
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t("common.loading")}
          </p>
        )}
        {sources && sources.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{t("connectors.import.empty")}</p>}
        {sources && sources.length > 0 && (
          <ul className="max-h-64 space-y-0.5 overflow-y-auto" data-testid="import-sources">
            {sources.map((s) => {
              const done = result?.imported.find((i) => i.externalSourceId === s.id);
              const failed = result?.failed.find((f) => f.externalSourceId === s.id);
              return (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent">
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.has(s.id)}
                      disabled={Boolean(done)}
                      onCheckedChange={(v) =>
                        setSelected((cur) => {
                          const n = new Set(cur);
                          if (v === true) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                      aria-label={s.title}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.title}</span>
                      {failed && <span className="block text-xs text-destructive">{failed.message}</span>}
                      {done && <span className="block text-xs text-emerald-600">{t("connectors.import.imported")}</span>}
                    </span>
                    {s.status && s.status !== "ready" && <span className="shrink-0 text-xs text-muted-foreground">{s.status}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
          <div>
            <Label htmlFor="import-private" className="text-sm">
              {t("sources.add.private")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("sources.add.privateHint")}</p>
          </div>
          <Switch id="import-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("connectors.close")}
          </Button>
          <Button disabled={busy || selected.size === 0} onClick={() => void run()} data-testid="import-submit">
            {busy && <Loader2 className="animate-spin" />} {t("connectors.import.submit", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
