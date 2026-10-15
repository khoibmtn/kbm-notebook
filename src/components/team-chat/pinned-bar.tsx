"use client";
import { Pin, PinOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-client";
import { toPlainPreview } from "@/lib/team-chat/markdown";
import type { MessageDTO } from "@/lib/team-chat/types";

/** Thanh ghim trên đầu khung chat: bấm để nhảy tới tin ghim (lần lượt từng tin), bỏ ghim nếu có quyền. */
export function PinnedBar({
  pinned,
  canUnpin,
  onJump,
  onUnpin,
}: {
  pinned: MessageDTO[];
  canUnpin: boolean;
  onJump: (id: string) => void;
  onUnpin: (m: MessageDTO) => void;
}) {
  const t = useT();
  const [cursor, setCursor] = useState(0);
  if (pinned.length === 0) return null;
  const current = pinned[Math.min(cursor, pinned.length - 1)];
  const text =
    toPlainPreview(current.content) ||
    current.refs[0]?.title ||
    (current.attachments[0] ? `📎 ${current.attachments[0].name}` : "");

  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-sm" data-testid="pinned-bar">
      <Pin className="size-4 shrink-0 text-primary" />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          onJump(current.id);
          setCursor((c) => (c + 1) % pinned.length);
        }}
      >
        <span className="block text-xs font-medium text-primary">
          {t("team.pinned.title")}
          {pinned.length > 1 ? ` · ${Math.min(cursor, pinned.length - 1) + 1}/${pinned.length}` : ""}
        </span>
        <span className="block truncate text-muted-foreground">
          <span className="font-medium text-foreground">{current.sender.name}: </span>
          {text}
        </span>
      </button>
      {canUnpin && (
        <Button variant="ghost" size="icon" className="size-7" onClick={() => onUnpin(current)} aria-label={t("team.msg.unpin")} title={t("team.msg.unpin")}>
          <PinOff />
        </Button>
      )}
    </div>
  );
}
