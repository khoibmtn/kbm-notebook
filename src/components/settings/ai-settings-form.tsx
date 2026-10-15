"use client";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import type { AiSettingsView } from "@/server/settings/service";

type TestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; provider: string; models: string[] }
  | { status: "error"; message: string };

export function AiSettingsForm({ initial }: { initial: AiSettingsView }) {
  const t = useT();
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState(initial.defaultChatModel ?? "");
  const [artifactModel, setArtifactModel] = useState(initial.defaultArtifactModel ?? "");
  const [embeddingModel, setEmbeddingModel] = useState(initial.embeddingModel);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const models = test.status === "ok" ? test.models : [];

  async function runTest() {
    setTest({ status: "loading" });
    try {
      const res = await api<{ ok: true; provider: string; models: string[] }>("/api/settings/ai/test", {
        method: "POST",
        json: apiKey.trim() ? { apiKey: apiKey.trim() } : {},
      });
      setTest({ status: "ok", provider: res.provider, models: res.models });
    } catch (e) {
      const message = e instanceof ApiClientError && e.code === "ai_not_configured" ? t("settings.ai.notConfigured") : errorMessage(e, t("common.error"));
      setTest({ status: "error", message });
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/settings/ai", {
        method: "PUT",
        json: {
          ...(apiKey.trim() ? { geminiApiKey: apiKey.trim() } : {}),
          defaultChatModel: chatModel.trim() || null,
          defaultArtifactModel: artifactModel.trim() || null,
          embeddingModel: embeddingModel.trim() || initial.embeddingModel,
        },
      });
      setApiKey("");
      toast.success(t("common.saved"));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    if (!window.confirm(t("settings.ai.removeConfirm"))) return;
    try {
      await api("/api/settings/ai", { method: "PUT", json: { geminiApiKey: null } });
      toast.success(t("common.saved"));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.ai.title")}</CardTitle>
        <CardDescription>{t("settings.ai.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">
              {t("settings.ai.provider")}: {initial.provider}
            </Badge>
            <Badge variant={initial.hasUserKey ? "default" : "outline"}>
              {initial.hasUserKey ? t("settings.ai.userKey", { mask: initial.keyMask ?? "" }) : t("settings.ai.noUserKey")}
            </Badge>
            <Badge variant="outline">
              {initial.serverKeyAvailable ? t("settings.ai.serverKey.yes") : t("settings.ai.serverKey.no")}
            </Badge>
          </div>
          {initial.provider === "mock" && (
            <p className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">{t("settings.ai.mockNotice")}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ai-key">{t("settings.ai.apiKey")}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={initial.hasUserKey ? t("settings.ai.apiKey.keep") : "AIza..."}
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={runTest} disabled={test.status === "loading"}>
                {test.status === "loading" && <Loader2 className="animate-spin" />} {t("settings.ai.test")}
              </Button>
              {initial.hasUserKey && (
                <Button type="button" variant="ghost" onClick={removeKey} className="text-destructive">
                  {t("settings.ai.remove")}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.ai.apiKey.hint")}</p>
            <div aria-live="polite">
              {test.status === "ok" && (
                <p className="flex items-start gap-1.5 text-sm text-success" data-testid="ai-test-ok">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  {t("settings.ai.test.ok", { provider: test.provider, count: test.models.length })}
                </p>
              )}
              {test.status === "error" && (
                <p className="flex items-start gap-1.5 text-sm text-destructive" data-testid="ai-test-error">
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                  {test.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-chat">{t("settings.ai.chatModel")}</Label>
              <Input
                id="ai-chat"
                list="ai-models"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                placeholder={initial.fallbackModels.chat}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-artifact">{t("settings.ai.artifactModel")}</Label>
              <Input
                id="ai-artifact"
                list="ai-models"
                value={artifactModel}
                onChange={(e) => setArtifactModel(e.target.value)}
                placeholder={initial.fallbackModels.artifact}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-embed">{t("settings.ai.embeddingModel")}</Label>
              <Input id="ai-embed" list="ai-models" value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("settings.ai.embeddingDim", { dim: initial.embeddingDim })}</p>
            </div>
          </div>
          <datalist id="ai-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">{t("settings.ai.modelsHint")}</p>

          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} {t("common.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
