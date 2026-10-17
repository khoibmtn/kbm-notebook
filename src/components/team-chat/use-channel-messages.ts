"use client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "@/lib/api-client";
import { upsertMessage } from "@/lib/team-chat/grouping";
import { useRealtime, useRealtimeEvent } from "@/lib/realtime";
import type {
  MessageDeleteEvent,
  MessageDTO,
  MessageNewEvent,
  MessagePinEvent,
  MessageReactionEvent,
  MessagesPageDTO,
  MessageUpdateEvent,
  ReactionDTO,
  ReadEvent,
  ReadReceiptDTO,
} from "@/lib/team-chat/types";

export const PAGE_SIZE = 50;

type State = {
  status: "loading" | "ready" | "error";
  /** Tăng dần theo thời gian. */
  messages: MessageDTO[];
  pinned: MessageDTO[];
  reads: ReadReceiptDTO[];
  hasOlder: boolean;
  hasNewer: boolean;
  loadingOlder: boolean;
  loadingNewer: boolean;
  /** Số tin mới đến khi đang xem vùng lịch sử (chưa nạp vào danh sách). */
  missed: number;
  error: string | null;
};

type Action =
  | { type: "loading" }
  | { type: "error"; error: string }
  | { type: "loaded"; page: MessagesPageDTO; keepMeta?: boolean }
  | { type: "olderStart" }
  | { type: "olderDone"; page: MessagesPageDTO }
  | { type: "newerStart" }
  | { type: "newerDone"; page: MessagesPageDTO }
  | { type: "fetchEnd" }
  | { type: "upsert"; message: MessageDTO }
  | { type: "replace"; message: MessageDTO }
  | { type: "remove"; id: string }
  | { type: "reactions"; id: string; reactions: ReactionDTO[] }
  | { type: "pin"; message: MessageDTO }
  | { type: "read"; userId: string; lastReadAt: string }
  | { type: "missed" };

const initial: State = {
  status: "loading",
  messages: [],
  pinned: [],
  reads: [],
  hasOlder: false,
  hasNewer: false,
  loadingOlder: false,
  loadingNewer: false,
  missed: 0,
  error: null,
};

const asc = (list: MessageDTO[]) => [...list].reverse();

/** Cập nhật mọi tin trả lời tới `id` khi tin gốc bị xoá/thu hồi. */
function markReplyUnavailable(list: MessageDTO[], id: string): MessageDTO[] {
  return list.map((m) =>
    m.replyTo?.id === id ? { ...m, replyTo: { ...m.replyTo, snippet: "", unavailable: true } } : m,
  );
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "loading":
      return { ...s, status: "loading", error: null };
    case "error":
      return { ...s, status: "error", error: a.error };
    case "loaded":
      return {
        ...s,
        status: "ready",
        error: null,
        messages: asc(a.page.messages),
        hasOlder: a.page.hasMore,
        hasNewer: a.page.hasNewer,
        pinned: a.page.pinned ?? s.pinned,
        reads: a.page.reads ?? s.reads,
        missed: a.page.hasNewer ? s.missed : 0,
        loadingOlder: false,
        loadingNewer: false,
      };
    case "olderStart":
      return { ...s, loadingOlder: true };
    case "olderDone": {
      const ids = new Set(s.messages.map((m) => m.id));
      return {
        ...s,
        loadingOlder: false,
        hasOlder: a.page.hasMore,
        messages: [...asc(a.page.messages).filter((m) => !ids.has(m.id)), ...s.messages],
      };
    }
    case "newerStart":
      return { ...s, loadingNewer: true };
    case "newerDone": {
      const ids = new Set(s.messages.map((m) => m.id));
      return {
        ...s,
        loadingNewer: false,
        hasNewer: a.page.hasNewer,
        missed: a.page.hasNewer ? s.missed : 0,
        messages: [...s.messages, ...asc(a.page.messages).filter((m) => !ids.has(m.id))],
      };
    }
    case "fetchEnd":
      return { ...s, loadingOlder: false, loadingNewer: false };
    case "upsert":
      return { ...s, messages: upsertMessage(s.messages, a.message) };
    case "replace": {
      const has = s.messages.some((m) => m.id === a.message.id);
      let messages = has ? s.messages.map((m) => (m.id === a.message.id ? a.message : m)) : s.messages;
      let pinned = s.pinned.map((m) => (m.id === a.message.id ? a.message : m));
      if (a.message.recalledAt) {
        messages = markReplyUnavailable(messages, a.message.id);
        pinned = pinned.filter((m) => m.id !== a.message.id);
      }
      return { ...s, messages, pinned };
    }
    case "remove":
      return {
        ...s,
        messages: markReplyUnavailable(
          s.messages.filter((m) => m.id !== a.id),
          a.id,
        ),
        pinned: s.pinned.filter((m) => m.id !== a.id),
      };
    case "reactions":
      return {
        ...s,
        messages: s.messages.map((m) => (m.id === a.id ? { ...m, reactions: a.reactions } : m)),
        pinned: s.pinned.map((m) => (m.id === a.id ? { ...m, reactions: a.reactions } : m)),
      };
    case "pin": {
      const messages = s.messages.map((m) => (m.id === a.message.id ? { ...m, pinned: a.message.pinned } : m));
      const without = s.pinned.filter((m) => m.id !== a.message.id);
      const pinned = a.message.pinned
        ? [a.message, ...without].sort((x, y) => y.createdAt.localeCompare(x.createdAt))
        : without;
      return { ...s, messages, pinned };
    }
    case "read": {
      const others = s.reads.filter((r) => r.userId !== a.userId);
      const prev = s.reads.find((r) => r.userId === a.userId);
      if (prev && prev.lastReadAt >= a.lastReadAt) return s;
      // Thông tin người đọc (tên/ảnh) lấy từ bản ghi cũ hoặc từ tin nhắn họ từng gửi.
      const known =
        prev ??
        (() => {
          const m = s.messages.find((x) => x.sender.id === a.userId);
          return m ? { userId: a.userId, name: m.sender.name, image: m.sender.image, lastReadAt: a.lastReadAt } : null;
        })();
      return known ? { ...s, reads: [...others, { ...known, lastReadAt: a.lastReadAt }] } : s;
    }
    case "missed":
      return { ...s, missed: s.missed + 1 };
    default:
      return s;
  }
}

