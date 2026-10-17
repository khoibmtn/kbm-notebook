"use client";
import { Lightbulb, X } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-client";

export const TIP_KEY = "kbm:tip-dismissed";
const EVENT = "kbm:tip";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Thanh mẹo ở lần đầu mở sổ tay; đóng một lần là nhớ trong localStorage (đồng bộ giữa tab).
 * Render server luôn có thanh mẹo: người dùng mới không bị xê dịch bố cục lúc hydrate (nút bấm không "nhảy" ngay khi
 * trang vừa tương tác được); người đã đóng sẽ thấy thanh biến mất ngay sau hydrate. Lỗi localStorage → vẫn hiện.
 */
export function TipBar() {
  const t = useT();
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => false);
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {
      /* bỏ qua */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  if (dismissed) return null;
  return (
    <div role="status" className="flex shrink-0 items-start gap-3 border-b bg-primary/5 px-4 py-2.5 text-sm" data-testid="tip-bar">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 line-clamp-4 flex-1 sm:line-clamp-none">
        <span className="font-medium">{t("tip.title")}: </span>
        {t("tip.body")}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={dismiss} data-testid="tip-dismiss">
        {t("tip.gotIt")}
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" onClick={dismiss} aria-label={t("tip.dismiss")}>
        <X />
      </Button>
    </div>
  );
}
