"use client";
import {
  ArrowLeft,
  BookMarked,
  Download,
  FilePlus2,
  FileText,
  Loader2,
  Lock,
  LockOpen,
  MessageSquare,
  MoreHorizontal,
  Search,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useNotebook } from "@/components/notebook/notebook-context";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api-client";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import type { MessageKey } from "@/lib/i18n";
import { noteFileName, type NoteDto, type NoteListItem, type NoteOrigin } from "@/lib/notes";
import { hasRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { NoteEditor } from "./note-editor";
import { useShareToChat } from "@/components/team-chat/share-to-chat-provider";

const ORIGIN_LABEL: Record<NoteOrigin, MessageKey> = {
  manual: "notes.origin.manual",
  chat: "notes.origin.chat",
  team_chat: "notes.origin.teamChat",
  artifact: "notes.origin.artifact",
};

export function NoteOriginBadge({ origin }: { origin: NoteOrigin }) {
  const t = useT();
  return (
    <Badge variant={origin === "manual" ? "outline" : "secondary"} className="h-5 gap-1 px-1.5 text-[10px] font-normal" data-testid="note-origin" data-origin={origin}>
      {origin === "chat" || origin === "team_chat" ? <MessageSquare className="size-3" aria-hidden /> : null}
      {t(ORIGIN_LABEL[origin])}
    </Badge>
  );
}

function downloadMarkdown(note: Pick<NoteDto, "title" | "contentMd">) {
  const body = `# ${note.title}\n\n${note.contentMd}\n`;
  const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = noteFileName(note.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = {
  /** Mở sẵn một ghi chú (vd. vừa tạo từ chat). */
  initialNoteId?: string | null;
  /**
   * Móc "Chia sẻ vào chat nhóm" — mô-đun Chat nhóm (P4) sẽ truyền callback mở hộp thoại chia sẻ.
   * Không truyền thì mục này không hiện.
   */
  onShareToChat?: (note: NoteDto) => void;
  /** Cột hẹp (tab trong cột giữa): luôn hiển thị danh sách HOẶC trình soạn, không chia hai khung. */
  compact?: boolean;
  className?: string;
};

/** Mô-đun Ghi chú: danh sách + tìm kiếm, trình soạn Tiptap (Markdown), thêm vào Nguồn, xuất Markdown. */
export function NotesPanel({ initialNoteId = null, onShareToChat: onShareProp, compact = false, className }: Props) {
  const shareToChat = useShareToChat();
  // Mặc định dùng hộp "Chia sẻ vào chat" của sổ tay; chỉ ghi chú dùng chung (không riêng tư) mới chia sẻ được.
  const onShareToChat = onShareProp ?? (shareToChat ? (n: NoteDto) => shareToChat({ type: "note", id: n.id, title: n.title }) : undefined);
  const t = useT();
  const { locale } = useLocale();
  const { notebook, role } = useNotebook();
  const canCreate = hasRole(role, "editor");
  const base = `/api/notebooks/${notebook.id}/notes`;

  const [items, setItems] = useState<NoteListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId);
  /** Bản mới nhất (menu hành động, huy hiệu); `editorNote` chỉ dùng để khởi tạo trình soạn một lần. */
  const [note, setNote] = useState<NoteDto | null>(null);
  const [editorNote, setEditorNote] = useState<NoteDto | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [deleting, setDeleting] = useState<NoteDto | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    async (q = query) => {
      try {
        const res = await api<{ notes: NoteListItem[] }>(`${base}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
        setItems(res.notes);
      } catch (e) {
        toast.error(errorMessage(e, t("notes.error.load")));
        setItems((cur) => cur ?? []);
      }
    },
    [base, query, t],
  );

  // Tải danh sách, tìm kiếm có debounce.
  useEffect(() => {
    const timer = setTimeout(() => void reload(query), query ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy lại khi từ khoá đổi
  }, [query, base]);

  // Nạp ghi chú đang chọn (đầy đủ nội dung).
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    api<{ note: NoteDto }>(`${base}/${selectedId}`)
      .then((res) => {
        if (cancelled) return;
        setNote(res.note);
        setEditorNote(res.note);
        setNoteLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(errorMessage(e, t("notes.error.load")));
        setSelectedId(null);
        setNoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, base, t]);

  function open(id: string) {
    if (id === selectedId) return;
    setNote(null);
    setEditorNote(null);
    setNoteLoading(true);
    setSelectedId(id);
  }

  async function createNote() {
    setBusy(true);
    try {
      const res = await api<{ note: NoteDto }>(base, { method: "POST", json: { title: "", contentMd: "" } });
      await reload("");
      setQuery("");
      setNote(res.note);
      setEditorNote(res.note);
      setNoteLoading(false);
      setSelectedId(res.note.id);
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  const onSaved = useCallback(
    (saved: NoteDto) => {
      setNote((cur) => (cur && cur.id === saved.id ? saved : cur));
      setItems((cur) => {
        if (!cur) return cur;
        const { contentMd, ...rest } = saved;
        const excerpt = contentMd.replace(/[#>*_`|~-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
        const updated: NoteListItem = { ...rest, excerpt };
        return [updated, ...cur.filter((n) => n.id !== saved.id)];
      });
    },
    [],
  );

  async function patchVisibility(n: NoteDto) {
    try {
      const visibility = n.visibility === "shared" ? "private" : "shared";
      const res = await api<{ note: NoteDto }>(`${base}/${n.id}`, { method: "PATCH", json: { visibility } });
      setNote(res.note);
      await reload();
      toast.success(t(visibility === "private" ? "notes.toast.madePrivate" : "notes.toast.madeShared"));
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  }

  async function addToSources(n: NoteDto) {
    try {
      const res = await api<{ note: NoteDto }>(`${base}/${n.id}/to-source`, { method: "POST" });
      setNote(res.note);
      await reload();
      toast.success(t("notes.toast.addedToSources"));
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`${base}/${deleting.id}`, { method: "DELETE" });
      toast.success(t("notes.toast.deleted"));
      if (selectedId === deleting.id) {
        setSelectedId(null);
        setNote(null);
        setEditorNote(null);
      }
      setDeleting(null);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  const showEditorOnMobile = selectedId !== null;

  return (
    <div className={cn("flex min-h-0 flex-1", className)} data-testid="notes-panel">
      {/* Danh sách */}
      <aside
        className={cn("w-full shrink-0 flex-col border-r", !compact && "md:flex md:w-72", showEditorOnMobile ? "hidden" : "flex", !compact && showEditorOnMobile && "md:flex")}
        aria-label={t("notes.list")}
      >
        <div className="space-y-2 border-b p-3">
          {canCreate && (
            <Button className="w-full" onClick={() => void createNote()} disabled={busy} data-testid="new-note">
              {busy ? <Loader2 className="animate-spin" /> : <FilePlus2 />} {t("notes.new")}
            </Button>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("notes.search")} aria-label={t("notes.search")} className="h-9 pl-8" data-testid="notes-search" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null && (
            <div className="space-y-2 p-3" aria-busy>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}
          {items?.length === 0 && (
            <EmptyState
              icon={FileText}
              title={query ? t("notes.noResults") : t("notes.emptyTitle")}
              description={query ? undefined : t("notes.emptyDescription")}
              className="p-6"
            />
          )}
          <ul className="space-y-0.5 p-1.5">
            {items?.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n.id)}
                  aria-current={n.id === selectedId ? "true" : undefined}
                  className={cn("w-full space-y-1 rounded-lg px-2.5 py-2 text-left hover:bg-accent", n.id === selectedId && "bg-accent")}
                  data-testid="note-item"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                    {n.visibility === "private" && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t("notes.private")} />}
                    {n.isSource && <BookMarked className="size-3 shrink-0 text-primary" aria-label={t("notes.isSource")} />}
                  </span>
                  {n.excerpt && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.excerpt}</span>}
                  <span className="flex items-center gap-2">
                    <NoteOriginBadge origin={n.origin} />
                    <span className="text-[11px] text-muted-foreground">{formatRelative(n.updatedAt, locale)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Trình soạn */}
      <section className={cn("min-w-0 flex-1 flex-col", showEditorOnMobile ? "flex" : compact ? "hidden" : "hidden md:flex")} aria-label={t("notes.editor.section")}>
        {!selectedId && (
          <EmptyState icon={FileText} title={t("notes.select.title")} description={t("notes.select.description")} />
        )}
        {selectedId && (noteLoading || !note || !editorNote) && (
          <div className="space-y-3 p-4" aria-busy>
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {selectedId && note && editorNote && !noteLoading && (
          <>
            <div className={cn("flex items-center gap-1 border-b px-2 py-1.5", !compact && "md:hidden")}>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedId(null); setNote(null); setEditorNote(null); }}>
                <ArrowLeft /> {t("notes.back")}
              </Button>
            </div>
            <NoteEditor
              key={editorNote.id}
              note={editorNote}
              canEdit={canCreate && note.canManage}
              onSaved={onSaved}
              actions={
                <div className="flex shrink-0 items-center gap-1">
                  <NoteOriginBadge origin={note.origin} />
                  {note.isSource && (
                    <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px] font-normal" data-testid="note-is-source">
                      <BookMarked className="size-3" aria-hidden /> {t("notes.isSource")}
                    </Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={t("notes.actions")} data-testid="note-menu">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {canCreate && note.canManage && (
                        <DropdownMenuItem disabled={note.isSource || !note.contentMd.trim()} onSelect={() => void addToSources(note)} data-testid="note-to-source">
                          <BookMarked /> {note.isSource ? t("notes.action.alreadySource") : t("notes.action.toSource")}
                        </DropdownMenuItem>
                      )}
                      {onShareToChat && note.visibility === "shared" && (
                        <DropdownMenuItem onSelect={() => onShareToChat(note)} data-testid="note-share-to-chat">
                          <Share2 /> {t("notes.action.shareToChat")}
                        </DropdownMenuItem>
                      )}
                      {canCreate && note.canManage && (
                        <DropdownMenuItem onSelect={() => void patchVisibility(note)}>
                          {note.visibility === "shared" ? <Lock /> : <LockOpen />}
                          {note.visibility === "shared" ? t("notes.action.makePrivate") : t("notes.action.makeShared")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => downloadMarkdown(note)} data-testid="note-export">
                        <Download /> {t("notes.action.export")}
                      </DropdownMenuItem>
                      {canCreate && note.canManage && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(note)}>
                            <Trash2 /> {t("common.delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              }
            />
            <p className="flex items-center gap-1.5 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
              {note.visibility === "private" ? <Lock className="size-3" aria-hidden /> : <Users className="size-3" aria-hidden />}
              {note.visibility === "private" ? t("notes.visibility.private") : t("notes.visibility.shared")}
              {note.isSource && <span> · {t("notes.syncHint")}</span>}
            </p>
          </>
        )}
      </section>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("notes.delete.title")}</DialogTitle>
            <DialogDescription>{t("notes.delete.description", { title: deleting?.title ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmDelete()}>
              {busy && <Loader2 className="animate-spin" />} {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
