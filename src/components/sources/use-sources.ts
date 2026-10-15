"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { useRealtime, useRealtimeEvent } from "@/lib/realtime";
import type { SourceDto, SourceStatusEvent, SourceVisibility } from "@/lib/sources";

const POLL_MS = 4000;

/**
 * Danh sách nguồn của sổ tay + cập nhật realtime (`source:status`) + các thao tác sửa/xoá/xử lý lại.
 * Khi socket mất kết nối mà vẫn còn nguồn đang xử lý, tự tải lại định kỳ.
 */
export function useSources(notebookId: string, currentUserId: string) {
  const t = useT();
  const { connected } = useRealtime();
  const [sources, setSources] = useState<SourceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourcesRef = useRef<SourceDto[] | null>(null);
  const base = `/api/notebooks/${notebookId}/sources`;

  const apply = useCallback((next: SourceDto[] | null) => {
    sourcesRef.current = next;
    setSources(next);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await api<{ sources: SourceDto[] }>(base);
      apply(res.sources);
      setError(null);
      return res.sources;
    } catch (e) {
      setError(errorMessage(e, t("sources.loadError")));
      return null;
    }
  }, [base, apply, t]);

  // Tải lần đầu (không gọi setState đồng bộ trong effect).
  useEffect(() => {
    let cancelled = false;
    api<{ sources: SourceDto[] }>(base)
      .then((res) => {
        if (cancelled) return;
        apply(res.sources);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, t("sources.loadError")));
      });
    return () => {
      cancelled = true;
    };
  }, [base, apply, t]);

  // Báo kết quả xử lý cho chính người tạo nguồn.
  const notifyTransition = useCallback(
    (prev: SourceDto | undefined, ev: SourceStatusEvent, title: string) => {
      if (ev.createdBy !== currentUserId || !prev) return;
      const wasBusy = prev.status === "pending" || prev.status === "processing";
      if (wasBusy && ev.status === "ready") toast.success(t("sources.toast.ready", { title }));
      if (wasBusy && ev.status === "failed") toast.error(t("sources.toast.failed", { title, error: ev.error ?? t("common.error") }));
    },
    [currentUserId, t],
  );

  useRealtimeEvent<SourceStatusEvent>("source:status", (ev) => {
    if (ev.notebookId !== notebookId) return;
    const cur = sourcesRef.current;
    const known = cur?.find((s) => s.id === ev.sourceId);
    if (known && ev.change !== "deleted" && ev.change !== "created") {
      notifyTransition(known, ev, known.title);
      apply(
        (cur ?? []).map((s) =>
          s.id === ev.sourceId ? { ...s, status: ev.status, progress: ev.progress, error: ev.error, visibility: ev.visibility } : s,
        ),
      );
      // trạng thái cuối hoặc thay đổi nội dung/quyền → tải lại để lấy tiêu đề, số trang, tóm tắt…
      if (ev.change === "updated" || ev.status === "ready" || ev.status === "failed") void reload();
      return;
    }
    void reload();
  });

  const hasBusy = sources?.some((s) => s.status === "pending" || s.status === "processing") ?? false;
  useEffect(() => {
    if (!hasBusy || connected) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [hasBusy, connected, reload]);

  const rename = useCallback(
    async (id: string, title: string) => {
      await api(`${base}/${id}`, { method: "PATCH", json: { title } });
      toast.success(t("sources.toast.renamed"));
      await reload();
    },
    [base, reload, t],
  );

  const setVisibility = useCallback(
    async (id: string, visibility: SourceVisibility) => {
      await api(`${base}/${id}`, { method: "PATCH", json: { visibility } });
      toast.success(t(visibility === "private" ? "sources.toast.madePrivate" : "sources.toast.madeShared"));
      await reload();
    },
    [base, reload, t],
  );

  const remove = useCallback(
    async (id: string) => {
      await api(`${base}/${id}`, { method: "DELETE" });
      toast.success(t("sources.toast.deleted"));
      await reload();
    },
    [base, reload, t],
  );

  const reprocess = useCallback(
    async (id: string) => {
      await api(`${base}/${id}/reprocess`, { method: "POST" });
      toast.success(t("sources.toast.reprocessing"));
      await reload();
    },
    [base, reload, t],
  );

  return { sources, error, reload, rename, setVisibility, remove, reprocess };
}
