"use client";
import { useCallback } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import type { ConnectionDto } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";
import { notifyConnectionsChanged } from "./use-connections";

/**
 * Ghi ngược sang NotebookLM. Thành công/thất bại đều lấy từ phản hồi thật của server (Bridge); lỗi được ném lại sau khi toast
 * để nơi gọi giữ đúng trạng thái nút.
 */
export function usePushToNotebookLm(notebookId: string) {
  const t = useT();

  const pushNote = useCallback(
    async (connection: ConnectionDto, title: string, content: string) => {
      try {
        await api(`/api/notebooks/${notebookId}/connections/${connection.id}/notes`, { method: "POST", json: { title, content } });
        toast.success(t("connectors.push.noteDone", { label: connection.label }));
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
        throw e;
      } finally {
        notifyConnectionsChanged(notebookId); // trạng thái kết nối có thể đổi sau lời gọi thật
      }
    },
    [notebookId, t],
  );

  const pushSource = useCallback(
    async (connection: ConnectionDto, sourceId: string) => {
      try {
        await api(`/api/notebooks/${notebookId}/connections/${connection.id}/sources`, { method: "POST", json: { sourceId } });
        toast.success(t("connectors.push.sourceDone", { label: connection.label }));
      } catch (e) {
        toast.error(errorMessage(e, t("common.error")));
        throw e;
      } finally {
        notifyConnectionsChanged(notebookId);
      }
    },
    [notebookId, t],
  );

  return { pushNote, pushSource };
}
