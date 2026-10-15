"use client";
import { AtSign, Bell, BellOff, CheckCheck, MessageCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import type { NotificationDTO } from "@/lib/team-chat/types";
import { useNotifications } from "@/lib/use-notifications";
import { cn } from "@/lib/utils";

function iconFor(type: string) {
  if (type === "mention") return AtSign;
  if (type === "dm") return MessageCircle;
  return Bell;
}

/** Chuông thông báo trên thanh trên: badge chưa đọc + danh sách dẫn tới kênh/tin nhắn. */
export function NotificationBell() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const onIncoming = useCallback(
    (n: NotificationDTO) => {
      // Đang mở đúng kênh được nhắc tới thì không cần toast.
      if (n.link) {
        const url = new URL(n.link, window.location.origin);
        const channel = url.searchParams.get("channel");
        if (pathname === url.pathname && channel && window.location.search.includes(channel) && document.visibilityState === "visible") return;
      }
      toast(n.title, {
        description: n.body ?? undefined,
        action: n.link ? { label: t("notifications.open"), onClick: () => router.push(n.link!) } : undefined,
      });
    },
    [pathname, router, t],
  );

  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications(onIncoming);

  function openItem(n: NotificationDTO) {
    void markRead([n.id]);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? t("notifications.openWithCount", { count: unreadCount }) : t("notifications.open")}
          data-testid="notification-bell"
        >
          <Bell />
          {unreadCount > 0 && (
            <span
              data-testid="notification-badge"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="text-sm font-semibold">{t("notifications.title")}</h3>
          <Button variant="ghost" size="sm" disabled={unreadCount === 0} onClick={() => void markAllRead()}>
            <CheckCheck /> {t("notifications.markAll")}
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto" data-testid="notification-list">
          {loading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <BellOff className="size-6" />
              {t("notifications.empty")}
            </div>
          ) : (
            <ul>
              {items.map((n) => {
                const Icon = iconFor(n.type);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        "flex w-full items-start gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent",
                        !n.readAt && "bg-primary/5",
                      )}
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", !n.readAt && "font-medium")}>{n.title}</span>
                        {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                        <span className="text-[11px] text-muted-foreground">{formatRelative(n.createdAt, locale)}</span>
                      </span>
                      {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
