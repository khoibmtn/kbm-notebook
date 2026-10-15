"use client";
import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { useLocale, useT } from "@/lib/i18n-client";
import type { Locale } from "@/lib/i18n";

export type ProfileData = {
  name: string;
  email: string;
  title: string | null;
  bio: string | null;
  locale: Locale;
  theme: "system" | "light" | "dark";
  notifyEmail: boolean;
};

export function ProfileForm({ initial }: { initial: ProfileData }) {
  const t = useT();
  const router = useRouter();
  const { setLocale } = useLocale();
  const { setTheme } = useTheme();
  const [name, setName] = useState(initial.name);
  const [title, setTitle] = useState(initial.title ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [locale, setLocaleValue] = useState<Locale>(initial.locale);
  const [theme, setThemeValue] = useState(initial.theme);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/settings/profile", {
        method: "PATCH",
        json: { name: name.trim(), title: title.trim() || null, bio: bio.trim() || null, locale, theme },
      });
      setLocale(locale);
      setTheme(theme);
      toast.success(t("common.saved"));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.profile.title")}</CardTitle>
        <CardDescription>{t("settings.profile.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-email">{t("auth.email")}</Label>
            <Input id="p-email" value={initial.email} disabled readOnly />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-name">{t("auth.name")}</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-title">{t("settings.profile.jobTitle")}</Label>
            <Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-bio">{t("settings.profile.bio")}</Label>
            <Textarea id="p-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={1000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-locale">{t("settings.profile.language")}</Label>
              <Select value={locale} onValueChange={(v) => setLocaleValue(v as Locale)}>
                <SelectTrigger id="p-locale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vi">Tiếng Việt</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-theme">{t("nav.theme")}</Label>
              <Select value={theme} onValueChange={(v) => setThemeValue(v as ProfileData["theme"])}>
                <SelectTrigger id="p-theme" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t("theme.system")}</SelectItem>
                  <SelectItem value="light">{t("theme.light")}</SelectItem>
                  <SelectItem value="dark">{t("theme.dark")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy && <Loader2 className="animate-spin" />} {t("common.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
