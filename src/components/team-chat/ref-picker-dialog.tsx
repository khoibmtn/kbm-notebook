"use client";
import { FileText, FolderOpen, Loader2, Sparkles, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import type { RefType } from "@/lib/team-chat/types";

export type PickableItem = { id: string; title: string };

const ENDPOINT: Record<RefType, string> = {
  source: "sources",
  artifact: "artifacts",
  note: "notes",
};

type RawItem = { id?: unknown; title?: unknown; name?: unknown; visibility?: unknown; deletedAt?: unknown };

/** Chấp nhận cả `[...]` lẫn `{ sources: [...] }` / `{ items: [...] }` vì API các mô-đun khác có thể khác nhau. */
export function parsePickable(type: RefType, data: unknown): PickableItem[] {
  const list: unknown = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? ((data as Record<string, unknown>)[ENDPOINT[type]] ?? (data as Record<string, unknown>).items)
      : null;
  if (!Array.isArray(list)) return [];
  const out: PickableItem[] = [];
  for (const raw of list as RawItem[]) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : null;
    const title = typeof raw.title === "string" ? raw.title : typeof raw.name === "string" ? raw.name : null;
    if (!id || !title || raw.deletedAt) continue;
    // Mục riêng tư không chia sẻ vào chat được.
    if (raw.visibility === "private") continue;
    out.push({ id, title });
  }
  return out;
}

/**
 * Chọn một nguồn / artifact / note trong sổ tay để đăng vào chat. Mô-đun tương ứng có thể chưa có
 * ở thời điểm này (API 404) → hiển thị thông báo thay vì lỗi.
 */
export function RefPickerDialog({
  open,
  onOpenChange,
  notebookId,
  type,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notebookId: string;
  type: RefType;
  onPick: (item: PickableItem) => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const key = `${notebookId}:${type}`;
  const [result, setResult] = useState<{ key: string; items: PickableItem[] | null; unavailable: boolean } | null>(null);
  // Kết quả của lần mở trước (khác loại/sổ tay) coi như chưa có.
  const items = result?.key === key ? result.items : null;
  const unavailable = result?.key === key && result.unavailable;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<unknown>(`/api/notebooks/${notebookId}/${ENDPOINT[type]}`)
      .then((data) => {
        if (!cancelled) setResult({ key, items: parsePickable(type, data), unavailable: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, items: null, unavailable: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open, notebookId, type, key]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !query || i.title.toLowerCase().includes(query));
  }, [items, q]);

  const Icon = type === "artifact" ? Sparkles : type === "source" ? FolderOpen : StickyNote;
  const title = type === "artifact" ? t("team.composer.shareArtifact") : type === "source" ? t("team.composer.shareSource") : t("team.composer.shareNote");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("team.picker.description")}</DialogDescription>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("team.picker.search")} aria-label={t("team.picker.search")} />
        <ul className="max-h-72 space-y-0.5 overflow-y-auto" data-testid="ref-picker-list">
          {unavailable ? (
            <li className="p-4 text-center text-sm text-muted-foreground">{t("team.picker.unavailable")}</li>
          ) : items === null ? (
            <li className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
            </li>
          ) : shown.length === 0 ? (
            <li className="p-4 text-center text-sm text-muted-foreground">{t("team.picker.empty")}</li>
          ) : (
            shown.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(i);
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {type === "source" ? <FileText className="size-4" /> : <Icon className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{i.title}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
