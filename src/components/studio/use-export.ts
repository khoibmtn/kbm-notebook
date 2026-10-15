"use client";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api-client";
import type { ArtifactExportDto, ArtifactExportEvent, ExportFormat } from "@/lib/artifacts/meta";
import { useT } from "@/lib/i18n-client";
import { useRealtimeEvent } from "@/lib/realtime";
import { FORMAT_LABEL_KEY } from "./type-meta";

/** Kích hoạt tải xuống một URL (tệp xuất được phục vụ qua `/api/files/[id]`). */
export function triggerDownload(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type ExportJobInfo = { id: string; status: string; error: string | null; exportId: string | null };

const POLL_MS = 2000;
const TIMEOUT_MS = 3 * 60_000;

/**
 * Xuất artifact + tải về. Định dạng nhẹ trả tệp ngay; PDF/PNG/SVG mind map chạy bằng job nên ta chờ sự kiện
 * realtime `artifact:export` (có hỏi lại định kỳ phòng khi mất socket) rồi tự tải.
 */
export function useArtifactExport() {
  const t = useT();
  const waiters = useRef(new Map<string, (ev: ArtifactExportEvent) => void>());

  useRealtimeEvent<ArtifactExportEvent>("artifact:export", (ev) => {
    waiters.current.get(ev.jobId)?.(ev);
  });

  const waitForJob = useCallback(
    (artifactId: string, jobId: string) =>
      new Promise<ArtifactExportDto>((resolve, reject) => {
        let finished = false;
        const done = (fn: () => void) => {
          if (finished) return;
          finished = true;
          waiters.current.delete(jobId);
          clearInterval(timer);
          clearTimeout(timeout);
          fn();
        };
        waiters.current.set(jobId, (ev) => {
          if (ev.status === "done" && ev.export) done(() => resolve(ev.export!));
          else done(() => reject(new Error(ev.error ?? t("studio.export.failed"))));
        });
        const timer = setInterval(async () => {
          try {
            const res = await api<{ exports: ArtifactExportDto[]; job: ExportJobInfo | null }>(`/api/artifacts/${artifactId}/exports?jobId=${jobId}`);
            if (res.job?.status === "done") {
              const exp = res.exports.find((e) => e.id === res.job?.exportId) ?? res.exports[0];
              if (exp) done(() => resolve(exp));
            } else if (res.job?.status === "failed") {
              const message = res.job.error ?? t("studio.export.failed");
              done(() => reject(new Error(message)));
            }
          } catch {
            /* thử lại ở lần sau */
          }
        }, POLL_MS);
        const timeout = setTimeout(() => done(() => reject(new Error(t("studio.export.timeout")))), TIMEOUT_MS);
      }),
    [t],
  );

  /** Xuất `format` rồi tải về; hiển thị toast tiến trình. Trả bản xuất hoặc null nếu lỗi. */
  const exportAs = useCallback(
    async (artifactId: string, format: ExportFormat, versionId?: string): Promise<ArtifactExportDto | null> => {
      const label = t(FORMAT_LABEL_KEY[format]);
      const toastId = toast.loading(t("studio.export.running", { format: label }));
      try {
        const res = await api<{ status: "done" | "queued"; export?: ArtifactExportDto; jobId?: string }>(`/api/artifacts/${artifactId}/export`, {
          method: "POST",
          json: { format, versionId },
        });
        const exp = res.export ?? (await waitForJob(artifactId, res.jobId!));
        toast.success(t("studio.export.done", { name: exp.fileName }), { id: toastId });
        triggerDownload(exp.url, exp.fileName);
        return exp;
      } catch (e) {
        toast.error(errorMessage(e, t("studio.export.failed")), { id: toastId });
        return null;
      }
    },
    [t, waitForJob],
  );

  return { exportAs };
}
