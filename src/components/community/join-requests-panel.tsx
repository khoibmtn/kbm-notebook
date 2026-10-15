"use client";
import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import type { JoinRequestDto } from "@/lib/community";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { useRealtimeEvent } from "@/lib/realtime";

/** Yêu cầu tham gia đang chờ (admin+): chấp nhận → thêm làm Người xem; từ chối. Tự ẩn khi không có yêu cầu nào. */
export function JoinRequestsPanel({ notebookId, onChanged }: { notebookId: string; onChanged?: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [requests, setRequests] = useState<JoinRequestDto[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<{ requests: JoinRequestDto[] }>(`/api/notebooks/${notebookId}/join-requests`)
      .then((r) => {
        if (!cancelled) setRequests(r.requests);
      })
      .catch(() => {
        if (!cancelled) setRequests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, version]);

  useRealtimeEvent("member:changed", reload);

  async function decide(r: JoinRequestDto, action: "accept" | "reject") {
    setBusyId(r.id);
    try {
      await api(`/api/notebooks/${notebookId}/join-requests/${r.id}/${action}`, { method: "POST" });
      toast.success(t(action === "accept" ? "community.requests.accepted" : "community.requests.rejected", { name: r.user.name }));
      setRequests((rs) => rs.filter((x) => x.id !== r.id));
      if (action === "accept") onChanged?.();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
      reload();
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="join-requests-title" data-testid="join-requests">
      <h3 id="join-requests-title" className="text-sm font-medium">
        {t("community.requests.title")} ({requests.length})
      </h3>
      <ul className="divide-y rounded-lg border">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="join-request-item">
            <UserAvatar name={r.user.name} image={r.user.image} />
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate text-sm font-medium">{r.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {r.user.email} · {formatRelative(r.createdAt, locale)}
              </p>
              {r.message && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.message}</p>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void decide(r, "accept")} disabled={busyId === r.id} data-testid="join-accept">
                {busyId === r.id ? <Loader2 className="animate-spin" /> : <Check />} {t("community.requests.accept")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void decide(r, "reject")} disabled={busyId === r.id} data-testid="join-reject">
                <X /> {t("community.requests.reject")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
