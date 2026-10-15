"use client";
import { Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";

type Override = { system?: string; user?: string };

export function PromptsForm({
  types,
  defaults,
  initial,
}: {
  types: string[];
  defaults: Record<string, { system: string; user: string }>;
  initial: Record<string, Override>;
}) {
  const t = useT();
  const [overrides, setOverrides] = useState<Record<string, Override>>(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [system, setSystem] = useState("");
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);

  function open(type: string) {
    setEditing(type);
    setSystem(overrides[type]?.system ?? defaults[type].system);
    setUser(overrides[type]?.user ?? defaults[type].user);
  }

  async function persist(next: Record<string, Override>) {
    setBusy(true);
    try {
      const res = await api<{ prompts: Record<string, Override> }>("/api/settings/prompts", { method: "PUT", json: { prompts: next } });
      setOverrides(res.prompts);
      toast.success(t("common.saved"));
      setEditing(null);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!editing) return;
    const def = defaults[editing];
    const entry: Override = {};
    if (system.trim() && system !== def.system) entry.system = system;
    if (user.trim() && user !== def.user) entry.user = user;
    const next = { ...overrides };
    if (Object.keys(entry).length) next[editing] = entry;
    else delete next[editing];
    void persist(next);
  }

  function reset() {
    if (!editing) return;
    const next = { ...overrides };
    delete next[editing];
    void persist(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("settings.prompts.description")}</p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings.prompts.type")}</TableHead>
              <TableHead>{t("settings.prompts.status")}</TableHead>
              <TableHead className="w-24 text-right">{t("common.edit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((type) => (
              <TableRow key={type}>
                <TableCell className="font-medium">{t(`artifact.${type}` as MessageKey)}</TableCell>
                <TableCell>
                  {overrides[type] ? (
                    <Badge>{t("settings.prompts.custom")}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("settings.prompts.default")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => open(type)} aria-label={`${t("common.edit")} ${t(`artifact.${type}` as MessageKey)}`}>
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t(`artifact.${editing}` as MessageKey) : ""}</DialogTitle>
            <DialogDescription>{t("settings.prompts.editHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pr-system">{t("settings.prompts.system")}</Label>
            <Textarea id="pr-system" value={system} onChange={(e) => setSystem(e.target.value)} rows={8} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-user">{t("settings.prompts.user")}</Label>
            <Textarea id="pr-user" value={user} onChange={(e) => setUser(e.target.value)} rows={4} className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={reset} disabled={busy || !editing || !overrides[editing]}>
              {t("settings.prompts.reset")}
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
