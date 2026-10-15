"use client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/studio/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import type { GroupSummaryDto } from "@/lib/community";
import { useT } from "@/lib/i18n-client";

export function CreateGroupDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (slug: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { group } = await api<{ group: GroupSummaryDto }>("/api/groups", {
        method: "POST",
        json: { name: name.trim(), description: description.trim() || null, visibility },
      });
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated(group.slug);
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("community.group.create")}</DialogTitle>
            <DialogDescription>{t("community.group.create.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="g-name">{t("community.group.name")}</Label>
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-testid="group-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-desc">{t("community.group.description")}</Label>
            <Textarea id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-vis">{t("community.group.visibility")}</Label>
            <NativeSelect id="g-vis" className="w-full" value={visibility} onChange={(e) => setVisibility(e.target.value as "public" | "private")}>
              <option value="public">{t("community.group.visibility.public")}</option>
              <option value="private">{t("community.group.visibility.private")}</option>
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || name.trim().length < 2} data-testid="group-create-submit">
              {busy && <Loader2 className="animate-spin" />} {t("community.group.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
