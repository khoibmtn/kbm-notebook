"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import type { ConnectionDto } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";

/** Sự kiện cửa sổ để các nơi dùng danh sách kết nối (cột Nguồn, Chat, Ghi chú) tự tải lại khi có thay đổi. */
const CHANGED_EVENT = "kbm:connections-changed";

export function notifyConnectionsChanged(notebookId: string): void {
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { notebookId } }));
}

/** Kết nối mà người dùng hiện tại ghi được ghi chú/nguồn vào (Bridge dùng được). */
export function writableBridgeConnections(list: ConnectionDto[] | null): ConnectionDto[] {
  return (list ?? []).filter((c) => c.provider === "notebooklm-bridge" && c.usable);
}

/** Kết nối dùng được cho hỏi đáp (có chat + dùng được). */
export function chatConnections(list: ConnectionDto[] | null): ConnectionDto[] {
  return (list ?? []).filter((c) => c.usable && c.supportsChat);
}

/**
 * Danh sách kết nối ngoài của sổ tay + thao tác (đồng bộ, chia sẻ, cập nhật credential, gỡ).
 * Trạng thái hiển thị đều lấy từ server (kết quả của lời gọi thật), không suy đoán ở client.
 */
export function useConnections(notebookId: string) {
  const t = useT();
  const base = `/api/notebooks/${notebookId}/connections`;
  const [connections, setConnections] = useState<ConnectionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await api<{ connections: ConnectionDto[] }>(base);
      setConnections(res.connections);
      setError(null);
      return res.connections;
    } catch (e) {
      setError(errorMessage(e, t("connectors.section.loadError")));
      return null;
    }
  }, [base, t]);

  useEffect(() => {
    let cancelled = false;
    api<{ connections: ConnectionDto[] }>(base)
      .then((res) => {
        if (cancelled) return;
        setConnections(res.connections);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, t("connectors.section.loadError")));
      });
    const onChanged = (ev: Event) => {
      const id = (ev as CustomEvent<{ notebookId?: string }>).detail?.notebookId;
      if (!id || id === notebookId) void reload();
    };
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED_EVENT, onChanged);
    };
  }, [base, notebookId, reload, t]);

  const afterChange = useCallback(async () => {
    await reload();
    notifyConnectionsChanged(notebookId);
  }, [notebookId, reload]);

  const sync = useCallback(
    async (id: string) => {
      try {
        await api(`${base}/${id}/sync`, { method: "POST" });
        toast.success(t("connectors.toast.synced"));
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
      } finally {
        await afterChange();
      }
    },
    [afterChange, base, t],
  );

  const setShared = useCallback(
    async (id: string, shared: boolean) => {
      try {
        await api(`${base}/${id}`, { method: "PATCH", json: { sharedWithMembers: shared } });
        toast.success(t(shared ? "connectors.toast.sharedOn" : "connectors.toast.sharedOff"));
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
      } finally {
        await afterChange();
      }
    },
    [afterChange, base, t],
  );

  const refreshCredentials = useCallback(
    async (id: string) => {
      try {
        await api(`${base}/${id}`, { method: "PATCH", json: { refreshCredentials: true } });
        toast.success(t("connectors.toast.credentialsRefreshed"));
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
      } finally {
        await afterChange();
      }
    },
    [afterChange, base, t],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api(`${base}/${id}`, { method: "DELETE" });
        toast.success(t("connectors.toast.removed"));
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
      } finally {
        await afterChange();
      }
    },
    [afterChange, base, t],
  );

  return useMemo(
    () => ({ connections, error, reload, afterChange, sync, setShared, refreshCredentials, remove }),
    [connections, error, reload, afterChange, sync, setShared, refreshCredentials, remove],
  );
}
