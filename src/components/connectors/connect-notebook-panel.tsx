"use client";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { CONNECTION_PROVIDER_LABEL, type ConnectionDto, type ConnectorProvider, type ExternalNotebook } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { notifyConnectionsChanged } from "./use-connections";

type ListState =
  | { status: "loading" }
  | { status: "ready"; notebooks: ExternalNotebook[] }
  | { status: "not_configured" }
  | { status: "error"; message: string };

const PATH: Record<ConnectorProvider, string> = {
  "notebooklm-bridge": "/api/connectors/bridge/notebooks",
  "notebooklm-enterprise": "/api/connectors/enterprise/notebooks",
};

type Props = {
  notebookId: string;
  /** Kết nối đã có của sổ tay (để đánh dấu notebook đã kết nối). */
  existing: ConnectionDto[];
  onConnected: (connection: ConnectionDto) => void;
};

/**
 * "Kết nối Gemini Notebook / NotebookLM": liệt kê notebook THẬT của người dùng (Bridge `/notebooks` hoặc Enterprise
 * `listRecentlyViewed`) để chọn, rồi tạo kết nối (server kiểm tra lại và chụp credential).
 */
export function ConnectNotebookPanel({ notebookId, existing, onConnected }: Props) {
  const t = useT();
  const [provider, setProvider] = useState<ConnectorProvider>("notebooklm-bridge");
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [selected, setSelected] = useState<ExternalNotebook | null>(null);
  const [label, setLabel] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ notebooks: ExternalNotebook[] }>(PATH[provider])
      .then((res) => {
        if (!cancelled) setState({ status: "ready", notebooks: res.notebooks });
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiClientError && e.code === "connector_not_configured") setState({ status: "not_configured" });
        else setState({ status: "error", message: errorMessage(e, t("common.error")) });
      });
    return () => {
      cancelled = true;
    };
  }, [provider, reloadKey, t]);

  const switchProvider = (p: ConnectorProvider) => {
    if (p === provider) return;
    setProvider(p);
    setState({ status: "loading" });
    setSelected(null);
    setLabel("");
  };

  const connectedIds = new Set(existing.filter((c) => c.provider === provider && c.isMine).map((c) => c.externalId));

  async function submit() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api<{ connection: ConnectionDto }>(`/api/notebooks/${notebookId}/connections`, {
        method: "POST",
        json: { provider, externalId: selected.id, label: label.trim() || undefined, sharedWithMembers: shared },
      });
      toast.success(t("connectors.connect.success", { label: res.connection.label }));
      notifyConnectionsChanged(notebookId);
      setSelected(null);
      setLabel("");
      setShared(false);
      onConnected(res.connection);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="connect-notebook-panel">
      <div role="radiogroup" aria-label={t("connectors.connect.provider")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["notebooklm-bridge", "notebooklm-enterprise"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={provider === p}
            onClick={() => switchProvider(p)}
            className={cn("rounded-md px-2 py-1.5 text-xs font-medium transition-colors", provider === p ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            data-testid={`connect-provider-${p}`}
          >
            {CONNECTION_PROVIDER_LABEL[p]}
            {p === "notebooklm-enterprise" && <span className="ml-1 text-[10px] text-muted-foreground">Preview</span>}
          </button>
        ))}
      </div>

      {provider === "notebooklm-enterprise" && <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">{t("connectors.connect.noChat")}</p>}
      {provider === "notebooklm-bridge" && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t("connectors.connect.unofficial")}</p>}

      {state.status === "loading" && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-busy data-testid="connect-loading">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t("connectors.connect.loading")}
        </p>
      )}

      {state.status === "not_configured" && (
        <div className="space-y-2 rounded-lg border border-dashed p-4 text-sm" data-testid="connect-not-configured">
          <p>{t("connectors.connect.notConfigured", { provider: CONNECTION_PROVIDER_LABEL[provider] })}</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings?tab=connectors">{t("connectors.connect.openSettings")}</Link>
          </Button>
        </div>
      )}

      {state.status === "error" && (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="connect-error">
          <p className="flex items-start gap-1.5 text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="break-words">{state.message}</span>
          </p>
          <Button size="sm" variant="outline" onClick={() => { setState({ status: "loading" }); setReloadKey((k) => k + 1); }}>
            <RefreshCw /> {t("connectors.connect.retry")}
          </Button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          {state.notebooks.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground" data-testid="connect-empty">
              {t("connectors.connect.empty")}
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label={t("connectors.connect.list")} data-testid="external-notebooks">
              {state.notebooks.map((n) => {
                const already = connectedIds.has(n.id);
                const active = selected?.id === n.id;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => {
                        setSelected(n);
                        setLabel(n.title);
                      }}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        active ? "border-primary bg-primary/5" : "hover:bg-accent",
                      )}
                      data-testid="external-notebook"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {already ? t("connectors.connect.already") : n.sourceCount != null ? t("connectors.card.sources", { count: n.sourceCount }) : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selected && (
            <form
              className="space-y-3 border-t pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="connect-label">{t("connectors.connect.labelField")}</Label>
                <Input id="connect-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
                <div>
                  <Label htmlFor="connect-share" className="text-sm">
                    {t("connectors.connect.share")}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t("connectors.connect.shareHint")}</p>
                </div>
                <Switch id="connect-share" checked={shared} onCheckedChange={setShared} />
              </div>
              <Button type="submit" disabled={busy} data-testid="connect-submit">
                {busy && <Loader2 className="animate-spin" />} {t("connectors.connect.submit")}
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
