"use client";
import {
  CheckSquare,
  Copy,
  CornerUpLeft,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Smile,
  Trash2,
  Undo2,
} from "lucide-react";
import { memo } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n-client";
import { hasRole, type Role } from "@/lib/roles";
import { formatClock } from "@/lib/team-chat/format";
import { QUICK_REACTIONS } from "@/lib/team-chat/emoji";
import type { AttachmentDTO, MessageDTO, ReadReceiptDTO } from "@/lib/team-chat/types";
import { cn } from "@/lib/utils";
import { AttachmentList } from "./attachments";
import { EmojiPicker } from "./emoji-picker";
import { RefCard } from "./ref-card";
import { RichText } from "./rich-text";

export type MessageActions = {
  reply: (m: MessageDTO) => void;
  react: (m: MessageDTO, emoji: string) => void;
  edit: (m: MessageDTO) => void;
  recall: (m: MessageDTO) => void;
  remove: (m: MessageDTO) => void;
  pin: (m: MessageDTO) => void;
  toSource: (m: MessageDTO, a?: AttachmentDTO) => void;
  startSelect: (m: MessageDTO) => void;
  toggleSelect: (m: MessageDTO) => void;
  copy: (m: MessageDTO) => void;
  jumpTo: (messageId: string) => void;
};

type Props = {
  message: MessageDTO;
  notebookId: string;
  meId: string;
  myRole: Role;
  showSender: boolean;
  firstInGroup: boolean;
  selectMode: boolean;
  selected: boolean;
  highlighted: boolean;
  readers: ReadReceiptDTO[];
  nameOf: (userId: string) => string;
  actions: MessageActions;
};

