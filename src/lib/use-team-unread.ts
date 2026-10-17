"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { useRealtimeEvent } from "@/lib/realtime";
import type { ChannelEvent, MessageNewEvent, ReadEvent } from "@/lib/team-chat/types";
import { TEAM_UNREAD_REFRESH_EVENT } from "@/lib/use-notifications";

/**
 * Tổng tin chưa đọc của sổ tay (bỏ kênh tắt tiếng) cho badge ở sidebar.
 * Tự tải lại (gộp 250ms) khi có tin mới, đã đọc, kênh mới hoặc khi trang chat yêu cầu làm mới.
 */
export function useTeamUnread(notebookId: string, meId: string): number {
  const [unread, setUnread] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api<{ unread: number }>(`/api/notebooks/${notebookId}/channels?summary=1`)
        .then((res) => setUnread(res.unread))
        .catch(() => {
          /* giữ giá trị cũ */
        });
    }, 250);
  }, [notebookId]);

  useEffect(() => {
    refresh();
    window.addEventListener(TEAM_UNREAD_REFRESH_EVENT, refresh);
    return () => {
      window.removeEventListener(TEAM_UNREAD_REFRESH_EVENT, refresh);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  useRealtimeEvent<MessageNewEvent>("message:new", (e) => {
    if (e.notebookId === notebookId && e.message.sender.id !== meId) refresh();
  });
  useRealtimeEvent<ReadEvent>("read", (e) => {
    if (e.notebookId === notebookId && e.userId === meId) refresh();
  });
  useRealtimeEvent<ChannelEvent>("channel:new", (e) => {
    if (e.notebookId === notebookId) refresh();
  });

  return unread;
}
