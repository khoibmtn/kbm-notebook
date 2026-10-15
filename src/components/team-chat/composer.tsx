"use client";
import { FileUp, FolderOpen, Loader2, Paperclip, Pencil, SendHorizontal, Smile, Sparkles, StickyNote, X } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n-client";
import { MAX_ATTACHMENTS } from "@/lib/validators/team-chat";
import {
  decodeMentions,
  detectMentionQuery,
  encodeMentions,
  filterMentionCandidates,
  type MentionRef,
} from "@/lib/team-chat/mentions";
import { formatBytes } from "@/lib/team-chat/format";
import { toPlainPreview } from "@/lib/team-chat/markdown";
import type { MessageDTO, PersonDTO, RefType } from "@/lib/team-chat/types";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "./emoji-picker";
import { uploadChannelFile } from "./upload";

export type ComposerHandle = {
  addFiles: (files: File[]) => void;
  focus: () => void;
  /** Nạp nội dung tin nhắn vào ô nhập để sửa. */
  beginEdit: (m: MessageDTO) => void;
};

export type SendPayload = {
  content: string;
  mentions: string[];
  replyToId?: string;
  attachmentFileIds: string[];
};

type Upload = {
  localId: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "done" | "error";
  fileId?: string;
  error?: string;
};

type Props = {
  channelId: string;
  /** Người có thể được nhắc tên (không gồm chính mình). */
  members: PersonDTO[];
  replyTo: MessageDTO | null;
  onCancelReply: () => void;
  editing: MessageDTO | null;
  onCancelEdit: () => void;
  onSend: (p: SendPayload) => Promise<void>;
  onEditSubmit: (m: MessageDTO, content: string, mentions: string[]) => Promise<void>;
  onTyping: () => void;
  /** ↑ khi ô nhập trống: sửa tin cuối của mình. */
  onEditLast: () => void;
  onPickRef: (type: RefType) => void;
  placeholder: string;
  ref?: Ref<ComposerHandle>;
};

const MAX_HEIGHT = 200;

