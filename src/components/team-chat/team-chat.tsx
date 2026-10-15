"use client";
import { MessageSquareText } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useNotebook } from "@/components/notebook/notebook-context";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { useRealtime, useRealtimeEvent } from "@/lib/realtime";
import { plainText } from "@/lib/team-chat/mentions";
import type {
  ChannelDTO,
  ChannelEvent,
  MessageDeleteEvent,
  MessageNewEvent,
  MessageUpdateEvent,
  PersonDTO,
  ReadEvent,
} from "@/lib/team-chat/types";
import { requestTeamUnreadRefresh } from "@/lib/use-notifications";
import { cn } from "@/lib/utils";
import { ChannelList } from "./channel-list";
import { NewDmDialog, TopicDialog } from "./channel-dialogs";
import { Conversation } from "./conversation";

type Active = { channelId: string | null; messageId: string | null; nonce: number };

function keyOf(channelId: string | null, messageId: string | null) {
  return `${channelId ?? ""}|${messageId ?? ""}`;
}

function writeUrl(channelId: string | null, messageId: string | null) {
  const url = new URL(window.location.href);
  if (channelId) url.searchParams.set("channel", channelId);
  else url.searchParams.delete("channel");
  if (messageId) url.searchParams.set("message", messageId);
  else url.searchParams.delete("message");
  window.history.replaceState(window.history.state, "", url);
}

