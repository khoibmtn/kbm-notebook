"use client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { filterMentionCandidates } from "@/lib/team-chat/mentions";
import type { ChannelDTO, PersonDTO } from "@/lib/team-chat/types";

/** Tạo chủ đề mới hoặc đổi tên chủ đề (khi truyền `channel`). */
export function TopicDialog({
  open,
  onOpenChange,
  notebookId,
  channel,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notebookId: string;
  channel?: ChannelDTO | null;
  onDone: (c: ChannelDTO, created: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState(channel?.name ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      if (channel) {
        const res = await api<{ channel: ChannelDTO }>(`/api/notebooks/${notebookId}/channels/${channel.id}`, {
          method: "PATCH",
          json: { name: value },
        });
        onDone(res.channel, false);
      } else {
        const res = await api<{ channel: ChannelDTO }>(`/api/notebooks/${notebookId}/channels`, {
          method: "POST",
          json: { type: "topic", name: value },
        });
        onDone(res.channel, true);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{channel ? t("team.topic.renameTitle") : t("team.topic.create")}</DialogTitle>
            <DialogDescription>{t("team.topic.description")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("team.topic.placeholder")}
            aria-label={t("team.topic.name")}
            data-testid="topic-name"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy && <Loader2 className="animate-spin" />}
              {channel ? t("common.save") : t("team.topic.createAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Chọn một thành viên để bắt đầu tin nhắn riêng (idempotent: trả về DM đã có nếu tồn tại). */
export function NewDmDialog({
  open,
  onOpenChange,
  notebookId,
  members,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notebookId: string;
  /** Thành viên có thể nhắn (không gồm chính mình). */
  members: PersonDTO[];
  onOpened: (c: ChannelDTO) => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = filterMentionCandidates(members, q, 50);

  async function start(p: PersonDTO) {
    setBusyId(p.id);
    try {
      const res = await api<{ channel: ChannelDTO }>(`/api/notebooks/${notebookId}/channels`, {
        method: "POST",
        json: { type: "dm", userId: p.id },
      });
      onOpened(res.channel);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t("common.error")));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("team.dm.new")}</DialogTitle>
          <DialogDescription>{t("team.dm.description")}</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("team.dm.search")} aria-label={t("team.dm.search")} />
        <ul className="max-h-72 space-y-0.5 overflow-y-auto" data-testid="dm-member-list">
          {members.length === 0 ? (
            <li className="p-3 text-center text-sm text-muted-foreground">{t("team.dm.noMembers")}</li>
          ) : list.length === 0 ? (
            <li className="p-3 text-center text-sm text-muted-foreground">{t("team.list.noMatch")}</li>
          ) : (
            list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void start(p)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent disabled:opacity-60"
                >
                  <UserAvatar name={p.name} image={p.image} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                  {busyId === p.id && <Loader2 className="size-4 animate-spin" />}
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
