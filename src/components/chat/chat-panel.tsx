"use client";
import { MessageSquare, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useNotebook } from "@/components/notebook/notebook-context";
import { useConnections, writableBridgeConnections } from "@/components/connectors/use-connections";
import { usePushToNotebookLm } from "@/components/connectors/use-push";
import { SourceViewerSheet } from "@/components/sources/source-viewer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api-client";
import type { ChatMessageDto, ChatScope, Evidence } from "@/lib/chat";
import { buildSuggestedQuestions } from "@/lib/chat-suggestions";
import { stripCitations } from "@/lib/citations";
import type { ConnectionDto } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";
import { hasRole } from "@/lib/roles";
import { parseViewerHighlight, sourceViewerHref, type ViewerHighlight } from "@/lib/sources";
import { isSelectionInitialized, useSourceSelection } from "@/lib/use-source-selection";
import type { NoteDto } from "@/lib/notes";
import { Composer } from "./composer";
import { ConversationMenu } from "./conversation-menu";
import { AssistantMessage, UserBubble, type MessageActions } from "./message-item";
import { useChat } from "./use-chat";
import { useChatSources } from "./use-chat-sources";

const MODEL_KEY = "kbm:chat:model";
const WEB_KEY = (nb: string) => `kbm:chat:web:${nb}`;
const CONN_KEY = (nb: string) => `kbm:chat:connections:${nb}`;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* bỏ qua */
  }
}

/** Sự kiện để Notes tab (cùng cột) biết có ghi chú mới từ chat. */
export const OPEN_NOTES_EVENT = "kbm:open-notes";

type ViewerState = { sourceId: string; highlight: ViewerHighlight } | null;

/**
 * Khung Chat AI trong cột giữa: danh sách cuộc trò chuyện, tin nhắn (markdown + chip trích dẫn),
 * "Nguồn đã dùng", cảnh báo thiếu bằng chứng, ô nhập với phạm vi nguồn/web/model.
 */
