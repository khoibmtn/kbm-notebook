"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";

export function NotificationsForm({ initial }: { initial: boolean }) {
  const t = useT();
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    const prev = enabled;
    setEnabled(next);
    setBusy(true);
    try {
      await api("/api/settings/notifications", { method: "PUT", json: { notifyEmail: next } });
      toast.success(t("common.saved"));
    } catch (e) {
      setEnabled(prev);
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.notifications.title")}</CardTitle>
        <CardDescription>{t("settings.notifications.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="n-email">{t("settings.notifications.email")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.notifications.emailHint")}</p>
          </div>
          <Switch id="n-email" checked={enabled} onCheckedChange={toggle} disabled={busy} />
        </div>
      </CardContent>
    </Card>
  );
}