/** Trang Team chat: danh sách kênh + khung hội thoại. */
export function TeamChat() {
  const t = useT();
  const { notebook, role, user } = useNotebook();
  const params = useSearchParams();
  const { socket } = useRealtime();

  const paramChannel = params.get("channel");
  const paramMessage = params.get("message");
  const paramKey = keyOf(paramChannel, paramMessage);
  const writtenKey = useRef(paramKey);

  const [channels, setChannels] = useState<ChannelDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [members, setMembers] = useState<PersonDTO[]>([]);
  const [active, setActive] = useState<Active>({ channelId: paramChannel, messageId: paramMessage, nonce: 0 });
  const [showList, setShowList] = useState(!paramChannel);
  const [topicDialog, setTopicDialog] = useState<{ channel: ChannelDTO | null } | null>(null);
  const [dmOpen, setDmOpen] = useState(false);

  const base = `/api/notebooks/${notebook.id}`;

  /* ------------------------------ Dữ liệu ------------------------------ */
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useCallback(() => {
    return api<{ channels: ChannelDTO[] }>(`${base}/channels`)
      .then((res) => {
        setChannels(res.channels);
        setLoadError(null);
      })
      .catch((e) => setLoadError(errorMessage(e, t("common.error"))));
  }, [base, t]);
  const reloadSoon = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), 300);
  }, [reload]);

  useEffect(() => {
    void reload();
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [reload]);

  const loadMembers = useCallback(() => {
    api<{ members: { userId: string; name: string; image: string | null }[] }>(`${base}/members`)
      .then((res) => setMembers(res.members.map((m) => ({ id: m.userId, name: m.name, image: m.image }))))
      .catch(() => undefined);
  }, [base]);
  useEffect(loadMembers, [loadMembers]);
  useRealtimeEvent("member:changed", loadMembers);

  // Bảo đảm socket đã vào phòng của mọi kênh đang hiển thị (máy chủ kiểm tra thành viên).
  useEffect(() => {
    if (!socket || !channels) return;
    const join = () => channels.forEach((c) => socket.emit("join:channel", { channelId: c.id }));
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
    };
  }, [socket, channels]);

  /* ------------------------------ URL ↔ kênh đang mở ------------------------------ */
  // Điều hướng từ bên ngoài (vd. bấm thông báo) → đổi kênh/tin. Chính ta ghi URL thì bỏ qua.
  useEffect(() => {
    if (paramKey === writtenKey.current) return;
    writtenKey.current = paramKey;
    setActive((a) => ({ channelId: paramChannel ?? a.channelId, messageId: paramMessage, nonce: a.nonce + 1 }));
    setShowList(false);
  }, [paramKey, paramChannel, paramMessage]);

  const generalId = useMemo(() => channels?.find((c) => c.type === "general")?.id ?? null, [channels]);
  const activeChannel = useMemo(() => {
    if (!channels) return null;
    return channels.find((c) => c.id === active.channelId) ?? channels.find((c) => c.id === generalId) ?? channels[0] ?? null;
  }, [channels, active.channelId, generalId]);

  const select = useCallback((channelId: string, messageId: string | null = null) => {
    writtenKey.current = keyOf(channelId, messageId);
    writeUrl(channelId, messageId);
    setActive((a) => ({ channelId, messageId, nonce: a.nonce + 1 }));
    setShowList(false);
  }, []);

  const onDeepLinkDone = useCallback(() => {
    setActive((a) => {
      if (!a.messageId) return a;
      writtenKey.current = keyOf(a.channelId, null);
      writeUrl(a.channelId, null);
      return { ...a, messageId: null };
    });
  }, []);

  /* ------------------------------ Realtime ------------------------------ */
  const upsertChannel = useCallback((incoming: ChannelDTO) => {
    setChannels((cur) => {
      if (!cur) return cur;
      return cur.some((c) => c.id === incoming.id) ? cur.map((c) => (c.id === incoming.id ? { ...c, ...incoming, unread: c.unread, lastMessage: c.lastMessage, lastReadAt: c.lastReadAt } : c)) : [...cur, incoming];
    });
  }, []);

  useRealtimeEvent<MessageNewEvent>("message:new", (e) => {
    if (e.notebookId !== notebook.id) return;
    setChannels((cur) => {
      if (!cur) return cur;
      if (!cur.some((c) => c.id === e.channelId)) {
        reloadSoon();
        return cur;
      }
      const m = e.message;
      return cur.map((c) =>
        c.id !== e.channelId
          ? c
          : {
              ...c,
              unread: m.sender.id === user.id ? 0 : c.unread + 1,
              lastActivityAt: m.createdAt,
              lastMessage: {
                id: m.id,
                senderId: m.sender.id,
                senderName: m.sender.name,
                kind: m.kind,
                preview: plainText(m.content).replace(/\s+/g, " ").trim().slice(0, 140) || m.refs[0]?.title || (m.attachments[0] ? `📎 ${m.attachments[0].name}` : ""),
                recalled: false,
                createdAt: m.createdAt,
              },
            },
      );
    });
  });

  const onMessageChanged = useCallback((e: MessageUpdateEvent) => {
    if (e.notebookId !== notebook.id) return;
    setChannels((cur) =>
      cur
        ? cur.map((c) =>
            c.id === e.channelId && c.lastMessage?.id === e.message.id
              ? {
                  ...c,
                  lastMessage: {
                    ...c.lastMessage,
                    recalled: e.message.recalledAt != null,
                    preview: e.message.recalledAt ? "" : plainText(e.message.content).replace(/\s+/g, " ").trim().slice(0, 140),
                  },
                }
              : c,
          )
        : cur,
    );
  }, [notebook.id]);
  useRealtimeEvent<MessageUpdateEvent>("message:edit", onMessageChanged);
  useRealtimeEvent<MessageUpdateEvent>("message:recall", onMessageChanged);

  useRealtimeEvent<MessageDeleteEvent>("message:delete", (e) => {
    if (e.notebookId !== notebook.id) return;
    if (channels?.some((c) => c.id === e.channelId && c.lastMessage?.id === e.messageId)) reloadSoon();
  });

  useRealtimeEvent<ChannelEvent>("channel:new", (e) => {
    if (e.notebookId !== notebook.id) return;
    upsertChannel({ ...e.channel, unread: 0, muted: false, lastReadAt: null, lastMessage: null });
  });
  useRealtimeEvent<ChannelEvent>("channel:update", (e) => {
    if (e.notebookId !== notebook.id) return;
    setChannels((cur) => (cur ? cur.map((c) => (c.id === e.channel.id ? { ...c, name: e.channel.name } : c)) : cur));
  });
  // Đọc từ thiết bị/tab khác của chính mình → đồng bộ số chưa đọc.
  useRealtimeEvent<ReadEvent>("read", (e) => {
    if (e.notebookId === notebook.id && e.userId === user.id) reloadSoon();
  });

  const onRead = useCallback((channelId: string, messageId: string) => {
    setChannels((cur) =>
      cur
        ? cur.map((c) =>
            c.id === channelId && c.lastMessage?.id === messageId ? { ...c, unread: 0, lastReadAt: c.lastMessage.createdAt } : c,
          )
        : cur,
    );
  }, []);

  /* ------------------------------ Thao tác kênh ------------------------------ */
  async function toggleMute(c: ChannelDTO) {
    try {
      await api(`${base}/channels/${c.id}/mute`, { method: "POST", json: { muted: !c.muted } });
      setChannels((cur) => (cur ? cur.map((x) => (x.id === c.id ? { ...x, muted: !c.muted } : x)) : cur));
      requestTeamUnreadRefresh();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  }

  const dmCandidates = useMemo(() => members.filter((m) => m.id !== user.id), [members, user.id]);

  /* ------------------------------ Render ------------------------------ */
  if (loadError && !channels) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <p>{loadError}</p>
        <button type="button" className="underline" onClick={() => void reload()}>
          {t("team.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1" data-testid="team-chat">
      <aside className={cn("w-full shrink-0 border-r bg-background md:block md:w-72", showList ? "block" : "hidden")}>
        {channels ? (
          <ChannelList
            channels={channels}
            activeId={activeChannel?.id ?? null}
            meId={user.id}
            myRole={role}
            onSelect={(id) => select(id)}
            onCreateTopic={() => setTopicDialog({ channel: null })}
            onNewDm={() => setDmOpen(true)}
            onToggleMute={(c) => void toggleMute(c)}
            onRename={(c) => setTopicDialog({ channel: c })}
          />
        ) : (
          <div className="space-y-3 p-3" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
      </aside>

      <section className={cn("min-w-0 flex-1 flex-col md:flex", showList ? "hidden" : "flex")}>
        {activeChannel ? (
          <Conversation
            key={`${activeChannel.id}:${active.nonce}`}
            channel={activeChannel}
            meId={user.id}
            myRole={role}
            members={members}
            initialMessageId={active.channelId === activeChannel.id ? active.messageId : null}
            onBack={() => setShowList(true)}
            onRead={onRead}
            onOpenResult={(channelId, messageId) => select(channelId, messageId)}
            onDeepLinkDone={onDeepLinkDone}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <MessageSquareText className="size-8" />
            <p className="text-sm">{channels ? t("team.pickChannel") : t("common.loading")}</p>
          </div>
        )}
      </section>

      {topicDialog && (
        <TopicDialog
          key={topicDialog.channel?.id ?? "new"}
          open
          onOpenChange={(o) => !o && setTopicDialog(null)}
          notebookId={notebook.id}
          channel={topicDialog.channel}
          onDone={(c, created) => {
            if (created) {
              upsertChannel(c);
              select(c.id);
            } else {
              setChannels((cur) => (cur ? cur.map((x) => (x.id === c.id ? { ...x, name: c.name } : x)) : cur));
            }
          }}
        />
      )}
      {dmOpen && (
        <NewDmDialog
          open
          onOpenChange={setDmOpen}
          notebookId={notebook.id}
          members={dmCandidates}
          onOpened={(c) => {
            upsertChannel(c);
            select(c.id);
          }}
        />
      )}
    </div>
  );
}