/**
 * Dữ liệu tin nhắn của một kênh + đồng bộ realtime. Gắn `key={channelId}` ở component cha để reset khi đổi kênh.
 * `readers` (người khác đã đọc) được hợp nhất khi sự kiện `read` đến.
 */
export function useChannelMessages(channelId: string, meId: string) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const gen = useRef(0);
  const { connected } = useRealtime();

  const loadLatest = useCallback(async () => {
    const my = ++gen.current;
    try {
      const page = await api<MessagesPageDTO>(`/api/channels/${channelId}/messages?limit=${PAGE_SIZE}`);
      if (my === gen.current) dispatch({ type: "loaded", page });
    } catch (e) {
      if (my === gen.current) dispatch({ type: "error", error: e instanceof Error ? e.message : "error" });
    }
  }, [channelId]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  // Kết nối lại sau khi mất kết nối → nạp lại tin mới nhất để không sót.
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current && !stateRef.current.hasNewer) void loadLatest();
    wasConnected.current = connected;
  }, [connected, loadLatest]);

  const loadOlder = useCallback(async () => {
    const s = stateRef.current;
    if (s.loadingOlder || !s.hasOlder || s.messages.length === 0) return;
    dispatch({ type: "olderStart" });
    const my = gen.current;
    try {
      const page = await api<MessagesPageDTO>(
        `/api/channels/${channelId}/messages?before=${s.messages[0].id}&limit=${PAGE_SIZE}`,
      );
      if (my === gen.current) dispatch({ type: "olderDone", page });
    } catch {
      dispatch({ type: "fetchEnd" });
    }
  }, [channelId]);

  const loadNewer = useCallback(async () => {
    const s = stateRef.current;
    if (s.loadingNewer || !s.hasNewer || s.messages.length === 0) return;
    dispatch({ type: "newerStart" });
    const my = gen.current;
    try {
      const page = await api<MessagesPageDTO>(
        `/api/channels/${channelId}/messages?after=${s.messages[s.messages.length - 1].id}&limit=${PAGE_SIZE}`,
      );
      if (my === gen.current) dispatch({ type: "newerDone", page });
    } catch {
      dispatch({ type: "fetchEnd" });
    }
  }, [channelId]);

  /** Nạp cửa sổ quanh một tin nhắn (nếu chưa có trong danh sách). Trả true nếu tin có trong danh sách sau đó. */
  const jumpTo = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (stateRef.current.messages.some((m) => m.id === messageId)) return true;
      const my = ++gen.current;
      try {
        const page = await api<MessagesPageDTO>(`/api/channels/${channelId}/messages?around=${messageId}&limit=${PAGE_SIZE}`);
        if (my !== gen.current) return false;
        dispatch({ type: "loaded", page });
        return page.messages.some((m) => m.id === messageId);
      } catch {
        return false;
      }
    },
    [channelId],
  );

  /* ------------------------- sự kiện realtime ------------------------- */
  useRealtimeEvent<MessageNewEvent>("message:new", (e) => {
    if (e.channelId !== channelId) return;
    if (stateRef.current.hasNewer) {
      dispatch({ type: "missed" });
      return;
    }
    dispatch({ type: "upsert", message: e.message });
  });
  useRealtimeEvent<MessageUpdateEvent>("message:edit", (e) => {
    if (e.channelId === channelId) dispatch({ type: "replace", message: e.message });
  });
  useRealtimeEvent<MessageUpdateEvent>("message:recall", (e) => {
    if (e.channelId === channelId) dispatch({ type: "replace", message: e.message });
  });
  useRealtimeEvent<MessageDeleteEvent>("message:delete", (e) => {
    if (e.channelId === channelId) dispatch({ type: "remove", id: e.messageId });
  });
  useRealtimeEvent<MessageReactionEvent>("message:reaction", (e) => {
    if (e.channelId === channelId) dispatch({ type: "reactions", id: e.messageId, reactions: e.reactions });
  });
  useRealtimeEvent<MessagePinEvent>("message:pin", (e) => {
    if (e.channelId === channelId) dispatch({ type: "pin", message: e.message });
  });
  useRealtimeEvent<ReadEvent>("read", (e) => {
    if (e.channelId === channelId && e.userId !== meId) dispatch({ type: "read", userId: e.userId, lastReadAt: e.lastReadAt });
  });

  return {
    ...state,
    loadLatest,
    loadOlder,
    loadNewer,
    jumpTo,
    /** Dùng sau khi gọi API thành công (không chờ sự kiện realtime). */
    apply: dispatch,
  };
}

export type ChannelMessages = ReturnType<typeof useChannelMessages>;