export function ChatPanel() {
  const t = useT();
  const { notebook, role } = useNotebook();
  const canWriteNotes = hasRole(role, "editor");
  const chat = useChat(notebook.id);
  const { messages, streaming } = chat;
  const { sources } = useChatSources(notebook.id);
  const selection = useSourceSelection(notebook.id);
  const readySources = useMemo(() => (sources ?? []).filter((s) => s.status === "ready"), [sources]);
  const selectedReady = useMemo(() => readySources.filter((s) => selection.selectedIds.includes(s.id)), [readySources, selection.selectedIds]);

  const [viewer, setViewer] = useState<ViewerState>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [useWeb, setUseWebState] = useState(false);
  const connectionsState = useConnections(notebook.id);
  const { pushNote } = usePushToNotebookLm(notebook.id);
  const [connIds, setConnIdsState] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [model, setModelState] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Cờ "Web" theo sổ tay & model chọn gần nhất (localStorage chỉ là tiện ích, thất bại thì dùng mặc định).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- khôi phục tuỳ chọn đã lưu sau khi hydrate
    setUseWebState(notebook.allowWeb && readLocal(WEB_KEY(notebook.id)) === "1");
  }, [notebook.id, notebook.allowWeb]);
  useEffect(() => {
    try {
      const raw = readLocal(CONN_KEY(notebook.id));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- khôi phục kết nối đã chọn sau khi hydrate
      setConnIdsState(raw ? (JSON.parse(raw) as string[]).filter((x) => typeof x === "string") : []);
    } catch {
      setConnIdsState([]);
    }
  }, [notebook.id]);
  useEffect(() => {
    let cancelled = false;
    api<{ default: string; models: string[] }>("/api/chat/models")
      .then((res) => {
        if (cancelled) return;
        setModels(res.models);
        setDefaultModel(res.default);
        const saved = readLocal(MODEL_KEY);
        setModelState(saved && res.models.includes(saved) ? saved : res.default);
      })
      .catch(() => {
        /* chưa cấu hình AI: ô nhập vẫn dùng được, lỗi sẽ báo khi gửi */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setUseWeb = (v: boolean) => {
    setUseWebState(v);
    writeLocal(WEB_KEY(notebook.id), v ? "1" : "0");
  };
  const toggleConnection = (id: string) => {
    setConnIdsState((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      writeLocal(CONN_KEY(notebook.id), JSON.stringify(next));
      return next;
    });
  };
  const setModel = (m: string) => {
    setModelState(m);
    writeLocal(MODEL_KEY, m);
  };

  const buildScope = useCallback((): ChatScope => {
    const scope: ChatScope = { useWeb: notebook.allowWeb && useWeb };
    // Chưa từng có lựa chọn → để server dùng mọi nguồn sẵn sàng.
    if (isSelectionInitialized(notebook.id)) scope.sourceIds = selectedReady.map((s) => s.id);
    // Chỉ gửi kết nối còn dùng được cho hỏi đáp (danh sách có thể đã đổi từ lần chọn trước).
    const usable = (connectionsState.connections ?? []).filter((c) => c.usable && c.supportsChat && connIds.includes(c.id));
    if (usable.length > 0) scope.connectionIds = usable.map((c) => c.id);
    return scope;
  }, [connectionsState.connections, connIds, notebook.allowWeb, notebook.id, selectedReady, useWeb]);

  const send = useCallback(
    async (text: string) => {
      stickRef.current = true;
      return chat.send(text, { scope: buildScope(), model: model && model !== defaultModel ? model : undefined });
    },
    [buildScope, chat, defaultModel, model],
  );

  const regenerate = useCallback(() => {
    stickRef.current = true;
    void chat.send("", { scope: buildScope(), model: model && model !== defaultModel ? model : undefined, regenerate: true });
  }, [buildScope, chat, defaultModel, model]);

  // Tự cuộn xuống cuối khi có nội dung mới, trừ khi người dùng đã cuộn lên đọc.
  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  const openEvidence = useCallback(
    (_n: number, ev: Evidence) => {
      // Bằng chứng từ kết nối ngoài không có trình xem cục bộ (chip mở popover riêng).
      if (ev.provider !== "local") return;
      const href = sourceViewerHref(notebook.id, ev);
      if (!href || !ev.sourceId) return;
      setViewer({ sourceId: ev.sourceId, highlight: parseViewerHighlight(new URLSearchParams(href.split("?")[1] ?? "")) });
      setViewerOpen(true);
    },
    [notebook.id],
  );

  const base = `/api/notebooks/${notebook.id}`;
  const noteTargets = useMemo(() => writableBridgeConnections(connectionsState.connections), [connectionsState.connections]);
  const pushAnswer = useCallback(
    async (m: ChatMessageDto, connection: ConnectionDto) => {
      const idx = messages.findIndex((x) => x.id === m.id);
      const question = [...messages.slice(0, Math.max(idx, 0))].reverse().find((x) => x.role === "user")?.content ?? "";
      const sourcesLines = (m.sourcesUsed ?? []).map((s) => {
        const external = s.provider === "notebooklm-bridge" || s.provider === "notebooklm-enterprise";
        return `- ${s.title}${!external && s.locators.length ? ` — ${s.locators.join(", ")}` : ""}`;
      });
      const content = `${stripCitations(m.content).trim()}${sourcesLines.length ? `\n\n${t("chat.pushNote.sources")}\n${sourcesLines.join("\n")}` : ""}`;
      await pushNote(connection, question.trim().slice(0, 200) || t("chat.pushNote.defaultTitle"), content);
    },
    [messages, pushNote, t],
  );
  const actions = useMemo<Omit<MessageActions, "onRegenerate">>(
    () => ({
      pushTargets: canWriteNotes ? noteTargets : undefined,
      onPushNote: canWriteNotes ? pushAnswer : undefined,
      onSaveNote: canWriteNotes
        ? async (m: ChatMessageDto) => {
            try {
              const res = await api<{ note: NoteDto }>(`${base}/conversations/${m.conversationId}/messages/${m.id}/to-note`, { method: "POST" });
              toast.success(t("chat.toast.noteSaved"), {
                action: { label: t("chat.toast.openNotes"), onClick: () => window.dispatchEvent(new CustomEvent(OPEN_NOTES_EVENT, { detail: { noteId: res.note.id } })) },
              });
            } catch (e) {
              toast.error(errorMessage(e, t("common.error")));
              throw e;
            }
          }
        : undefined,
      onSaveExchange: async (m: ChatMessageDto) => {
        try {
          await api(`${base}/conversations/${m.conversationId}/messages/${m.id}/save-exchange`, { method: "POST" });
          toast.success(t("chat.toast.exchangeSaved"));
        } catch (e) {
          toast.error(errorMessage(e, t("common.error")));
          throw e;
        }
      },
    }),
    [base, canWriteNotes, noteTargets, pushAnswer, t],
  );

  const suggestions = useMemo(() => buildSuggestedQuestions(selectedReady, t), [selectedReady, t]);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";
  const empty = messages.length === 0 && !streaming;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-panel">
      <ConversationMenu
        conversations={chat.conversations}
        activeId={chat.activeId}
        disabled={chat.isStreaming}
        onSelect={(id) => void chat.select(id)}
        onNew={chat.startNew}
        onRename={chat.rename}
        onDelete={chat.remove}
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          {chat.loadingMessages && (
            <div className="space-y-3" aria-busy>
              <Skeleton className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {empty && !chat.loadingMessages && (
            <div className="flex flex-col items-center gap-4 py-10 text-center" data-testid="chat-empty">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <MessageSquare className="size-6" aria-hidden />
              </span>
              <div className="space-y-1">
                <h2 className="text-base font-semibold">{t("chat.empty.heading")}</h2>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  {sources === null
                    ? t("common.loading")
                    : readySources.length === 0
                      ? t("chat.empty.noSources")
                      : selectedReady.length === 0
                        ? t("chat.empty.noneSelected")
                        : t("chat.empty.ready", { count: selectedReady.length })}
                </p>
              </div>
              {suggestions.length > 0 && (
                <div className="flex w-full max-w-xl flex-col gap-2" data-testid="chat-suggestions">
                  <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkles className="size-3.5" aria-hidden /> {t("chat.suggest.title")}
                  </span>
                  {suggestions.map((q) => (
                    <Button
                      key={q}
                      variant="outline"
                      className="h-auto justify-start whitespace-normal rounded-xl px-3.5 py-2.5 text-left text-sm font-normal"
                      onClick={() => setPrefill({ text: q, nonce: Date.now() })}
                    >
                      {q}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <UserBubble key={m.id} text={m.content} />
            ) : m.role === "assistant" ? (
              <AssistantMessage
                key={m.id}
                message={m}
                evidence={m.citations ?? []}
                onCitationOpen={openEvidence}
                actions={{ ...actions, onRegenerate: m.id === lastAssistantId && lastIsAssistant ? regenerate : undefined }}
                busy={chat.isStreaming}
              />
            ) : null,
          )}

          {streaming && (
            <>
              <AssistantMessage
                message={{ id: "streaming", content: streaming.answer, citations: streaming.evidence, sourcesUsed: null, insufficientEvidence: false, model: null }}
                evidence={streaming.evidence ?? []}
                onCitationOpen={openEvidence}
                streaming={streaming.phase === "answering" && streaming.answer.length > 0}
                searching={streaming.answer.length === 0}
              />
            </>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <Composer
        streaming={chat.isStreaming}
        onSend={send}
        onStop={chat.stop}
        readySources={readySources}
        selectedIds={selection.selectedIds}
        onToggleSource={selection.toggle}
        onSelectAll={selection.setAll}
        allowWeb={notebook.allowWeb}
        useWeb={useWeb}
        onUseWebChange={setUseWeb}
        connections={connectionsState.connections ?? []}
        selectedConnectionIds={connIds}
        onToggleConnection={toggleConnection}
        models={models}
        model={model}
        onModelChange={setModel}
        prefill={prefill}
      />

      {viewer && (
        <SourceViewerSheet
          notebookId={notebook.id}
          sourceId={viewer.sourceId}
          highlight={viewer.highlight}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      )}
    </div>
  );
}
