"use client";
import { ExternalLink, Globe, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useNotebook } from "@/components/notebook/notebook-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { SLUG_RE } from "@/lib/community";
import { useT } from "@/lib/i18n-client";

type State = { isPublic: boolean; slug: string | null; suggestedSlug: string };

/** Cài đặt sổ tay → "Công khai sổ tay" (chỉ chủ sở hữu): bật/tắt + đường dẫn `/p/<slug>`, kèm cảnh báo về phạm vi công khai. */
export function PublishNotebookCard() {
  const t = useT();
  const { notebook } = useNotebook();
  const [state, setState] = useState<State | null>(null);
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/notebooks/${notebook.id}/public`;

  useEffect(() => {
    let cancelled = false;
    api<State>(base)
      .then((s) => {
        if (cancelled) return;
        setState(s);
        setSlug(s.slug ?? s.suggestedSlug);
      })
      .catch((e) => {
        if (!cancelled) toast.error(errorMessage(e, t("common.error")));
      });
    return () => {
      cancelled = true;
    };
  }, [base, t]);

  async function save(next: { isPublic: boolean; slug?: string }, okKey?: "community.publish.enabled" | "community.publish.disabled") {
    setBusy(true);
    try {
      const res = await api<{ isPublic: boolean; slug: string | null }>(base, { method: "PATCH", json: next });
      setState((s) => (s ? { ...s, isPublic: res.isPublic, slug: res.slug } : s));
      if (res.slug) setSlug(res.slug);
      toast.success(okKey ? t(okKey) : t("common.saved"));
    } catch (e) {
      toast.error(e instanceof ApiClientError && e.code === "slug_taken" ? t("community.publish.slugTaken") : errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  const slugValid = SLUG_RE.test(slug) && slug.length >= 3;
  const slugChanged = state != null && slug !== (state.slug ?? "");

  return (
    <Card data-testid="publish-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4" aria-hidden /> {t("community.publish.title")}
        </CardTitle>
        <CardDescription>{t("community.publish.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === null ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <Label htmlFor="pub-toggle">{t("community.publish.toggle")}</Label>
              <Switch
                id="pub-toggle"
                checked={state.isPublic}
                disabled={busy || (!state.isPublic && !slugValid)}
                onCheckedChange={(v) => void save({ isPublic: v, slug: slugValid ? slug : undefined }, v ? "community.publish.enabled" : "community.publish.disabled")}
                data-testid="publish-toggle"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pub-slug">{t("community.publish.slug")}</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border bg-background pl-3 text-sm text-muted-foreground focus-within:ring-[3px] focus-within:ring-ring/50">
                  <span className="shrink-0">/p/</span>
                  <Input
                    id="pub-slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    maxLength={60}
                    className="border-0 shadow-none focus-visible:ring-0"
                    aria-invalid={!slugValid}
                    data-testid="publish-slug"
                  />
                </div>
                <Button variant="outline" disabled={busy || !slugValid || !slugChanged} onClick={() => void save({ isPublic: state.isPublic, slug })} data-testid="publish-save">
                  {busy && <Loader2 className="animate-spin" />} {t("community.publish.save")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("community.publish.slugHint")}</p>
            </div>
            {state.isPublic && state.slug && (
              <Button asChild variant="link" className="h-auto p-0">
                <Link href={`/p/${state.slug}`} target="_blank" rel="noopener noreferrer" data-testid="publish-view">
                  <ExternalLink /> {t("community.publish.view")}
                </Link>
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
