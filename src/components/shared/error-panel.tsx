"use client";
import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";

/** Giao diện dùng chung cho `error.tsx` (ranh giới lỗi Next): thông báo tiếng Việt + nút "Thử lại" + về trang chủ. */
export function ErrorPanel({
  error,
  reset,
  titleKey = "error.title",
  descriptionKey = "error.description",
  homeKey = "error.home",
  className,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  titleKey?: MessageKey;
  descriptionKey?: MessageKey;
  homeKey?: MessageKey;
  className?: string;
}) {
  const t = useT();
  useEffect(() => {
    console.error("[ui] lỗi hiển thị", error);
  }, [error]);
  return (
    <div className={className ?? "flex min-h-[60vh] flex-1 items-center justify-center p-6"} role="alert" data-testid="error-panel">
      <EmptyState
        icon={AlertTriangle}
        title={t(titleKey)}
        description={t(descriptionKey)}
        action={
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={reset} data-testid="error-retry">
                <RotateCcw /> {t("error.retry")}
              </Button>
              <Button asChild variant="outline">
                <Link href="/">{t(homeKey)}</Link>
              </Button>
            </div>
            {error.digest && <p className="text-xs text-muted-foreground">{t("error.digest", { digest: error.digest })}</p>}
          </div>
        }
      />
    </div>
  );
}
