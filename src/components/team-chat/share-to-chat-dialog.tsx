"use client";
import { Hash, Loader2, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { useNotebook } from "@/components/notebook/notebook-context";
import { useT } from "@/lib/i18n-client";
import type { ChannelDTO, MessageDTO, RefType } from "@/lib/team-chat/types";
import { cn } from "@/lib/utils";
import { channelTitle, dmPeer, sortChannels } from "./channel-utils";

export type ShareItem = { type: RefType; id: string; title?: string };

/**
 * Hộp thoại "Chia sẻ vào chat": chọn kênh (general, chủ đề hoặc DM của mình) rồi đăng một thẻ
 * artifact / nguồn / note, kèm lời nhắn tuỳ chọn. Các mô-đun khác chỉ cần:
 *
 *   <ShareToChatDialog open={open} onOpenChange={setOpen} notebookId={id} item={{ type: "artifact", id, title }} />
 *
 * Server kiểm tra quyền xem mục được chia sẻ và từ chối mục riêng tư.
 */
export function ShareToChatDialog({
  open,
  onOpenChange,
  notebookId,
  item,
  defaultChannelId,
  onShared,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notebookId: string;
  item: ShareItem;
  defaultChannelId?: string;
  onShared?: (channel: ChannelDTO, message: MessageDTO) => void;
}) {
  const t = useT();
  const meId = useNotebook().user.id;
  const [channels, setChannels] = useState<ChannelDTO[] | null>(null);
  const [selected, setSelected] = useState<string | null>(defaultChannelId ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ channels: ChannelDTO[] }>(`/api/notebooks/${notebookId}/channels`)
      .then((res) => {
        if (cancelled) return;
        const sorted = sortChannels(res.channels);
        setChannels(sorted);
        setLoadError(null);
        setSelected((cur) => cur ?? defaultChannelId ?? sorted.find((c) => c.type === "general")?.id ?? sorted[0]?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e, t("common.error")));
      });
    return () => {
      cancelled = true;
    };
  }, [open, notebookId, defaultChannelId, t]);

  async function share() {
    const channel = channels?.find((c) => c.id === selected);
    if (!channel || busy) return;
    setBusy(true);
    try {
      const refs = item.type === "artifact" ? { artifactId: item.id } : item.type === "source" ? { sourceId: item.id } : { noteId: item.id };
      const res = await api<{ message: MessageDTO }>(`/api/channels/${channel.id}/messages`, {
        method: "POST",
        json: { kind: `${item.type}_ref`, content: note.trim(), refs },
      });
      toast.success(t("team.share.done", { channel: channelTitle(channel, meId, t) }));
      onShared?.(channel, res.message);
      onOpenChange(false);
      setNote("");
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("team.share.title")}</DialogTitle>
          <DialogDescription>{item.title ? t("team.share.description", { title: item.title }) : t("team.share.descriptionNoTitle")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border p-1" role="radiogroup" aria-label={t("team.share.pickChannel")} data-testid="share-channel-list">
          {loadError ? (
            <p className="p-3 text-sm text-destructive">{loadError}</p>
          ) : !channels ? (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
            </p>
          ) : (
            channels.map((c) => {
              const peer = dmPeer(c, meId);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={selected === c.id}
                  onClick={() => setSelected(c.id)}
                  className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", selected === c.id && "bg-accent font-medium")}
                >
                  {peer ? (
                    <UserAvatar name={peer.name} image={peer.image} className="size-6" />
                  ) : c.type === "general" ? (
                    <UsersRound className="size-4 text-muted-foreground" />
                  ) : (
                    <Hash className="size-4 text-muted-foreground" />
                  )}
                  <span className="truncate">{channelTitle(c, meId, t)}</span>
                </button>
              );
            })
          )}
        </div>

        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("team.share.notePlaceholder")} aria-label={t("team.share.notePlaceholder")} />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void share()} disabled={!selected || busy}>
            {busy && <Loader2 className="animate-spin" />} {t("team.share.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