function MessageItemImpl({
  message: m,
  notebookId,
  meId,
  myRole,
  showSender,
  firstInGroup,
  selectMode,
  selected,
  highlighted,
  readers,
  nameOf,
  actions,
}: Props) {
  const t = useT();
  const own = m.sender.id === meId;
  const recalled = m.recalledAt != null;
  const editor = hasRole(myRole, "editor");
  const canEdit = own && !recalled && (m.kind === "text" || m.kind === "file");
  const canDelete = own || hasRole(myRole, "admin");
  const hasAttachments = m.attachments.length > 0;

  return (
    <div
      id={`msg-${m.id}`}
      data-message-id={m.id}
      data-own={own ? "true" : "false"}
      data-testid="message"
      onClick={selectMode ? () => actions.toggleSelect(m) : undefined}
      className={cn(
        "group/msg relative flex items-end gap-2 px-3 py-[2px] sm:px-4",
        own ? "flex-row-reverse" : "flex-row",
        firstInGroup && "mt-2",
        selectMode && "cursor-pointer hover:bg-accent/40",
        selected && "bg-primary/10",
        highlighted && "bg-amber-500/15 transition-colors",
      )}
    >
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => actions.toggleSelect(m)}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("team.select.message")}
          className="mb-2 size-4 shrink-0 accent-[var(--color-primary)]"
        />
      )}
      {!own && (
        <div className="w-8 shrink-0 self-start">
          {firstInGroup && <UserAvatar name={m.sender.name} image={m.sender.image} className="size-8" />}
        </div>
      )}

      <div className={cn("flex min-w-0 max-w-[min(78%,36rem)] flex-col", own ? "items-end" : "items-start")}>
        {showSender && firstInGroup && !own && (
          <span className="mb-0.5 ml-1 max-w-full truncate text-xs font-medium text-muted-foreground">{m.sender.name}</span>
        )}

        <div className="relative max-w-full">
          <div
            className={cn(
              "max-w-full rounded-2xl px-3 py-1.5 text-[15px] leading-relaxed",
              own ? "bg-primary/15 text-foreground" : "bg-muted text-foreground",
              own ? (firstInGroup ? "rounded-tr-md" : "") : firstInGroup ? "rounded-tl-md" : "",
              recalled && "bg-transparent italic text-muted-foreground ring-1 ring-border",
            )}
          >
            {recalled ? (
              <span data-testid="message-recalled">{own ? t("team.msg.recalledByMe") : t("team.msg.recalled")}</span>
            ) : (
              <>
                {m.replyTo && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!m.replyTo!.unavailable) actions.jumpTo(m.replyTo!.id);
                    }}
                    className="mb-1 block w-full max-w-full rounded-md border-l-2 border-primary bg-background/60 px-2 py-1 text-left text-xs"
                    data-testid="reply-quote"
                  >
                    <span className="block truncate font-medium text-primary">
                      {m.replyTo.senderName ?? t("team.msg.unknownSender")}
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {m.replyTo.unavailable ? t("team.msg.replyUnavailable") : m.replyTo.snippet}
                    </span>
                  </button>
                )}
                {m.content && <RichText content={m.content} meId={meId} />}
                {m.refs.map((r) => (
                  <RefCard key={`${r.type}:${r.id}`} notebookId={notebookId} refItem={r} />
                ))}
                {hasAttachments && (
                  <AttachmentList
                    attachments={m.attachments}
                    canAddToSources={editor}
                    onAddToSources={(a) => actions.toSource(m, a)}
                  />
                )}
              </>
            )}
            <span className="float-right ml-3 mt-0.5 flex items-center gap-1 text-[11px] leading-none text-muted-foreground">
              {m.pinned && <Pin className="size-3" aria-label={t("team.msg.pinned")} />}
              {m.editedAt && !recalled && <span>{t("team.msg.edited")}</span>}
              <time dateTime={m.createdAt}>{formatClock(m.createdAt)}</time>
            </span>
            <span className="clear-both block" />
          </div>

          {!selectMode && !recalled && (
            <div
              className={cn(
                "absolute -top-4 z-10 flex gap-0.5 rounded-lg border bg-popover p-0.5 shadow-sm",
                "opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100 [@media(hover:none)]:opacity-100",
                own ? "right-2" : "left-2",
              )}
              data-testid="message-toolbar"
            >
              <Button variant="ghost" size="icon" className="size-7" onClick={() => actions.reply(m)} aria-label={t("team.msg.reply")} title={t("team.msg.reply")}>
                <CornerUpLeft />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={t("team.msg.react")} title={t("team.msg.react")}>
                    <Smile />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-1" align={own ? "end" : "start"}>
                  <div className="flex gap-0.5 border-b pb-1">
                    {QUICK_REACTIONS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => actions.react(m, e)}
                        className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-accent"
                        aria-label={e}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <EmojiPicker onPick={(e) => actions.react(m, e)} />
                </PopoverContent>
              </Popover>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={t("team.msg.more")} title={t("team.msg.more")}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={own ? "end" : "start"} className="w-56">
                  {canEdit && (
                    <DropdownMenuItem onSelect={() => actions.edit(m)}>
                      <Pencil /> {t("team.msg.edit")}
                    </DropdownMenuItem>
                  )}
                  {m.content && (
                    <DropdownMenuItem onSelect={() => actions.copy(m)}>
                      <Copy /> {t("team.msg.copy")}
                    </DropdownMenuItem>
                  )}
                  {editor && (
                    <DropdownMenuItem onSelect={() => actions.pin(m)}>
                      {m.pinned ? <PinOff /> : <Pin />} {m.pinned ? t("team.msg.unpin") : t("team.msg.pin")}
                    </DropdownMenuItem>
                  )}
                  {editor && hasAttachments && (
                    <DropdownMenuItem onSelect={() => actions.toSource(m)}>
                      <FolderInput /> {t("team.msg.toSource")}
                    </DropdownMenuItem>
                  )}
                  {editor && (
                    <DropdownMenuItem onSelect={() => actions.startSelect(m)}>
                      <CheckSquare /> {t("team.msg.makeNote")}
                    </DropdownMenuItem>
                  )}
                  {(own || canDelete) && <DropdownMenuSeparator />}
                  {own && (
                    <DropdownMenuItem onSelect={() => actions.recall(m)}>
                      <Undo2 /> {t("team.msg.recall")}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(m)}>
                      <Trash2 /> {t("team.msg.delete")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {m.reactions.length > 0 && (
          <div className={cn("mt-0.5 flex flex-wrap gap-1", own ? "justify-end" : "justify-start")} data-testid="message-reactions">
            {m.reactions.map((r) => {
              const mine = r.userIds.includes(meId);
              return (
                <button
                  key={r.emoji}
                  type="button"
                  disabled={selectMode}
                  onClick={() => actions.react(m, r.emoji)}
                  title={r.userIds.map(nameOf).join(", ")}
                  aria-pressed={mine}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors hover:bg-accent",
                    mine ? "border-primary/50 bg-primary/10" : "bg-background",
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="tabular-nums">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {readers.length > 0 && (
          <div className="mt-0.5 flex items-center gap-0.5" data-testid="read-receipts" aria-label={t("team.msg.seenBy", { names: readers.map((r) => r.name).join(", ") })}>
            {readers.slice(0, 5).map((r) => (
              <span key={r.userId} title={r.name}>
                <UserAvatar name={r.name} image={r.image} className="size-4 text-[8px]" />
              </span>
            ))}
            {readers.length > 5 && <span className="ml-0.5 text-[10px] text-muted-foreground">+{readers.length - 5}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
