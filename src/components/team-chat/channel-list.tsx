"use client";
import { BellOff, Bell, Hash, MoreHorizontal, Pencil, Plus, Search, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@/lib/i18n-client";
import { hasRole, type Role } from "@/lib/roles";
import { formatRelative } from "@/lib/format";
import { plainText } from "@/lib/team-chat/mentions";
import type { ChannelDTO } from "@/lib/team-chat/types";
import { cn } from "@/lib/utils";
import { channelTitle, dmPeer, sortChannels } from "./channel-utils";

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").toLowerCase();
}

type Props = {
  channels: ChannelDTO[];
  activeId: string | null;
  meId: string;
  myRole: Role;
  onSelect: (id: string) => void;
  onCreateTopic: () => void;
  onNewDm: () => void;
  onToggleMute: (c: ChannelDTO) => void;
  onRename: (c: ChannelDTO) => void;
};

function Section({
  title,
  action,
  children,
  testId,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="py-1" data-testid={testId}>
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      <ul className="space-y-0.5 px-1.5">{children}</ul>
    </section>
  );
}

export function ChannelList({ channels, activeId, meId, myRole, onSelect, onCreateTopic, onNewDm, onToggleMute, onRename }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const query = fold(q.trim());
    const sorted = sortChannels(channels);
    if (!query) return sorted;
    return sorted.filter((c) => fold(channelTitle(c, meId, t)).includes(query));
  }, [channels, q, meId, t]);

  const general = visible.filter((c) => c.type === "general");
  const topics = visible.filter((c) => c.type === "topic");
  const dms = visible.filter((c) => c.type === "dm");
  const canCreateTopic = hasRole(myRole, "editor");

  function row(c: ChannelDTO) {
    const title = channelTitle(c, meId, t);
    const peer = dmPeer(c, meId);
    const last = c.lastMessage;
    const preview = last
      ? last.recalled
        ? t("team.msg.recalled")
        : `${last.senderId === meId ? t("team.list.you") : c.type === "dm" ? "" : `${last.senderName}: `}${last.preview || (last.kind === "file" ? t("team.list.file") : "")}`
      : t("team.list.noMessages");
    const active = c.id === activeId;
    const canRename = c.type === "topic" && (hasRole(myRole, "admin") || c.createdBy === meId);
    return (
      <li key={c.id} className="group/row relative">
        <button
          type="button"
          onClick={() => onSelect(c.id)}
          aria-current={active ? "true" : undefined}
          data-testid="channel-item"
          data-channel-type={c.type}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent",
            active && "bg-accent",
          )}
        >
          {c.type === "dm" && peer ? (
            <UserAvatar name={peer.name} image={peer.image} className="size-9" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {c.type === "general" ? <UsersRound className="size-4" /> : <Hash className="size-4" />}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className={cn("truncate text-sm", c.unread > 0 && !c.muted ? "font-semibold" : "font-medium")}>{title}</span>
              {c.muted && <BellOff className="size-3 shrink-0 text-muted-foreground" aria-label={t("team.list.muted")} />}
              {last && (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground group-hover/row:invisible">
                  {formatRelative(last.createdAt, locale)}
                </span>
              )}
            </span>
            <span className="flex items-center gap-1">
              <span className={cn("block truncate text-xs", c.unread > 0 && !c.muted ? "text-foreground" : "text-muted-foreground")}>
                {plainText(preview)}
              </span>
              {c.unread > 0 && (
                <span
                  data-testid="channel-unread"
                  className={cn(
                    "ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold",
                    c.muted ? "bg-muted-foreground/30 text-foreground" : "bg-primary text-primary-foreground",
                  )}
                >
                  {c.unread > 99 ? "99+" : c.unread}
                </span>
              )}
            </span>
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1.5 top-1.5 size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label={t("team.list.options")}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onToggleMute(c)}>
              {c.muted ? <Bell /> : <BellOff />} {c.muted ? t("team.list.unmute") : t("team.list.mute")}
            </DropdownMenuItem>
            {canRename && (
              <DropdownMenuItem onSelect={() => onRename(c)}>
                <Pencil /> {t("team.list.rename")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="channel-list">
      <div className="shrink-0 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("team.list.search")}
            aria-label={t("team.list.search")}
            className="h-9 pl-8"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {general.length > 0 && (
          <Section title={t("team.list.general")} testId="channels-general">
            {general.map(row)}
          </Section>
        )}
        <Section
          title={t("team.list.topics")}
          testId="channels-topics"
          action={
            canCreateTopic ? (
              <Button variant="ghost" size="icon" className="size-6" onClick={onCreateTopic} aria-label={t("team.topic.create")} title={t("team.topic.create")} data-testid="create-topic">
                <Plus />
              </Button>
            ) : undefined
          }
        >
          {topics.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">{q ? t("team.list.noMatch") : t("team.list.noTopics")}</li>
          ) : (
            topics.map(row)
          )}
        </Section>
        <Section
          title={t("team.list.dms")}
          testId="channels-dms"
          action={
            <Button variant="ghost" size="icon" className="size-6" onClick={onNewDm} aria-label={t("team.dm.new")} title={t("team.dm.new")} data-testid="new-dm">
              <Plus />
            </Button>
          }
        >
          {dms.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">{q ? t("team.list.noMatch") : t("team.list.noDms")}</li>
          ) : (
            dms.map(row)
          )}
        </Section>
      </div>
    </div>
  );
}
