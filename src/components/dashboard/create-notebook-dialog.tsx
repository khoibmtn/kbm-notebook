"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { DEFAULT_COVER_COLOR, DEFAULT_EMOJI, NOTEBOOK_COVER_COLORS, NOTEBOOK_EMOJIS } from "@/lib/notebook-colors";
import { cn } from "@/lib/utils";

export function EmojiColorPicker({
  emoji,
  color,
  onEmoji,
  onColor,
}: {
  emoji: string;
  color: string;
  onEmoji: (e: string) => void;
  onColor: (c: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t("notebook.emoji")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {NOTEBOOK_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={e}
              aria-pressed={emoji === e}
              onClick={() => onEmoji(e)}
              className={cn(
                "flex size-9 items-center justify-center rounded-lg border text-lg transition-colors hover:bg-accent",
                emoji === e && "border-primary bg-accent",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("notebook.color")}</Label>
        <div className="flex flex-wrap gap-2">
          {NOTEBOOK_COVER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => onColor(c)}
              style={{ backgroundColor: c }}
              className={cn("size-7 rounded-full border-2 border-transparent ring-1 ring-border", color === c && "border-primary")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CreateNotebookDialog({
  open,
  onOpenChange,
  next = "",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Đường dẫn con mở sau khi tạo, vd. `/sources?add=1` (hướng dẫn làm quen). */
  next?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState<string>(DEFAULT_EMOJI);
  const [color, setColor] = useState<string>(DEFAULT_COVER_COLOR);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const { notebook } = await api<{ notebook: { id: string } }>("/api/notebooks", {
        method: "POST",
        json: { title: title.trim(), description: description.trim() || null, emoji, coverColor: color },
      });
      toast.success(t("notebook.created"));
      onOpenChange(false);
      router.push(`/n/${notebook.id}${next}`);
      router.refresh();
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
            <DialogTitle>{t("dashboard.create")}</DialogTitle>
            <DialogDescription>{t("dashboard.create.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nb-title">{t("notebook.title")}</Label>
            <Input id="nb-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nb-desc">{t("notebook.description")}</Label>
            <Textarea id="nb-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
          </div>
          <EmojiColorPicker emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              {t("dashboard.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
