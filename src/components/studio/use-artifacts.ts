"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import type { ArtifactDto, ArtifactListResponse, ArtifactStatusEvent, CreateArtifactInput } from "@/lib/artifacts/meta";
import { useT } from "@/lib/i18n-client";
import { useRealtime, useRealtimeEvent } from "@/lib/realtime";
import type { SourceDto, SourceStatusEvent } from "@/lib/sources";
import { isSelectionInitialized, useSourceSelection } from "@/lib/use-source-selection";

const POLL_MS = 4000;

export type ArtifactProgress = { progress: number; stage?: string };

/**
 * Danh sách artifact của sổ tay + trạng thái realtime (`artifact:status`) + thao tác tạo/đổi tên/nhân bản/xoá/tạo lại.
 * Khi socket mất kết nối mà còn artifact đang tạo, tự tải lại định kỳ.
 */
export function useArtifacts(notebookId: string) {
  const t = useT();
  const { connected } = useRealtime();
  const [data, setData] = useState<ArtifactListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ArtifactProgress>>({});
  const base = `/api/notebooks/${notebookId}/artifacts`;

  const reload = useCallback(async () => {
    try {
      const res = await api<ArtifactListResponse>(base);
      setData(res);
      setError(null);
      return res;
    } catch (e) {
      setError(errorMessage(e, t("studio.loadError")));
      return null;
    }
  }, [base, t]);

  useEffect(() => {
    let cancelled = false;
    api<ArtifactListResponse>(base)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, t("studio.loadError")));
      });
    return () => {
      cancelled = true;
    };
  }, [base, t]);

  useRealtimeEvent<ArtifactStatusEvent>("artifact:status", (ev) => {
    if (ev.notebookId !== notebookId) return;
    if (ev.change === "status") {
      setProgress((p) => ({ ...p, [ev.artifactId]: { progress: ev.progress, stage: ev.stage } }));
      setData((d) => (d ? { ...d, artifacts: d.artifacts.map((a) => (a.id === ev.artifactId ? { ...a, status: ev.status, error: ev.error } : a)) } : d));
      return;
    }
    setProgress((p) => {
      if (!(ev.artifactId in p)) return p;
      const next = { ...p };
      delete next[ev.artifactId];
      return next;
    });
    void reload();
  });

  const busy = (data?.artifacts ?? []).some((a) => a.status === "queued" || a.status === "generating");
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });
  useEffect(() => {
    if (!busy || connected) return;
    const id = setInterval(() => void reloadRef.current(), POLL_MS);
    return () => clearInterval(id);
  }, [busy, connected]);

  const create = useCallback(
    async (input: CreateArtifactInput): Promise<ArtifactDto | null> => {
      try {
        const res = await api<{ artifact: ArtifactDto }>(base, { method: "POST", json: input });
        toast.success(t("studio.toast.creating", { name: res.artifact.title }));
        await reload();
        return res.artifact;
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
        return null;
      }
    },
    [base, reload, t],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      try {
        await api(`/api/artifacts/${id}`, { method: "PATCH", json: { title } });
        await reload();
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
      }
    },
    [reload, t],
  );

  const fork = useCallback(
    async (id: string) => {
      try {
        const res = await api<{ artifact: ArtifactDto }>(`/api/artifacts/${id}/fork`, { method: "POST" });
        toast.success(t("studio.toast.forked", { name: res.artifact.title }));
        await reload();
        return res.artifact;
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
        return null;
      }
    },
    [reload, t],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api(`/api/artifacts/${id}`, { method: "DELETE" });
        toast.success(t("studio.toast.deleted"));
        await reload();
        return true;
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
        return false;
      }
    },
    [reload, t],
  );

  return { artifacts: data?.artifacts ?? null, engines: data?.engines ?? null, error, progress, reload, create, rename, fork, remove };
}

/**
 * Phạm vi nguồn của Studio: nguồn `ready` được chọn ở cột Nguồn (`useSourceSelection`);
 * chưa từng chọn → mặc định mọi nguồn `ready`. Tự tải lại khi `source:status` đổi.
 */
export function useStudioScope(notebookId: string) {
  const { selectedIds } = useSourceSelection(notebookId);
  const [sources, setSources] = useState<SourceDto[] | null>(null);
  const base = `/api/notebooks/${notebookId}/sources`;

  const load = useCallback(async () => {
    try {
      const res = await api<{ sources: SourceDto[] }>(base);
      setSources(res.sources);
    } catch {
      /* giữ danh sách cũ */
    }
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    api<{ sources: SourceDto[] }>(base)
      .then((res) => {
        if (!cancelled) setSources(res.sources);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base]);

  useRealtimeEvent<SourceStatusEvent>("source:status", (ev) => {
    if (ev.notebookId === notebookId) void load();
  });

  const readyIds = (sources ?? []).filter((s) => s.status === "ready").map((s) => s.id);
  const initialized = isSelectionInitialized(notebookId);
  const selectedSet = new Set(selectedIds);
  const scopeIds = initialized ? readyIds.filter((id) => selectedSet.has(id)) : readyIds;
  return { loaded: sources !== null, readyCount: readyIds.length, scopeIds };
}
