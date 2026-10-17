"use client";
import { BookmarkPlus, Check, CloudUpload, Copy, ExternalLink, FileText, Globe, Loader2, NotebookPen, Plug, RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChatMessageDto, Evidence, SourceUsed } from "@/lib/chat";
import type { ConnectionDto } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { evidenceLocatorLabel, MarkdownWithCitations } from "./markdown-with-citations";

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed">{text}</div>
    </div>
  );
}

/** Khối "Nguồn đã dùng": các nguồn thực sự được trích dẫn, bấm để mở đúng đoạn. */
export function SourcesUsedBlock({
  sourcesUsed,
  citations,
  onOpen,
}: {
  sourcesUsed: SourceUsed[];
  citations: Evidence[];
  onOpen: (n: number, evidence: Evidence) => void;
}) {
  const t = useT();
  if (sourcesUsed.length === 0) return null;
  return (
    <section aria-label={t("chat.sourcesUsed")} className="mt-3 rounded-lg border bg-muted/30 p-2.5" data-testid="sources-used">
      <h4 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{t("chat.sourcesUsed")}</h4>
      <ul className="space-y-0.5">
        {sourcesUsed.map((s) => {
          const first = citations[s.numbers[0] - 1];
          const where = [...new Set(s.numbers.map((n) => citations[n - 1]).filter(Boolean).map((ev) => evidenceLocatorLabel(ev, t)).filter(Boolean))];
          const locators = where.length > 0 ? where : s.locators;
          const isWeb = s.provider === "web";
          const isExternal = s.provider === "notebooklm-bridge" || s.provider === "notebooklm-enterprise";
          if (isExternal) {
            // Nguồn ngoài: không có trình xem cục bộ → liên kết sang notebook NotebookLM (nếu có).
            const href = first?.externalUrl ?? s.url;
            const body = (
              <>
                <Plug className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{["NotebookLM", ...locators.filter((l) => l !== "NotebookLM")].join(" · ")}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{s.numbers.map((n) => `[${n}]`).join("")}</span>
                {href && <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              </>
            );
            return (
              <li key={s.key}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent" data-testid="source-used" data-provider={s.provider}>
                    {body}
                  </a>
                ) : (
                  <div className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm" data-testid="source-used" data-provider={s.provider}>
                    {body}
                  </div>
                )}
              </li>
            );
          }
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={!first}
                onClick={() => first && onOpen(s.numbers[0], first)}
                className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent disabled:cursor-default"
                data-testid="source-used"
              >
                {isWeb ? <Globe className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden /> : <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.title}</span>
                  {locators.length > 0 && <span className="block truncate text-xs text-muted-foreground">{locators.join(" · ")}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{s.numbers.map((n) => `[${n}]`).join("")}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type MessageActions = {
  /** Kết nối NotebookLM Bridge dùng được để ghi câu trả lời thành ghi chú ngoài. */
  pushTargets?: ConnectionDto[];
  onPushNote?: (m: ChatMessageDto, connection: ConnectionDto) => Promise<void>;
  onSaveNote?: (m: ChatMessageDto) => Promise<void>;
  onSaveExchange: (m: ChatMessageDto) => Promise<void>;
  onRegenerate?: () => void;
};

type AssistantProps = {
  message: Pick<ChatMessageDto, "id" | "content" | "citations" | "sourcesUsed" | "insufficientEvidence" | "model"> & Partial<ChatMessageDto>;
  evidence: Evidence[];
  onCitationOpen: (n: number, evidence: Evidence) => void;
  /** Đang nhận stream: chưa có hành động, hiện con trỏ. */
  streaming?: boolean;
  /** "Đang tìm trong nguồn…" trước khi có chữ đầu tiên. */
  searching?: boolean;
  actions?: MessageActions;
  busy?: boolean;
};

function ActionButton({ icon: Icon, label, onClick, done, pending, testId }: { icon: typeof Copy; label: string; onClick: () => void; done?: boolean; pending?: boolean; testId: string }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={onClick} disabled={pending} data-testid={testId}>
      {pending ? <Loader2 className="animate-spin" /> : done ? <Check className="text-emerald-600" /> : <Icon />}
      {label}
    </Button>
  );
}

/** "Lưu vào NotebookLM": một đích → bấm là gửi; nhiều đích → chọn từ menu; không có đích → vô hiệu hoá kèm lý do. */
function PushAnswerAction({ targets, onPush, pending, done }: { targets: ConnectionDto[]; onPush: (c: ConnectionDto) => void; pending: boolean; done: boolean }) {
  const t = useT();
  const label = t("connectors.push.note");
  const Icon = pending ? Loader2 : done ? Check : CloudUpload;
  const cls = "h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground";
  const icon = <Icon className={pending ? "animate-spin" : done ? "text-emerald-600" : undefined} />;
  if (targets.length === 0) {
    return (
      <Button variant="ghost" size="sm" className={cls} disabled title={t("connectors.push.none")} data-testid="action-push-note">
        {icon} {label}
      </Button>
    );
  }
  if (targets.length === 1) {
    return (
      <Button variant="ghost" size="sm" className={cls} disabled={pending} onClick={() => onPush(targets[0])} data-testid="action-push-note">
        {icon} {label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={cls} disabled={pending} data-testid="action-push-note">
          {icon} {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {targets.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => onPush(c)} data-testid="push-target">
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AssistantMessage({ message, evidence, onCitationOpen, streaming, searching, actions, busy }: AssistantProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [exchangeSaved, setExchangeSaved] = useState(false);
  const [pending, setPending] = useState<"note" | "exchange" | "push" | null>(null);
  const [pushed, setPushed] = useState(false);
  const citations = useMemo(() => message.citations ?? evidence, [message.citations, evidence]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard bị chặn */
    }
  }

  async function run(kind: "note" | "exchange" | "push", fn: (() => Promise<void>) | undefined, done: () => void) {
    if (!fn) return;
    setPending(kind);
    try {
      await fn();
      done();
    } catch {
      /* thông báo lỗi do bên gọi hiển thị */
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="group" data-testid="assistant-message" data-message-id={message.id}>
      {message.insufficientEvidence && !streaming && (
        <div role="status" className="mb-2 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="insufficient-banner" data-reason={message.insufficientReason ?? undefined}>
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{message.insufficientReason === "no_citations" ? t("security.chat.noCitations") : t("chat.insufficient")}</span>
        </div>
      )}
      {searching && !message.content ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="chat-searching">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t("chat.searching")}
        </p>
      ) : (
        <MarkdownWithCitations content={message.content} evidence={citations} onCitationOpen={onCitationOpen} streaming={streaming} />
      )}
      {!streaming && <SourcesUsedBlock sourcesUsed={message.sourcesUsed ?? []} citations={citations} onOpen={onCitationOpen} />}
      {!streaming && actions && (
        <div className={cn("mt-2 -ml-2 flex flex-wrap items-center gap-0.5")} role="group" aria-label={t("chat.actions")}>
          {actions.onSaveNote && (
            <ActionButton icon={NotebookPen} label={t("chat.action.saveNote")} onClick={() => void run("note", () => actions.onSaveNote!(message as ChatMessageDto), () => setNoteSaved(true))} done={noteSaved} pending={pending === "note"} testId="action-save-note" />
          )}
          {actions.onPushNote && (
            <PushAnswerAction
              targets={actions.pushTargets ?? []}
              pending={pending === "push"}
              done={pushed}
              onPush={(c) => void run("push", () => actions.onPushNote!(message as ChatMessageDto, c), () => setPushed(true))}
            />
          )}
          <ActionButton icon={BookmarkPlus} label={t("chat.action.saveExchange")} onClick={() => void run("exchange", () => actions.onSaveExchange(message as ChatMessageDto), () => setExchangeSaved(true))} done={exchangeSaved} pending={pending === "exchange"} testId="action-save-exchange" />
          <ActionButton icon={Copy} label={copied ? t("chat.action.copied") : t("chat.action.copy")} onClick={() => void copy()} done={copied} testId="action-copy" />
          {actions.onRegenerate && (
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={actions.onRegenerate} disabled={busy} data-testid="action-regenerate">
              <RefreshCw /> {t("chat.action.regenerate")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