export function Composer({
  channelId,
  members,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSend,
  onEditSubmit,
  onTyping,
  onEditLast,
  onPickRef,
  placeholder,
  ref,
}: Props) {
  const t = useT();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<MentionRef[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());

  const candidates = mention ? filterMentionCandidates(members, mention.query) : [];

  const resize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(resize, [text, resize]);

  useEffect(() => {
    if (replyTo) taRef.current?.focus();
  }, [replyTo]);

  // Huỷ upload đang chạy khi rời kênh/unmount.
  useEffect(() => {
    const map = controllers.current;
    return () => {
      map.forEach((c) => c.abort());
      map.clear();
    };
  }, []);

  const uploadsRef = useRef<Upload[]>([]);
  useEffect(() => {
    uploadsRef.current = uploads;
  });

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const room = MAX_ATTACHMENTS - uploadsRef.current.length;
      if (room <= 0 || files.length > room) toast.error(t("team.composer.tooManyFiles", { max: MAX_ATTACHMENTS }));
      const take = files.slice(0, Math.max(0, room));
      if (take.length === 0) return;
      const items: Upload[] = take.map((f) => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        size: f.size,
        progress: 0,
        status: "uploading",
      }));
      uploadsRef.current = [...uploadsRef.current, ...items];
      setUploads((prev) => [...prev, ...items]);
      items.forEach((item, i) => {
        const ctrl = new AbortController();
        controllers.current.set(item.localId, ctrl);
        uploadChannelFile(
          channelId,
          take[i],
          (p) => setUploads((cur) => cur.map((u) => (u.localId === item.localId ? { ...u, progress: p } : u))),
          ctrl.signal,
        )
          .then((res) =>
            setUploads((cur) =>
              cur.map((u) => (u.localId === item.localId ? { ...u, status: "done", progress: 100, fileId: res.fileId } : u)),
            ),
          )
          .catch((err: Error) => {
            if (err.message === "aborted") return;
            setUploads((cur) =>
              cur.map((u) => (u.localId === item.localId ? { ...u, status: "error", error: err.message } : u)),
            );
          })
          .finally(() => controllers.current.delete(item.localId));
      });
    },
    [channelId, t],
  );

  const beginEdit = useCallback((m: MessageDTO) => {
    const { text: plain, picked: p } = decodeMentions(m.content);
    setText(plain);
    setPicked(p);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(plain.length, plain.length);
    });
  }, []);

  useImperativeHandle(ref, () => ({ addFiles, focus: () => taRef.current?.focus(), beginEdit }), [addFiles, beginEdit]);

  function removeUpload(localId: string) {
    controllers.current.get(localId)?.abort();
    controllers.current.delete(localId);
    setUploads((cur) => cur.filter((u) => u.localId !== localId));
  }

  function updateMentionState(value: string, caret: number) {
    const m = detectMentionQuery(value, caret);
    setMention(m);
    if (m) setMentionIndex(0);
  }

  function insertAtCaret(insert: string) {
    const el = taRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      const pos = start + insert.length;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
    });
  }

  function pickMention(p: PersonDTO) {
    if (!mention) return;
    const el = taRef.current;
    const caret = el?.selectionStart ?? text.length;
    const insert = `@${p.name} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    setText(next);
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur : [...cur, { id: p.id, name: p.name }]));
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + insert.length;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
    });
  }

  const uploading = uploads.some((u) => u.status === "uploading");
  const readyFiles = uploads.filter((u) => u.status === "done" && u.fileId);
  const canSend = !sending && !uploading && (text.trim().length > 0 || (!editing && readyFiles.length > 0));

  async function submit() {
    if (!canSend) return;
    // Chỉ mang theo mention còn xuất hiện trong văn bản.
    const content = encodeMentions(text.trim(), picked);
    const mentionIds = picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);
    setSending(true);
    try {
      if (editing) {
        await onEditSubmit(editing, content, mentionIds);
      } else {
        await onSend({
          content,
          mentions: mentionIds,
          replyToId: replyTo?.id,
          attachmentFileIds: readyFiles.map((u) => u.fileId!),
        });
      }
      setText("");
      setPicked([]);
      setUploads([]);
      setMention(null);
    } catch {
      /* bên gọi đã hiện toast; giữ nguyên nội dung để người dùng thử lại */
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (mention && candidates.length > 0 && !composing) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(candidates[mentionIndex] ?? candidates[0]);
        return;
      }
    }
    if (e.key === "Escape") {
      if (mention) setMention(null);
      else if (editing) {
        onCancelEdit();
        setText("");
        setPicked([]);
      } else if (replyTo) onCancelReply();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !composing) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === "ArrowUp" && !composing && text === "" && !editing && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      onEditLast();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  const replyText = replyTo ? toPlainPreview(replyTo.content) || replyTo.attachments[0]?.name || replyTo.refs[0]?.title || "" : "";

  return (
    <div className="shrink-0 border-t bg-background px-3 pb-3 pt-2 sm:px-4" data-testid="composer">
      {(replyTo || editing) && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-primary bg-muted/60 px-3 py-1.5 text-xs" data-testid="composer-context">
          {editing ? <Pencil className="size-4 shrink-0 text-primary" /> : null}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-primary">
              {editing ? t("team.composer.editing") : t("team.composer.replyingTo", { name: replyTo!.sender.name })}
            </div>
            <div className="truncate text-muted-foreground">{editing ? toPlainPreview(editing.content) : replyText}</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => {
              if (editing) {
                onCancelEdit();
                setText("");
                setPicked([]);
              } else onCancelReply();
            }}
            aria-label={t("common.cancel")}
          >
            <X />
          </Button>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" data-testid="composer-uploads">
          {uploads.map((u) => (
            <li key={u.localId} className={cn("flex max-w-56 items-center gap-2 rounded-lg border px-2 py-1 text-xs", u.status === "error" && "border-destructive/50 text-destructive")}>
              {u.status === "uploading" ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <FileUp className="size-3.5 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{u.name}</span>
                <span className="block text-muted-foreground">
                  {u.status === "uploading" ? `${u.progress}%` : u.status === "error" ? (u.error ?? t("common.error")) : formatBytes(u.size)}
                </span>
              </span>
              <button type="button" onClick={() => removeUpload(u.localId)} aria-label={t("team.composer.removeFile")} className="rounded p-0.5 hover:bg-accent">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative flex items-end gap-1.5 rounded-2xl border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
        {mention && candidates.length > 0 && (
          <ul
            role="listbox"
            aria-label={t("team.composer.mentionList")}
            className="absolute bottom-full left-2 z-20 mb-2 w-64 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
            data-testid="mention-popover"
          >
            {candidates.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === mentionIndex}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(p);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === mentionIndex && "bg-accent")}
                >
                  <UserAvatar name={p.name} image={p.image} className="size-6" />
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={t("team.composer.attach")} title={t("team.composer.attach")} disabled={!!editing}>
              <Paperclip />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
              <FileUp /> {t("team.composer.uploadFile")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPickRef("source")}>
              <FolderOpen /> {t("team.composer.shareSource")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPickRef("artifact")}>
              <Sparkles /> {t("team.composer.shareArtifact")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPickRef("note")}>
              <StickyNote /> {t("team.composer.shareNote")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          data-testid="composer-file-input"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder={placeholder}
          aria-label={t("team.composer.label")}
          data-testid="composer-input"
          onChange={(e) => {
            setText(e.target.value);
            updateMentionState(e.target.value, e.target.selectionStart);
            if (e.target.value) onTyping();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
              updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart);
            }
          }}
          onClick={(e) => updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart)}
          onPaste={onPaste}
          className="max-h-[200px] min-h-8 flex-1 resize-none self-center bg-transparent px-1 py-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />

        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={t("team.composer.emoji")} title={t("team.composer.emoji")}>
              <Smile />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-1">
            <EmojiPicker
              onPick={(e) => {
                insertAtCaret(e);
                setEmojiOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        <Button
          size="icon"
          className="size-8 shrink-0 rounded-full"
          disabled={!canSend}
          onClick={() => void submit()}
          aria-label={editing ? t("common.save") : t("team.composer.send")}
          title={editing ? t("common.save") : t("team.composer.send")}
          data-testid="composer-send"
        >
          {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </div>
    </div>
  );
}
