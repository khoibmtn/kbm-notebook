"use client";
import { ArrowDown, ArrowLeft, CheckSquare, Hash, Loader2, MessageSquareText, Search, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { useRealtime, useRealtimeEvent } from "@/lib/realtime";
import { hasRole, type Role } from "@/lib/roles";
import { dayLabel } from "@/lib/team-chat/format";
import { groupMessages } from "@/lib/team-chat/grouping";
import { plainText } from "@/lib/team-chat/mentions";
import type {
  AttachmentDTO,
  ChannelDTO,
  MessageDTO,
  PersonDTO,
  ReadReceiptDTO,
  RefType,
  TypingEvent,
} from "@/lib/team-chat/types";
import { notifyNotificationsChanged, requestTeamUnreadRefresh } from "@/lib/use-notifications";
import { cn } from "@/lib/utils";
import { channelTitle, dmPeer } from "./channel-utils";
import { Composer, type ComposerHandle, type SendPayload } from "./composer";
import { MessageItem, type MessageActions } from "./message-item";
import { PinnedBar } from "./pinned-bar";
import { RefPickerDialog } from "./ref-picker-dialog";
import { SearchPanel, type SearchResult } from "./search-panel";
import { useChannelMessages } from "./use-channel-messages";

type Props = {
  channel: ChannelDTO;
  meId: string;
  myRole: Role;
  members: PersonDTO[];
  /** Tin cần nhảy tới khi mở (liên kết từ thông báo / kết quả tìm kiếm). */
  initialMessageId: string | null;
  onBack: () => void;
  onRead: (channelId: string, messageId: string) => void;
  onOpenResult: (channelId: string, messageId: string) => void;
  /** Đã nhảy tới tin trong liên kết: bên ngoài có thể xoá `message` khỏi URL. */
  onDeepLinkDone: () => void;
};

const BOTTOM_THRESHOLD = 80;
const EMPTY_READERS: never[] = [];

export function Conversation({ channel, meId, myRole, members, initialMessageId, onBack, onRead, onOpenResult, onDeepLinkDone }: Props) {
  const t = useT();
  const router = useRouter();
  const { socket } = useRealtime();
  const data = useChannelMessages(channel.id, meId);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mốc "đã đọc" lúc mở kênh, để chèn dải "Tin nhắn mới".
  const [openState] = useState(() => ({ lastReadAt: channel.lastReadAt, unread: channel.unread }));

  const [replyTo, setReplyTo] = useState<MessageDTO | null>(null);
  const [editing, setEditing] = useState<MessageDTO | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "recall" | "delete"; message: MessageDTO } | null>(null);
  const [picker, setPicker] = useState<RefType | null>(null);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [lateDividerId, setLateDividerId] = useState<string | null>(null);
  const [typers, setTypers] = useState<Record<string, { name: string; until: number }>>({});
  const [visible, setVisible] = useState(true);
  const [busyNote, setBusyNote] = useState(false);
  const [scrollTick, setScrollTick] = useState(0);

  const pendingScroll = useRef<{ id: string } | { bottom: true; smooth?: boolean } | null>(null);
  const initialized = useRef(false);
  const lastMarked = useRef<string | null>(null);
  const prevEdges = useRef<{ first: string | null; last: string | null; height: number }>({ first: null, last: null, height: 0 });
  const lastTypingSent = useRef(0);

  const canEditor = hasRole(myRole, "editor");
  const peer = dmPeer(channel, meId);
  const title = channelTitle(channel, meId, t);
  const mentionable = useMemo(() => {
    const pool = channel.type === "dm" ? members.filter((m) => channel.members.some((x) => x.id === m.id)) : members;
    return pool.filter((m) => m.id !== meId);
  }, [members, channel.type, channel.members, meId]);
  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const nameOf = useCallback((id: string) => memberName.get(id) ?? "?", [memberName]);

  const { messages } = data;
  const lastMessage = messages[messages.length - 1] ?? null;

  /* ------------------------------ Dải "Tin nhắn mới" ------------------------------ */
  const initialDividerId = useMemo(() => {
    if (openState.unread <= 0) return null;
    const since = openState.lastReadAt ? new Date(openState.lastReadAt).getTime() : -Infinity;
    const first = messages.find((m) => m.sender.id !== meId && !m.recalledAt && new Date(m.createdAt).getTime() > since);
    return first?.id ?? null;
  }, [messages, openState, meId]);
  const dividerId = initialDividerId ?? lateDividerId;

  const items = useMemo(() => groupMessages(messages, { dividerBeforeId: dividerId }), [messages, dividerId]);

  /* ------------------------------ Dấu "đã xem" ------------------------------ */
  const readersByMessage = useMemo(() => {
    const map = new Map<string, ReadReceiptDTO[]>();
    for (const r of data.reads) {
      const at = new Date(r.lastReadAt).getTime();
      let target: MessageDTO | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (new Date(messages[i].createdAt).getTime() <= at) {
          target = messages[i];
          break;
        }
      }
      if (!target) continue;
      map.set(target.id, [...(map.get(target.id) ?? []), r]);
    }
    return map;
  }, [data.reads, messages]);

  /* ------------------------------ Cuộn ------------------------------ */
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const jumpToMessage = useCallback(
    async (id: string) => {
      const ok = await data.jumpTo(id);
      if (!ok) {
        toast.error(t("team.msg.notFound"));
        return;
      }
      pendingScroll.current = { id };
      setScrollTick((n) => n + 1);
    },
    [data, t],
  );

  // Xử lý yêu cầu cuộn đang chờ + giữ vị trí khi nạp thêm tin cũ ở trên.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevEdges.current;
    const first = messages[0]?.id ?? null;
    const last = messages[messages.length - 1]?.id ?? null;
    const p = pendingScroll.current;
    if (p) {
      if ("bottom" in p) {
        el.scrollTo({ top: el.scrollHeight, behavior: p.smooth ? "smooth" : "auto" });
        pendingScroll.current = null;
      } else {
        const target = el.querySelector<HTMLElement>(`#msg-${p.id}`);
        if (target) {
          target.scrollIntoView({ block: "center" });
          setHighlightId(p.id);
          pendingScroll.current = null;
        }
      }
    } else if (prev.first && first && first !== prev.first && last === prev.last) {
      // Tin cũ được chèn lên đầu: bù chiều cao để không bị nhảy.
      el.scrollTop += el.scrollHeight - prev.height;
    }
    prevEdges.current = { first, last, height: el.scrollHeight };
    // scrollTick: yêu cầu cuộn mới (vd. nhảy tới tin đã có sẵn trong danh sách).
  }, [messages, scrollTick]);

  useEffect(() => {
    if (!highlightId) return;
    const h = setTimeout(() => setHighlightId(null), 1800);
    return () => clearTimeout(h);
  }, [highlightId]);

  // Màn hình rộng: đưa con trỏ vào ô soạn khi mở kênh (trên di động tránh bật bàn phím).
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) composerRef.current?.focus();
  }, []);

  // Lần nạp đầu: tới liên kết / dải tin mới / cuối.
  useEffect(() => {
    if (data.status !== "ready" || initialized.current) return;
    initialized.current = true;
    if (initialMessageId) {
      void jumpToMessage(initialMessageId).then(onDeepLinkDone);
    } else if (initialDividerId) {
      pendingScroll.current = { id: initialDividerId };
      setScrollTick((n) => n + 1);
    } else {
      pendingScroll.current = { bottom: true };
      setScrollTick((n) => n + 1);
    }
  }, [data.status, initialMessageId, initialDividerId, jumpToMessage, onDeepLinkDone]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
    if (el.scrollTop < 160 && data.hasOlder && !data.loadingOlder) void data.loadOlder();
    if (bottom && data.hasNewer && !data.loadingNewer) void data.loadNewer();
  }, [data]);

  // Đang ở sát đầu danh sách (hoặc nội dung chưa đủ cao để cuộn) mà vẫn còn tin cũ → nạp tiếp.
  // Chạy sau mỗi lần render vì vị trí cuộn có thể ở 0 mà không có sự kiện scroll nào (vd. vừa nhảy tới dải tin mới).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || data.status !== "ready" || !data.hasOlder || data.loadingOlder) return;
    if (!initialized.current || pendingScroll.current) return;
    if (el.scrollTop < 160 || el.scrollHeight <= el.clientHeight + 40) void data.loadOlder();
  });

  // Tin mới ở cuối: tự cuộn nếu đang ở đáy hoặc là tin của mình, ngược lại đếm "tin mới".
  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    if (data.status !== "ready" || !lastMessage) return;
    if (lastSeen.current === null) {
      lastSeen.current = lastMessage.id;
      return;
    }
    if (lastSeen.current === lastMessage.id) return;
    lastSeen.current = lastMessage.id;
    if (data.hasNewer) return;
    const mine = lastMessage.sender.id === meId;
    if (mine || atBottom) {
      pendingScroll.current = { bottom: true, smooth: !mine };
      setScrollTick((n) => n + 1);
    } else if (!mine) {
      setUnseen((n) => n + 1);
      setLateDividerId((cur) => cur ?? lastMessage.id);
    }
  }, [lastMessage, data.status, data.hasNewer, atBottom, meId]);

  /* ------------------------------ Đã đọc ------------------------------ */
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  const markRead = useCallback(
    (messageId: string) => {
      const viaRest = () =>
        api(`/api/notebooks/${channel.notebookId}/channels/${channel.id}/read`, { method: "POST", json: { messageId } }).catch(() => undefined);
      if (socket?.connected) {
        socket.timeout(4000).emit("read", { channelId: channel.id, messageId }, (err: unknown, res?: { ok: boolean }) => {
          if (err || !res?.ok) void viaRest();
        });
      } else {
        void viaRest();
      }
      onRead(channel.id, messageId);
      // Máy chủ đã đánh dấu thông báo mention/dm của kênh này là đã đọc.
      setTimeout(() => {
        notifyNotificationsChanged();
        requestTeamUnreadRefresh();
      }, 400);
    },
    [socket, channel.id, channel.notebookId, onRead],
  );

  useEffect(() => {
    if (data.status !== "ready" || data.hasNewer || !lastMessage || !atBottom || !visible) return;
    if (lastMarked.current === lastMessage.id) return;
    const needs = channel.unread > 0 || lastMessage.sender.id !== meId;
    if (!needs) return;
    lastMarked.current = lastMessage.id;
    markRead(lastMessage.id);
  }, [data.status, data.hasNewer, lastMessage, atBottom, visible, channel.unread, meId, markRead]);

  /* ------------------------------ Đang nhập ------------------------------ */
  useRealtimeEvent<TypingEvent>("typing", (e) => {
    if (e.channelId !== channel.id || e.userId === meId) return;
    setTypers((cur) => ({ ...cur, [e.userId]: { name: e.name, until: Date.now() + 4000 } }));
  });
  useEffect(() => {
    if (Object.keys(typers).length === 0) return;
    const h = setInterval(() => {
      setTypers((cur) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 1000);
    return () => clearInterval(h);
  }, [typers]);
  // Người vừa gửi tin thì không còn "đang nhập".
  const lastSenderId = lastMessage?.sender.id ?? null;
  const lastMessageId = lastMessage?.id ?? null;
  useEffect(() => {
    if (!lastSenderId || lastSenderId === meId) return;
    setTypers((cur) => {
      if (!(lastSenderId in cur)) return cur;
      const { [lastSenderId]: _drop, ...rest } = cur;
      void _drop;
      return rest;
    });
  }, [lastSenderId, lastMessageId, meId]);

  const emitTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2000) return;
    lastTypingSent.current = now;
    socket?.emit("typing", { channelId: channel.id });
  }, [socket, channel.id]);

  const typerNames = Object.values(typers).map((x) => x.name);
  const typingText =
    typerNames.length === 0
      ? null
      : typerNames.length === 1
        ? t("team.typing.one", { name: typerNames[0] })
        : typerNames.length === 2
          ? t("team.typing.two", { a: typerNames[0], b: typerNames[1] })
          : t("team.typing.many");

  /* ------------------------------ Hành động ------------------------------ */
  const base = `/api/channels/${channel.id}/messages`;

  const send = useCallback(
    async (p: SendPayload) => {
      try {
        const res = await api<{ message: MessageDTO }>(base, {
          method: "POST",
          json: {
            kind: "text",
            content: p.content,
            mentions: p.mentions,
            replyToId: p.replyToId,
            attachmentFileIds: p.attachmentFileIds,
          },
        });
        setReplyTo(null);
        if (data.hasNewer) {
          await data.loadLatest();
        } else {
          data.apply({ type: "upsert", message: res.message });
        }
        pendingScroll.current = { bottom: true };
        setScrollTick((n) => n + 1);
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
        throw e;
      }
    },
    [base, data, t],
  );

  const submitEdit = useCallback(
    async (m: MessageDTO, content: string, mentions: string[]) => {
      try {
        const res = await api<{ message: MessageDTO }>(`${base}/${m.id}`, { method: "PATCH", json: { content, mentions } });
        data.apply({ type: "replace", message: res.message });
        setEditing(null);
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
        throw e;
      }
    },
    [base, data, t],
  );

  const handlers = useRef<MessageActions>(null as unknown as MessageActions);
  useEffect(() => {
    handlers.current = {
      reply: (m) => {
        setEditing(null);
        setReplyTo(m);
      },
      react: async (m, emoji) => {
        try {
          const res = await api<{ reactions: MessageDTO["reactions"] }>(`${base}/${m.id}/reactions`, { method: "POST", json: { emoji } });
          data.apply({ type: "reactions", id: m.id, reactions: res.reactions });
        } catch (e) {
          toast.error(errorMessage(e, t("common.error")));
        }
      },
      edit: (m) => {
        setReplyTo(null);
        setEditing(m);
        composerRef.current?.beginEdit(m);
      },
      recall: (m) => setConfirm({ kind: "recall", message: m }),
      remove: (m) => setConfirm({ kind: "delete", message: m }),
      pin: async (m) => {
        try {
          const res = await api<{ message: MessageDTO }>(`${base}/${m.id}/pin`, { method: "POST" });
          data.apply({ type: "pin", message: res.message });
          toast.success(res.message.pinned ? t("team.msg.pinnedToast") : t("team.msg.unpinnedToast"));
        } catch (e) {
          toast.error(errorMessage(e, t("common.error")));
        }
      },
      toSource: async (m, a?: AttachmentDTO) => {
        try {
          const res = await api<{ sources: { id: string; title: string; existing: boolean }[] }>(`${base}/${m.id}/to-source`, {
            method: "POST",
            json: a ? { attachmentId: a.id } : {},
          });
          const fresh = res.sources.filter((s) => !s.existing).length;
          toast.success(fresh > 0 ? t("team.msg.toSourceDone", { count: fresh }) : t("team.msg.toSourceExists"), {
            action: { label: t("team.msg.openSources"), onClick: () => router.push(`/n/${channel.notebookId}/sources`) },
          });
        } catch (e) {
          toast.error(errorMessage(e, t("common.error")));
        }
      },
      startSelect: (m) => {
        setSelectMode(true);
        setSelected(new Set([m.id]));
      },
      toggleSelect: (m) =>
        setSelected((cur) => {
          const next = new Set(cur);
          if (next.has(m.id)) next.delete(m.id);
          else next.add(m.id);
          return next;
        }),
      copy: async (m) => {
        try {
          await navigator.clipboard.writeText(plainText(m.content));
          toast.success(t("team.msg.copied"));
        } catch {
          toast.error(t("common.error"));
        }
      },
      jumpTo: (id) => void jumpToMessage(id),
    };
  });
  const actions = useMemo<MessageActions>(
    () => ({
      reply: (m) => handlers.current.reply(m),
      react: (m, e) => handlers.current.react(m, e),
      edit: (m) => handlers.current.edit(m),
      recall: (m) => handlers.current.recall(m),
      remove: (m) => handlers.current.remove(m),
      pin: (m) => handlers.current.pin(m),
      toSource: (m, a) => handlers.current.toSource(m, a),
      startSelect: (m) => handlers.current.startSelect(m),
      toggleSelect: (m) => handlers.current.toggleSelect(m),
      copy: (m) => handlers.current.copy(m),
      jumpTo: (id) => handlers.current.jumpTo(id),
    }),
    [],
  );

  async function confirmAction() {
    if (!confirm) return;
    const { kind, message } = confirm;
    setConfirm(null);
    try {
      if (kind === "recall") {
        const res = await api<{ message: MessageDTO }>(`${base}/${message.id}/recall`, { method: "POST" });
        data.apply({ type: "replace", message: res.message });
      } else {
        await api(`${base}/${message.id}`, { method: "DELETE" });
        data.apply({ type: "remove", id: message.id });
      }
      if (editing?.id === message.id) setEditing(null);
      if (replyTo?.id === message.id) setReplyTo(null);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectMode(false);
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  async function createNote() {
    if (selected.size === 0 || busyNote) return;
    setBusyNote(true);
    try {
      const res = await api<{ noteId: string }>(`/api/notebooks/${channel.notebookId}/notes/from-messages`, {
        method: "POST",
        json: {
          channelId: channel.id,
          messageIds: [...selected],
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      toast.success(t("team.select.noteCreated"), {
        action: { label: t("team.select.openNotes"), onClick: () => router.push(`/n/${channel.notebookId}/notes?note=${res.noteId}`) },
      });
      exitSelect();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusyNote(false);
    }
  }

  const editLast = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender.id === meId && !m.recalledAt && (m.kind === "text" || m.kind === "file")) {
        setReplyTo(null);
        setEditing(m);
        composerRef.current?.beginEdit(m);
        return;
      }
    }
  }, [messages, meId]);

  async function sharePicked(type: RefType, item: { id: string; title: string }) {
    try {
      const refs = type === "artifact" ? { artifactId: item.id } : type === "source" ? { sourceId: item.id } : { noteId: item.id };
      const res = await api<{ message: MessageDTO }>(base, { method: "POST", json: { kind: `${type}_ref`, content: "", refs } });
      if (data.hasNewer) await data.loadLatest();
      else data.apply({ type: "upsert", message: res.message });
      pendingScroll.current = { bottom: true };
      setScrollTick((n) => n + 1);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  }

  function pickResult(r: SearchResult) {
    if (r.channelId !== channel.id) {
      onOpenResult(r.channelId, r.id);
      return;
    }
    void jumpToMessage(r.id);
  }

  /* ------------------------------ Kéo thả tệp ------------------------------ */
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const dayLabels = { today: t("team.day.today"), yesterday: t("team.day.yesterday") };
  const showSender = channel.type !== "dm";
  const missed = unseen + data.missed;

  return (
    <div
      className="relative flex h-full min-h-0 flex-1"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        composerRef.current?.addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Tiêu đề kênh */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label={t("team.back")}>
            <ArrowLeft />
          </Button>
          {peer ? (
            <UserAvatar name={peer.name} image={peer.image} className="size-9" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {channel.type === "general" ? <UsersRound className="size-4" /> : <Hash className="size-4" />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold" data-testid="channel-title">
              {title}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {channel.type === "dm"
                ? t("team.channel.dmSubtitle")
                : channel.type === "general"
                  ? t("team.channel.generalSubtitle", { count: members.length })
                  : t("team.channel.topicSubtitle")}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSearchOpen((o) => !o)} aria-label={t("team.search.title")} aria-pressed={searchOpen} data-testid="search-toggle">
            <Search />
          </Button>
        </header>

        <PinnedBar
          pinned={data.pinned}
          canUnpin={canEditor}
          onJump={(id) => void jumpToMessage(id)}
          onUnpin={(m) => void handlers.current.pin(m)}
        />

        {selectMode && (
          <div className="flex shrink-0 items-center gap-2 border-b bg-primary/10 px-3 py-2 text-sm" data-testid="select-bar">
            <CheckSquare className="size-4 text-primary" />
            <span className="flex-1 font-medium">{t("team.select.count", { count: selected.size })}</span>
            <Button size="sm" disabled={selected.size === 0 || busyNote} onClick={() => void createNote()} data-testid="create-note">
              {busyNote && <Loader2 className="animate-spin" />} {t("team.select.createNote", { count: selected.size })}
            </Button>
            <Button size="sm" variant="ghost" onClick={exitSelect}>
              <X /> {t("common.cancel")}
            </Button>
          </div>
        )}

        {/* Danh sách tin nhắn */}
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain pb-2 pt-4" data-testid="message-list">
            {data.status === "loading" && (
              <div className="space-y-4 p-4" aria-busy="true">
                <Skeleton className="h-10 w-2/3 rounded-2xl" />
                <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
                <Skeleton className="h-16 w-3/5 rounded-2xl" />
              </div>
            )}
            {data.status === "error" && (
              <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <p>{data.error ?? t("common.error")}</p>
                <Button variant="outline" size="sm" onClick={() => void data.loadLatest()}>
                  {t("team.retry")}
                </Button>
              </div>
            )}
            {data.status === "ready" && messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground" data-testid="channel-empty">
                <MessageSquareText className="size-8" />
                <p className="text-sm font-medium text-foreground">{t("team.empty.channelTitle")}</p>
                <p className="max-w-xs text-sm">{t("team.empty.channelDescription")}</p>
              </div>
            )}
            {data.status === "ready" && data.loadingOlder && (
              <div className="flex justify-center py-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {data.status === "ready" && !data.hasOlder && messages.length > 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">{t("team.list.start")}</p>
            )}
            {items.map((it) => {
              if (it.type === "day") {
                return (
                  <div key={it.key} className="my-3 flex justify-center">
                    <span className="rounded-full bg-muted px-3 py-0.5 text-xs font-medium text-muted-foreground">{dayLabel(it.date, dayLabels)}</span>
                  </div>
                );
              }
              if (it.type === "divider") {
                return (
                  <div key={it.key} className="my-2 flex items-center gap-3 px-4" data-testid="new-divider">
                    <span className="h-px flex-1 bg-destructive/40" />
                    <span className="text-xs font-medium text-destructive">{t("team.newMessages")}</span>
                    <span className="h-px flex-1 bg-destructive/40" />
                  </div>
                );
              }
              return (
                <div key={it.key}>
                  {it.messages.map((m, idx) => (
                    <MessageItem
                      key={m.id}
                      message={m}
                      notebookId={channel.notebookId}
                      meId={meId}
                      myRole={myRole}
                      showSender={showSender}
                      firstInGroup={idx === 0}
                      selectMode={selectMode}
                      selected={selected.has(m.id)}
                      highlighted={highlightId === m.id}
                      readers={readersByMessage.get(m.id) ?? EMPTY_READERS}
                      nameOf={nameOf}
                      actions={actions}
                    />
                  ))}
                </div>
              );
            })}
            {data.status === "ready" && data.loadingNewer && (
              <div className="flex justify-center py-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          {!atBottom && data.status === "ready" && (
            <Button
              variant="secondary"
              size="sm"
              className={cn("absolute bottom-3 right-4 rounded-full shadow-md", missed > 0 && "bg-primary text-primary-foreground hover:bg-primary/90")}
              onClick={() => {
                setUnseen(0);
                if (data.hasNewer) {
                  void data.loadLatest().then(() => {
                    pendingScroll.current = { bottom: true };
                    setScrollTick((n) => n + 1);
                  });
                } else scrollToBottom(true);
              }}
              data-testid="jump-latest"
            >
              <ArrowDown /> {missed > 0 ? t("team.jumpNew", { count: missed }) : t("team.jumpLatest")}
            </Button>
          )}
        </div>

        <div className="h-5 shrink-0 px-5 text-xs text-muted-foreground" aria-live="polite" data-testid="typing-indicator">
          {typingText}
        </div>

        <Composer
          ref={composerRef}
          channelId={channel.id}
          members={mentionable}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSend={send}
          onEditSubmit={submitEdit}
          onTyping={emitTyping}
          onEditLast={editLast}
          onPickRef={setPicker}
          placeholder={t("team.composer.placeholder", { name: title })}
        />
      </div>

      {searchOpen && (
        <div className="absolute inset-0 z-20 sm:static sm:z-auto sm:inset-auto">
          <SearchPanel
            notebookId={channel.notebookId}
            channelId={channel.id}
            channelLabel={title}
            onClose={() => setSearchOpen(false)}
            onPick={pickResult}
          />
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary bg-background/80" data-testid="drop-overlay">
          <p className="text-sm font-medium text-primary">{t("team.drop")}</p>
        </div>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirm?.kind === "recall" ? t("team.confirm.recallTitle") : t("team.confirm.deleteTitle")}</DialogTitle>
            <DialogDescription>{confirm?.kind === "recall" ? t("team.confirm.recallBody") : t("team.confirm.deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmAction()} data-testid="confirm-action">
              {confirm?.kind === "recall" ? t("team.msg.recall") : t("team.msg.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {picker && (
        <RefPickerDialog
          open
          onOpenChange={(o) => !o && setPicker(null)}
          notebookId={channel.notebookId}
          type={picker}
          onPick={(item) => void sharePicked(picker, item)}
        />
      )}
    </div>
  );
}
