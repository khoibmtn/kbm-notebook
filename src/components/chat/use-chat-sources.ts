"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useRealtimeEvent } from "@/lib/realtime";
import type { SourceDto, SourceStatusEvent } from "@/lib/sources";

/**
 * Danh sách nguồn (nhẹ, không toast) cho bộ chọn phạm vi và gợi ý câu hỏi của Chat.
 * Tự tải lại khi nguồn đổi (realtime `source:status`).
 */
export function useChatSources(notebookId: string) {
  const [sources, setSources] = useState<SourceDto[] | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await api<{ sources: SourceDto[] }>(`/api/notebooks/${notebookId}/sources`);
      setSources(res.sources);
    } catch {
      setSources((cur) => cur ?? []);
    }
  }, [notebookId]);

  useEffect(() => {
    let cancelled = false;
    api<{ sources: SourceDto[] }>(`/api/notebooks/${notebookId}/sources`)
      .then((res) => {
        if (!cancelled) setSources(res.sources);
      })
      .catch(() => {
        if (!cancelled) setSources((cur) => cur ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId]);

  useRealtimeEvent<SourceStatusEvent>("source:status", (ev) => {
    if (ev.notebookId !== notebookId) return;
    if (ev.change !== "status" || ev.status === "ready" || ev.status === "failed") void reload();
  });

  return { sources, reload };
}
