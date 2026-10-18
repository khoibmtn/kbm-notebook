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

/** Lỗi gửi câu hỏi, gắn với đúng tin nhắn người dùng (hiện dấu lỗi + "Thử lại" ngay dưới bong bóng đó). */
export type SendError = {
  /** Id tin nhắn người dùng hiển thị (id thật nếu server đã lưu, `temp-…` nếu chưa). */
  userMessageId: string;
  message: string;
  question: string;
  /** Phạm vi và model đã chốt lúc gửi: thử lại dùng đúng các giá trị này. */
  scope: ChatScope;
  model?: string;
  /** Server đã lưu tin nhắn người dùng (đã nhận `meta`) → thử lại bằng `regenerate`, không tạo tin trùng. */
  saved: boolean;
};

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
  const [sendError, setSendError] = useState<SendError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  const initRef = useRef(false);

  const setActive = useCallback(
    (id: string | null) => {
      activeRef.current = id;
      setActiveIdState(id);
      setSendError(null); // dấu lỗi chỉ thuộc về hội thoại đang mở
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
      setSendError(null); // gửi câu hỏi khác / thử lại: ẩn dấu lỗi cũ ngay
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
      let regenerateTargetId: string | null = null;
      let temp: ChatMessageDto | null = null;
      if (opts.regenerate) {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        lastUserText = lastUser?.content ?? text;
        regenerateTargetId = lastUser?.id ?? null;
        // bỏ câu trả lời cuối khỏi màn hình trong lúc tạo lại
        setMessages((cur) => (cur.length && cur[cur.length - 1].role === "assistant" ? cur.slice(0, -1) : cur));
      } else {
        temp = {
          id: `temp-${Date.now()}`,
          conversationId: convId,
          role: "user",
          content: text,
          citations: null,
          sourcesUsed: null,
          insufficientEvidence: false,
          insufficientReason: null,
          scope: opts.scope,
          model: null,
          usage: null,
          createdAt: new Date().toISOString(),
        };
        const tempMessage = temp;
        // Bản tạm còn sót từ lần lỗi trước (server chưa lưu) bị thay bằng câu hỏi mới này.
        setMessages((cur) => [...cur.filter((m) => !m.id.startsWith("temp-")), tempMessage]);
      }
      setStreaming({ answer: "", evidence: null, phase: "searching" });

      const askText = text || lastUserText;
      const body: AskBody = { question: askText, scope: opts.scope, model: opts.model, regenerate: opts.regenerate };
      let accepted = false;
      let answer = "";
      let finished = false;
      let userMessageId: string | null = null;
      let failure: string | null = null;
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
              userMessageId = ev.userMessageId;
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
              failure = ev.message || t("chat.error.ask");
              break;
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) failure = errorMessage(e, t("chat.error.ask"));
      } finally {
        abortRef.current = null;
        setStreaming(null);
      }

      // Đồng bộ với server (id thật, câu trả lời đã hậu kiểm, tin nhắn người dùng).
      let loaded: ChatMessageDto[] | null = null;
      if (accepted || finished) {
        loaded = await loadMessages(convId);
        void reloadConversations();
      } else if (!opts.regenerate) {
        // Có lỗi: giữ câu hỏi tạm để gắn dấu lỗi + "Thử lại" ngay dưới nó. Bị người dùng dừng: gỡ câu hỏi tạm.
        if (!failure) setMessages((cur) => cur.filter((m) => !m.id.startsWith("temp-")));
      } else {
        loaded = await loadMessages(convId);
      }

      if (failure) {
        // Server đã lưu tin nhắn người dùng? (đã nhận `meta`; hoặc mất kết nối trước `meta` nhưng hội thoại đã kết thúc bằng đúng câu hỏi này)
        let savedId = userMessageId;
        if (!savedId && regenerateTargetId) savedId = regenerateTargetId;
        const last = loaded?.[loaded.length - 1];
        if (!savedId && accepted && last?.role === "user" && last.content === text) savedId = last.id;
        let anchorId: string | null = null;
        if (savedId) {
          // Id thật có trong danh sách vừa tải; nếu không tải được thì bản tạm vẫn đang hiển thị.
          anchorId = loaded?.some((m) => m.id === savedId) ? savedId : (temp?.id ?? savedId);
        } else if (temp) {
          anchorId = temp.id;
          const tempMessage = temp;
          // Đã nhận phản hồi nhưng server không lưu câu hỏi: bản tải lại không có câu hỏi → đặt lại bản tạm.
          if (accepted) setMessages((cur) => (cur.some((m) => m.id === tempMessage.id) ? cur : [...cur, tempMessage]));
        }
        if (anchorId) {
          setSendError({ userMessageId: anchorId, message: failure, question: askText, scope: opts.scope, model: opts.model, saved: savedId !== null });
        } else {
          toast.error(failure); // không có tin nhắn nào để gắn dấu lỗi
        }
      }
      return accepted;
    },
    [create, loadMessages, messages, notebookId, reloadConversations, streaming, t],
  );

  /** Gửi lại đúng câu hỏi đã lỗi với phạm vi/model đã chốt lúc gửi, không tạo tin nhắn người dùng trùng. */
  const retry = useCallback(async (): Promise<boolean> => {
    const err = sendError;
    if (!err || streaming) return false;
    if (err.saved) return send("", { scope: err.scope, model: err.model, regenerate: true });
    // Server chưa lưu: bỏ bản tạm cũ rồi gửi như câu hỏi mới (send thêm đúng một bản tạm).
    setMessages((cur) => cur.filter((m) => m.id !== err.userMessageId));
    return send(err.question, { scope: err.scope, model: err.model });
  }, [send, sendError, streaming]);

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
    sendError,
    retry,
  };
}
