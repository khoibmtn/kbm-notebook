"use client";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { connectGoogleDrive } from "@/lib/auth-client";
import {
  ENTERPRISE_LOCATIONS,
  looksLikePrivateHost,
  type BridgeTestResult,
  type ConnectorsOverview,
  type EnterpriseAuthType,
  type EnterpriseLocation,
  type EnterpriseTestResult,
} from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";

type TestState<T> = { status: "idle" } | { status: "loading" } | { status: "done"; result: T } | { status: "error"; message: string };

export function ConnectorsSettings({ initial }: { initial: ConnectorsOverview }) {
  const t = useT();
  return (
    <div className="space-y-4" data-testid="connectors-settings">
      <p className="text-sm text-muted-foreground">{t("connectors.settings.intro")}</p>
      <BridgeCard initial={initial.bridge} privateAllowedByServer={initial.privateHostsAllowedByServer} />
      <EnterpriseCard initial={initial.enterprise} />
      <DriveCard initial={initial.drive} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* NotebookLM Bridge                                                           */
/* -------------------------------------------------------------------------- */

function BridgeCard({ initial, privateAllowedByServer }: { initial: ConnectorsOverview["bridge"]; privateAllowedByServer: boolean }) {
  const t = useT();
  const router = useRouter();
  const [url, setUrl] = useState(initial.url ?? "");
  const [token, setToken] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(initial.allowPrivateHosts);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestState<BridgeTestResult>>({ status: "idle" });
  const isPrivate = looksLikePrivateHost(url);

  const body = () => ({ url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}), allowPrivateHosts: allowPrivate });

  async function runTest() {
    setTest({ status: "loading" });
    try {
      const result = await api<BridgeTestResult>("/api/connectors/bridge/test", { method: "POST", json: url.trim() || token.trim() ? body() : {} });
      setTest({ status: "done", result });
    } catch (e) {
      setTest({ status: "error", message: errorMessage(e, t("common.error")) });
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/connectors/bridge", { method: "PUT", json: body() });
      setToken("");
      toast.success(t("common.saved"));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("connectors.bridge.removeConfirm"))) return;
    try {
      await api("/api/connectors/bridge", { method: "DELETE" });
      setUrl("");
      setToken("");
      setAllowPrivate(false);
      setTest({ status: "idle" });
      toast.success(t("common.saved"));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    }
  }

  return (
    <Card data-testid="bridge-card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t("connectors.bridge.title")}</CardTitle>
          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
            {t("connectors.bridge.badge")}
          </Badge>
          <Badge variant={initial.configured ? "secondary" : "outline"} data-testid="bridge-saved-badge">
            {initial.configured ? t("connectors.savedConfig") : t("connectors.notConfigured")}
          </Badge>
        </div>
        <CardDescription>{t("connectors.bridge.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="note"
          className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
          data-testid="bridge-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">{t("connectors.bridge.warning.title")}</p>
            <p>{t("connectors.bridge.warning.body")}</p>
            <p>
              {t("connectors.bridge.warning.guide")} <code className="rounded bg-background/60 px-1 py-0.5 text-xs">bridge/notebooklm/README.md</code> · <code className="rounded bg-background/60 px-1 py-0.5 text-xs">docs/07-ket-noi.md</code>
            </p>
          </div>
        </div>

        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bridge-url">{t("connectors.bridge.url")}</Label>
            <Input id="bridge-url" type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8765" required data-testid="bridge-url" />
            <p className="text-xs text-muted-foreground">{t("connectors.bridge.urlHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bridge-token">{t("connectors.bridge.token")}</Label>
            <Input
              id="bridge-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={initial.configured ? t("connectors.bridge.tokenKeep", { mask: initial.tokenMask ?? "" }) : ""}
              data-testid="bridge-token"
            />
            <p className="text-xs text-muted-foreground">{t("connectors.bridge.tokenHint")}</p>
          </div>

          {(isPrivate || allowPrivate) && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-300/70 bg-amber-50/60 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/5" data-testid="bridge-private-warning">
              <div className="space-y-0.5">
                <Label htmlFor="bridge-private" className="text-sm">
                  {t("connectors.bridge.allowPrivate")}
                </Label>
                <p className="text-xs text-muted-foreground">{t("connectors.bridge.allowPrivateHint")}</p>
                {!privateAllowedByServer && <p className="text-xs text-destructive">{t("connectors.bridge.privateDisabledByServer")}</p>}
              </div>
              <Switch id="bridge-private" checked={allowPrivate} onCheckedChange={setAllowPrivate} disabled={!privateAllowedByServer} data-testid="bridge-private-switch" />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void runTest()} disabled={test.status === "loading"} data-testid="bridge-test">
              {test.status === "loading" && <Loader2 className="animate-spin" />} {t("connectors.bridge.test")}
            </Button>
            <Button type="submit" disabled={busy} data-testid="bridge-save">
              {busy && <Loader2 className="animate-spin" />} {t("common.save")}
            </Button>
            {initial.configured && (
              <Button type="button" variant="ghost" className="text-destructive" onClick={() => void remove()}>
                {t("connectors.bridge.remove")}
              </Button>
            )}
          </div>

          <div aria-live="polite" className="text-sm">
            {test.status === "idle" && <p className="text-xs text-muted-foreground">{t("connectors.notTested")}</p>}
            {test.status === "done" && <BridgeResult result={test.result} />}
            {test.status === "error" && (
              <p className="flex items-start gap-1.5 text-destructive" data-testid="bridge-test-error">
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="break-words">{test.message}</span>
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function BridgeResult({ result }: { result: BridgeTestResult }) {
  const t = useT();
  const versions = [result.version && `Bridge ${result.version}`, result.notebooklmPyVersion && `notebooklm-py ${result.notebooklmPyVersion}`].filter(Boolean).join(" · ");
  if (!result.authenticated) {
    return (
      <div className="space-y-1" data-testid="bridge-test-unauthenticated">
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("connectors.bridge.test.notAuthenticated", { detail: result.detail ?? "" })}</span>
        </p>
        {versions && <p className="text-xs text-muted-foreground">{versions}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-1" data-testid="bridge-test-ok">
      <p className="flex items-start gap-1.5 text-success">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {t("connectors.bridge.test.ok", { account: result.account ?? "—" })}
          {result.notebookCount !== null && ` · ${t("connectors.bridge.test.notebooks", { count: result.notebookCount })}`}
        </span>
      </p>
      {versions && <p className="text-xs text-muted-foreground">{versions}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* NotebookLM Enterprise                                                       */
/* -------------------------------------------------------------------------- */

function EnterpriseCard({ initial }: { initial: ConnectorsOverview["enterprise"] }) {
  const t = useT();
  const router = useRouter();
  const [project, setProject] = useState(initial.projectNumber ?? "");
  const [location, setLocation] = useState<EnterpriseLocation>(initial.location);
  const [authType, setAuthType] = useState<EnterpriseAuthType>(initial.authType ?? "access_token");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestState<EnterpriseTestResult>>({ status: "idle" });

  const auth = () => {
    const v = secret.trim();
    if (!v) return undefined;
    return authType === "access_token" ? { type: "access_token" as const, accessToken: v } : { type: "service_account" as const, serviceAccountJson: v };
  };
  const body = () => ({ projectNumber: project.trim(), location, ...(auth() ? { auth: auth() } : {}) });

  async function runTest() {
    setTest({ status: "loading" });
    try {
      const result = await api<EnterpriseTestResult>("/api/connectors/enterprise/test", { method: "POST", json: project.trim() ? body() : {} });
      setTest({ status: "done", result });
    } catch (e) {
      setTest({ status: "error", message: errorMessage(e, t("common.error")) });
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/connectors/enterprise", { method: "PUT", json: body() });
      setSecret("");
      toast.success(t("common.saved"));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("connectors.enterprise.removeConfirm"))) return;
    try {
      await api("/api/connectors/enterprise", { method: "DELETE" });
      setProject("");
      setSecret("");
      setTest({ status: "idle" });
      toast.success(t("common.saved"));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    }
  }

  return (
    <Card data-testid="enterprise-card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t("connectors.enterprise.title")}</CardTitle>
          <Badge variant="outline">Preview</Badge>
          <Badge variant={initial.configured ? "secondary" : "outline"}>{initial.configured ? t("connectors.savedConfig") : t("connectors.notConfigured")}</Badge>
        </div>
        <CardDescription>{t("connectors.enterprise.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("connectors.enterprise.noChat")}</span>
        </p>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ent-project">{t("connectors.enterprise.project")}</Label>
              <Input id="ent-project" inputMode="numeric" autoComplete="off" value={project} onChange={(e) => setProject(e.target.value)} placeholder="123456789012" required data-testid="enterprise-project" />
              <p className="text-xs text-muted-foreground">{t("connectors.enterprise.projectHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ent-location">{t("connectors.enterprise.location")}</Label>
              <Select value={location} onValueChange={(v) => setLocation(v as EnterpriseLocation)}>
                <SelectTrigger id="ent-location" className="w-full" data-testid="enterprise-location">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTERPRISE_LOCATIONS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("connectors.enterprise.auth")}</Label>
            <div role="radiogroup" aria-label={t("connectors.enterprise.auth")} className="grid max-w-md grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(["access_token", "service_account"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={authType === a}
                  onClick={() => setAuthType(a)}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${authType === a ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {a === "access_token" ? t("connectors.enterprise.authToken") : t("connectors.enterprise.authSa")}
                </button>
              ))}
            </div>
            {authType === "access_token" ? (
              <Input
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={initial.configured && initial.authType === "access_token" ? t("connectors.bridge.tokenKeep", { mask: initial.secretHint ?? "" }) : "ya29.…"}
                aria-label={t("connectors.enterprise.authToken")}
                data-testid="enterprise-token"
              />
            ) : (
              <Textarea
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                rows={5}
                spellCheck={false}
                autoComplete="off"
                placeholder={initial.configured && initial.authType === "service_account" ? t("connectors.enterprise.saKeep", { email: initial.secretHint ?? "" }) : '{ "type": "service_account", … }'}
                aria-label={t("connectors.enterprise.authSa")}
                className="font-mono text-xs"
                data-testid="enterprise-sa"
              />
            )}
            <p className="text-xs text-muted-foreground">{authType === "access_token" ? t("connectors.enterprise.tokenHint") : t("connectors.enterprise.saHint")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void runTest()} disabled={test.status === "loading"} data-testid="enterprise-test">
              {test.status === "loading" && <Loader2 className="animate-spin" />} {t("connectors.enterprise.test")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {t("common.save")}
            </Button>
            {initial.configured && (
              <Button type="button" variant="ghost" className="text-destructive" onClick={() => void remove()}>
                {t("connectors.bridge.remove")}
              </Button>
            )}
          </div>

          <div aria-live="polite" className="text-sm">
            {test.status === "idle" && <p className="text-xs text-muted-foreground">{t("connectors.notTested")}</p>}
            {test.status === "done" && (
              <p className="flex items-start gap-1.5 text-success" data-testid="enterprise-test-ok">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("connectors.enterprise.test.ok", { count: test.result.notebookCount, endpoint: test.result.endpoint })}
              </p>
            )}
            {test.status === "error" && (
              <p className="flex items-start gap-1.5 text-destructive" data-testid="enterprise-test-error">
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="break-words">{test.message}</span>
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Google Drive                                                                */
/* -------------------------------------------------------------------------- */

function DriveCard({ initial }: { initial: ConnectorsOverview["drive"] }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try {
      await connectGoogleDrive("/settings?tab=connectors");
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : errorMessage(e, t("connectors.drive.connectFailed")));
      setBusy(false);
    }
  }

  let state: "not_configured" | "not_linked" | "no_scope" | "granted";
  if (!initial.googleConfigured) state = "not_configured";
  else if (!initial.linked) state = "not_linked";
  else if (!initial.hasDriveScope) state = "no_scope";
  else state = "granted";

  return (
    <Card data-testid="drive-card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{t("connectors.drive.title")}</CardTitle>
          <Badge variant={state === "granted" ? "secondary" : "outline"} data-testid="drive-state" data-state={state}>
            {state === "granted" ? t("connectors.drive.state.granted") : state === "not_configured" ? t("connectors.drive.state.notConfigured") : t("connectors.drive.state.notConnected")}
          </Badge>
        </div>
        <CardDescription>{t("connectors.drive.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "not_configured" && (
          <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm" data-testid="drive-not-configured-notice">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t("connectors.drive.notConfigured")}</span>
          </p>
        )}
        {state === "not_linked" && <p className="text-sm text-muted-foreground">{t("connectors.drive.notLinked")}</p>}
        {state === "no_scope" && <p className="text-sm text-muted-foreground">{t("connectors.drive.noScope")}</p>}
        {state === "granted" && (
          <p className="flex items-start gap-1.5 text-sm" data-testid="drive-granted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>
              {t("connectors.drive.granted")} <span className="text-muted-foreground">{t("connectors.drive.grantedNote")}</span>
            </span>
          </p>
        )}
        {state !== "not_configured" && (
          <div className="space-y-1.5">
            <Button type="button" variant={state === "granted" ? "outline" : "default"} onClick={() => void connect()} disabled={busy} data-testid="drive-connect">
              {busy && <Loader2 className="animate-spin" />} {state === "granted" ? t("connectors.drive.reconnect") : t("connectors.drive.connect")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("connectors.drive.scopeHint")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
