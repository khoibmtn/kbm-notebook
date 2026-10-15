"use client";
import { Download, File as FileIcon, FileText, FolderInput, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-client";
import { formatBytes, isInlineImage } from "@/lib/team-chat/format";
import type { AttachmentDTO } from "@/lib/team-chat/types";

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("text/") || mime.includes("pdf") || mime.includes("word") || mime.includes("document")) return FileText;
  return FileIcon;
}

/** Tệp đính kèm: ảnh hiển thị inline, tệp khác là thẻ (tên, dung lượng, tải xuống). */
export function AttachmentList({
  attachments,
  canAddToSources,
  onAddToSources,
}: {
  attachments: AttachmentDTO[];
  canAddToSources: boolean;
  onAddToSources: (a: AttachmentDTO) => void;
}) {
  const t = useT();
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5" data-testid="message-attachments">
      {attachments.map((a) => {
        if (isInlineImage(a.mime)) {
          return (
            <a key={a.id} href={`/api/files/${a.fileId}`} target="_blank" rel="noopener noreferrer" className="block w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element -- tệp có kiểm quyền qua cookie, không tối ưu được bằng next/image */}
              <img
                src={`/api/files/${a.fileId}`}
                alt={a.name}
                loading="lazy"
                className="max-h-64 max-w-full rounded-lg border bg-background object-contain"
              />
            </a>
          );
        }
        const Icon = iconFor(a.mime);
        return (
          <div key={a.id} className="flex items-center gap-2 rounded-lg border bg-background/70 p-2 text-foreground">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{a.name}</div>
              <div className="text-xs text-muted-foreground">{formatBytes(a.size)}</div>
            </div>
            {canAddToSources && (
              <Button variant="ghost" size="icon" className="size-8" onClick={() => onAddToSources(a)} aria-label={t("team.msg.toSource")} title={t("team.msg.toSource")}>
                <FolderInput />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <a href={`/api/files/${a.fileId}?download=1`} aria-label={t("team.attachment.download")} title={t("team.attachment.download")}>
                <Download />
              </a>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
