"use client";
import { ChevronDown, Loader2, MessageSquare, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/api-client";
import type { ConversationDto } from "@/lib/chat";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

type Props = {
  conversations: ConversationDto[] | null;
  activeId: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

/** Thanh đầu khung chat: tên cuộc trò chuyện hiện tại (mở danh sách), nút "Cuộc trò chuyện mới", đổi tên, xoá. */
export function ConversationMenu({ conversations, activeId, disabled, onSelect, onNew, onRename, onDelete }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<ConversationDto | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ConversationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const active = conversations?.find((c) => c.id === activeId) ?? null;

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setRenaming(null);
      setDeleting(null);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3" data-testid="chat-header">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 min-w-0 max-w-[60%] gap-1.5 px-2" data-testid="conversation-switcher">
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-medium">{active?.title || t("chat.conversation.new")}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-1.5" data-testid="conversation-list">
          {conversations === null ? (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
            </p>
          ) : conversations.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t("chat.conversation.empty")}</p>
          ) : (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {conversations.map((c) => (
                <li key={c.id} className={cn("group flex items-center gap-1 rounded-md pr-1 hover:bg-accent", c.id === activeId && "bg-accent")}>
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-2 py-1.5 text-left"
                    onClick={() => {
                      setOpen(false);
                      onSelect(c.id);
                    }}
                    data-testid="conversation-item"
                  >
                    <span className="block truncate text-sm">{c.title || t("chat.conversation.untitled")}</span>
                    <span className="block text-[11px] text-muted-foreground">{formatRelative(c.updatedAt, locale)}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-60 hover:opacity-100"
                    aria-label={t("chat.conversation.rename")}
                    onClick={() => {
                      setOpen(false);
                      setRenaming(c);
                      setTitle(c.title ?? "");
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-60 hover:opacity-100"
                    aria-label={t("chat.conversation.delete")}
                    onClick={() => {
                      setOpen(false);
                      setDeleting(c);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <div className="ml-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="size-8" onClick={onNew} disabled={disabled} aria-label={t("chat.conversation.new")} data-testid="new-chat">
              <MessageSquarePlus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("chat.conversation.new")}</TooltipContent>
        </Tooltip>
      </div>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("chat.conversation.rename")}</DialogTitle>
            <DialogDescription className="sr-only">{t("chat.conversation.rename")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming && title.trim()) void run(() => onRename(renaming.id, title.trim()), t("chat.conversation.renamed"));
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label={t("chat.conversation.name")} autoFocus />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !title.trim()}>
                {busy && <Loader2 className="animate-spin" />} {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("chat.conversation.delete")}</DialogTitle>
            <DialogDescription>{t("chat.conversation.deleteConfirm", { title: deleting?.title || t("chat.conversation.untitled") })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => deleting && void run(() => onDelete(deleting.id), t("chat.conversation.deleted"))}>
              {busy && <Loader2 className="animate-spin" />} {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
