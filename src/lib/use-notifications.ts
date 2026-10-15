"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useRealtimeEvent } from "@/lib/realtime";
import type { NotificationDTO, NotificationEvent } from "@/lib/team-chat/types";

/** Sự kiện cửa sổ: các thành phần phát khi thông báo thay đổi (vd. đã đọc kênh) để chuông tải lại. */
export const NOTIFICATIONS_CHANGED_EVENT = "kbm:notifications-changed";
export const TEAM_UNREAD_REFRESH_EVENT = "kbm:team-unread-refresh";

export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
export function requestTeamUnreadRefresh() {
  window.dispatchEvent(new Event(TEAM_UNREAD_REFRESH_EVENT));
}

type ListResponse = { notifications: NotificationDTO[]; unreadCount: number };

/**
 * Thông báo của người dùng (toàn cục, mọi sổ tay): danh sách + số chưa đọc, cập nhật realtime qua sự kiện `notification`.
 * `onIncoming` được gọi khi có thông báo mới (vd. hiện toast).
 */
export function useNotifications(onIncoming?: (n: NotificationDTO) => void) {
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    return api<ListResponse>("/api/notifications?limit=30")
      .then((res) => {
        setItems(res.notifications);
        setUnreadCount(res.unreadCount);
      })
      .catch(() => {
        /* im lặng: chuông không được làm hỏng trang */
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void reload();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, reload);
  }, [reload]);

  useRealtimeEvent<NotificationEvent>("notification", ({ notification }) => {
    setItems((prev) => (prev.some((n) => n.id === notification.id) ? prev : [notification, ...prev].slice(0, 30)));
    setUnreadCount((c) => c + 1);
    onIncoming?.(notification);
  });

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) && !n.readAt ? { ...n, readAt: now } : n)));
    try {
      const res = await api<{ unreadCount: number }>("/api/notifications/read", { method: "POST", json: { ids } });
      setUnreadCount(res.unreadCount);
    } catch {
      void reload();
    }
  }, [reload]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    try {
      await api("/api/notifications/read", { method: "POST", json: { all: true } });
    } catch {
      void reload();
    }
  }, [reload]);

  return { items, unreadCount, loading, reload, markRead, markAllRead };
}
