"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmojiColorPicker } from "@/components/dashboard/create-notebook-dialog";
import { useNotebook } from "@/components/notebook/notebook-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";
import { DEFAULT_COVER_COLOR, DEFAULT_EMOJI } from "@/lib/notebook-colors";
import { hasRole } from "@/lib/roles";

const VISIBILITIES = ["private", "notebook", "link", "public"] as const;

type MemberOption = { userId: string; name: string; email: string };

function DangerZone() {
  const t = useT();
  const router = useRouter();
  const { notebook } = useNotebook();
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [target, setTarget] = useState<string>("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ members: (MemberOption & { role: string })[] }>(`/api/notebooks/${notebook.id}/members`)
      .then((r) => setMembers(r.members.filter((m) => m.role !== "owner")))
      .catch(() => setMembers([]));
  }, [notebook.id]);

  async function transfer() {
    setBusy(true);
    try {
      await api(`/api/notebooks/${notebook.id}/transfer`, { method: "POST", json: { userId: target } });
      toast.success(t("danger.transfer.done"));
      setTransferOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/notebooks/${notebook.id}`, { method: "DELETE" });
      toast.success(t("danger.delete.done"));
      router.replace("/");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
      setBusy(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">{t("danger.title")}</CardTitle>
        <CardDescription>{t("danger.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">{t("danger.transfer.title")}</div>
            <p className="text-xs text-muted-foreground">{t("danger.transfer.description")}</p>
          </div>
          <Button variant="outline" onClick={() => setTransferOpen(true)} disabled={members.length === 0}>
            {t("danger.transfer.action")}
          </Button>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">{t("danger.delete.title")}</div>
            <p className="text-xs text-muted-foreground">{t("danger.delete.description")}</p>
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            {t("danger.delete.action")}
          </Button>
        </div>
      </CardContent>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("danger.transfer.title")}</DialogTitle>
            <DialogDescription>{t("danger.transfer.confirm")}</DialogDescription>
          </DialogHeader>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger aria-label={t("danger.transfer.pick")}>
              <SelectValue placeholder={t("danger.transfer.pick")} />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name} ({m.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={transfer} disabled={!target || busy}>
              {busy && <Loader2 className="animate-spin" />} {t("danger.transfer.action")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("danger.delete.title")}</DialogTitle>
            <DialogDescription>{t("danger.delete.confirm", { title: notebook.title })}</DialogDescription>
          </DialogHeader>
          <Input value={confirmTitle} onChange={(e) => setConfirmTitle(e.target.value)} aria-label={t("notebook.title")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={confirmTitle !== notebook.title || busy}>
              {busy && <Loader2 className="animate-spin" />} {t("danger.delete.action")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function NotebookSettingsForm() {
  const t = useT();
  const router = useRouter();
  const { notebook, role } = useNotebook();
  const canEdit = hasRole(role, "admin");

  const [title, setTitle] = useState(notebook.title);
  const [description, setDescription] = useState(notebook.description ?? "");
  const [emoji, setEmoji] = useState(notebook.emoji ?? DEFAULT_EMOJI);
  const [color, setColor] = useState(notebook.coverColor ?? DEFAULT_COVER_COLOR);
  const [instruction, setInstruction] = useState(notebook.systemInstruction ?? "");
  const [allowWeb, setAllowWeb] = useState(notebook.allowWeb);
  const [visibility, setVisibility] = useState<string>(notebook.defaultArtifactVisibility);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/notebooks/${notebook.id}`, {
        method: "PATCH",
        json: {
          title: title.trim(),
          description: description.trim() || null,
          emoji,
          coverColor: color,
          systemInstruction: instruction.trim() || null,
          allowWeb,
          defaultArtifactVisibility: visibility,
        },
      });
      toast.success(t("common.saved"));
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={!canEdit || busy} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="s-title">{t("notebook.title")}</Label>
            <Input id="s-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-desc">{t("notebook.description")}</Label>
            <Textarea id="s-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
          </div>
          <EmojiColorPicker emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
          <div className="space-y-1.5">
            <Label htmlFor="s-instr">{t("notebook.systemInstruction")}</Label>
            <Textarea
              id="s-instr"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={6}
              maxLength={8000}
              placeholder={t("notebook.systemInstruction.placeholder")}
            />
            <p className="text-xs text-muted-foreground">{t("notebook.systemInstruction.hint")}</p>
            <p className="text-xs text-muted-foreground" data-testid="system-instruction-combine-hint">{t("chat.settings.combineHint")}</p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="s-web">{t("notebook.allowWeb")}</Label>
              <p className="text-xs text-muted-foreground">{t("notebook.allowWeb.hint")}</p>
            </div>
            <Switch id="s-web" checked={allowWeb} onCheckedChange={setAllowWeb} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-vis">{t("notebook.defaultVisibility")}</Label>
            <Select value={visibility} onValueChange={setVisibility}>
              <SelectTrigger id="s-vis" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITIES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`visibility.${v}` as MessageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("notebook.defaultVisibility.hint")}</p>
          </div>
        </fieldset>
        {canEdit ? (
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy && <Loader2 className="animate-spin" />} {t("common.save")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t("notebook.settings.readonly")}</p>
        )}
      </form>
      {role === "owner" && <DangerZone />}
    </div>
  );
}
