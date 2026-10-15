"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { askStream, type AskBody } from "@/lib/chat-stream";
import type { ChatMessageDto, ChatScope, ConversationDto, Evidence } from "@/lib/chat";
import { useT } from "@/lib/i18n-client";

export type StreamingState = {
  answer: string;
  evidence: Evidence[] | null;
  phase: "searching" | "answering";
};

const ACTIVE_KEY = (nb: string) => `kbm:chat:active:${nb}`;

function readActive(nb: string): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY(nb));
  } catch {
    return null;
  }
}
function writeActive(nb: string, id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY(nb), id);
    else localStorage.removeItem(ACTIVE_KEY(nb));
  } catch {
    /* bỏ qua */
  }
}

export type SendOptions = { scope: ChatScope; model?: string; regenerate?: boolean };

/**
 * Trạng thái Chat AI của một sổ tay: danh sách cuộc trò chuyện, tin nhắn đang mở và luồng trả lời (SSE).
 */
export function useChat(notebookId: string) {
  const t = useT();
  const base = `/api/notebooks/${notebookId}/conversations`;
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  const initRef = useRef(false);

  const setActive = useCallback(
    (id: string | null) => {
      activeRef.current = id;
      setActiveIdState(id);
      writeActive(notebookId, id);
    },
    [notebookId],
  );

  const reloadConversations = useCallback(async () => {
    try {
      const res = await api<{ conversations: ConversationDto[] }>(base);
      setConversations(res.conversations);
      return res.conversations;
    } catch (e) {
      toast.error(errorMessage(e, t("chat.error.load")));
      return null;
    }
  }, [base, t]);

  const loadMessages = useCallback(
    async (id: string) => {
      try {
        const res = await api<{ messages: ChatMessageDto[] }>(`${base}/${id}`);
        if (activeRef.current === id) setMessages(res.messages);
        return res.messages;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 404) {
          if (activeRef.current === id) {
            setActive(null);
            setMessages([]);
          }
        } else toast.error(errorMessage(e, t("chat.error.load")));
        return null;
      }
    },
    [base, setActive, t],
  );

  // Khởi tạo: tải danh sách, mở cuộc trò chuyện đã dùng gần nhất (hoặc mới nhất).
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      const list = await reloadConversations();
      if (!list) return;
      const remembered = readActive(notebookId);
      const pick = list.find((c) => c.id === remembered)?.id ?? list[0]?.id ?? null;
      if (pick) {
        activeRef.current = pick;
        setActiveIdState(pick);
        setLoadingMessages(true);
        await loadMessages(pick);
        setLoadingMessages(false);
      }
    })();
  }, [notebookId, reloadConversations, loadMessages]);

  const select = useCallback(
    async (id: string) => {
      if (streaming) return;
      setActive(id);
      setMessages([]);
      setLoadingMessages(true);
      await loadMessages(id);
      setLoadingMessages(false);
    },
    [loadMessages, setActive, streaming],
  );

  const startNew = useCallback(() => {
    if (streaming) return;
    setActive(null);
    setMessages([]);
  }, [setActive, streaming]);

  const create = useCallback(async (): Promise<ConversationDto> => {
    const res = await api<{ conversation: ConversationDto }>(base, { method: "POST", json: {} });
    setConversations((cur) => [res.conversation, ...(cur ?? [])]);
    setActive(res.conversation.id);
    return res.conversation;
  }, [base, setActive]);

  const rename = useCallback(
    async (id: string, title: string) => {
      await api(`${base}/${id}`, { method: "PATCH", json: { title } });
      await reloadConversations();
    },
    [base, reloadConversations],
  );

  const remove = useCallback(
    async (id: string) => {
      await api(`${base}/${id}`, { method: "DELETE" });
      const list = await reloadConversations();
      if (activeRef.current === id) {
        setActive(null);
        setMessages([]);
        const next = list?.[0]?.id;
        if (next) await select(next);
      }
    },
    [base, reloadConversations, select, setActive],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Gửi câu hỏi và hiển thị câu trả lời theo luồng. Trả `true` nếu server đã nhận câu hỏi. */
  const send = useCallback(
    async (question: string, opts: SendOptions): Promise<boolean> => {
      if (streaming) return false;
      const text = question.trim();
      if (!text && !opts.regenerate) return false;
      let conversationId = activeRef.current;
      try {
        if (!conversationId) conversationId = (await create()).id;
      } catch (e) {
        toast.error(errorMessage(e, t("chat.error.create")));
        return false;
      }
      const convId = conversationId;
      const ac = new AbortController();
      abortRef.current = ac;

      // Hiển thị ngay: câu hỏi người dùng (trừ khi tạo lại) + trạng thái đang tìm nguồn.
      let lastUserText = text;
      if (opts.regenerate) {
        lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? text;
        // bỏ câu trả lời cuối khỏi màn hình trong lúc tạo lại
        setMessages((cur) => (cur.length && cur[cur.length - 1].role === "assistant" ? cur.slice(0, -1) : cur));
      } else {
        const temp: ChatMessageDto = {
          id: `temp-${Date.now()}`,
          conversationId: convId,
          role: "user",
          content: text,
          citations: null,
          sourcesUsed: null,
          insufficientEvidence: false,
          scope: opts.scope,
          model: null,
          usage: null,
          createdAt: new Date().toISOString(),
        };
        setMessages((cur) => [...cur, temp]);
      }
      setStreaming({ answer: "", evidence: null, phase: "searching" });

      const body: AskBody = { question: text || lastUserText, scope: opts.scope, model: opts.model, regenerate: opts.regenerate };
      let accepted = false;
      let answer = "";
      let finished = false;
      try {
        const events = await askStream(notebookId, convId, body, ac.signal);
        accepted = true;
        for await (const ev of events) {
          switch (ev.type) {
            case "scope_adjusted":
              if (ev.reason === "connection_error") toast.error(t("chat.scope.connectionError", { detail: ev.detail ?? "" }));
              else toast.message(t(ev.reason === "web_not_allowed" ? "chat.scope.webNotAllowed" : "chat.scope.connectionsUnavailable"));
              break;
            case "meta":
              setStreaming((s) => (s ? { ...s, evidence: ev.evidence, phase: "answering" } : s));
              break;
            case "delta":
              answer += ev.text;
              setStreaming((s) => (s ? { ...s, answer, phase: "answering" } : s));
              break;
            case "done":
              finished = true;
              break;
            case "error":
              toast.error(ev.message || t("chat.error.ask"));
              break;
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          toast.error(errorMessage(e, t("chat.error.ask")));
        }
      } finally {
        abortRef.current = null;
        setStreaming(null);
      }
      // Đồng bộ với server (id thật, câu trả lời đã hậu kiểm, tin nhắn người dùng).
      if (accepted || finished) {
        await loadMessages(convId);
        void reloadConversations();
      } else if (!opts.regenerate) {
        // Server từ chối trước khi lưu (412/429/…): gỡ câu hỏi tạm.
        setMessages((cur) => cur.filter((m) => !m.id.startsWith("temp-")));
      } else {
        await loadMessages(convId);
      }
      return accepted;
    },
    [create, loadMessages, messages, notebookId, reloadConversations, streaming, t],
  );

  const active = useMemo(() => conversations?.find((c) => c.id === activeId) ?? null, [conversations, activeId]);

  return {
    conversations,
    active,
    activeId,
    messages,
    loadingMessages,
    streaming,
    isStreaming: streaming !== null,
    select,
    startNew,
    rename,
    remove,
    send,
    stop,
  };
}
