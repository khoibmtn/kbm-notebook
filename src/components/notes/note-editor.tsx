"use client";
import { CheckCheck, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { normalizeEditorMarkdown } from "@/lib/markdown";
import type { NoteDto } from "@/lib/notes";

export const AUTOSAVE_DELAY_MS = 800;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

type Props = {
  note: NoteDto;
  canEdit: boolean;
  /** Gọi sau mỗi lần lưu thành công (cập nhật danh sách). */
  onSaved: (note: NoteDto) => void;
  /** Hàng nút hành động bên phải thanh tiêu đề. */
  actions?: ReactNode;
};

/**
 * Trình soạn ghi chú Tiptap: nội dung lưu dạng Markdown (`content_md`), tự động lưu (debounce) bằng PATCH,
 * lưu nốt khi đóng/chuyển ghi chú. Dùng `key={note.id}` ở nơi gọi để tạo lại khi đổi ghi chú.
 */
export function NoteEditor({ note, canEdit, onSaved, actions }: Props) {
  const t = useT();
  const [title, setTitle] = useState(note.title);
  /** Giá trị nạp ban đầu (cố định): lưu xong không nạp lại vào trình soạn để không làm nhảy con trỏ. */
  const [initialContent] = useState(note.contentMd);
  const [state, setState] = useState<SaveState>("idle");
  const initialMd = normalizeEditorMarkdown(note.contentMd);
  const saved = useRef({ title: note.title, md: initialMd });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const again = useRef(false);
  const titleRef = useRef(note.title);
  const onSavedRef = useRef(onSaved);
  /** Markdown mới nhất của trình soạn (còn dùng được sau khi editor bị huỷ lúc unmount). */
  const latestMd = useRef(initialMd);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const flush = useCallback(
    async (opts: { keepalive?: boolean } = {}) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (inflight.current) {
        again.current = true;
        return;
      }
      const md = latestMd.current;
      const nextTitle = titleRef.current;
      if (md === saved.current.md && nextTitle === saved.current.title) {
        setState((s) => (s === "dirty" ? "saved" : s));
        return;
      }
      inflight.current = true;
      setState("saving");
      try {
        const res = await api<{ note: NoteDto }>(`/api/notebooks/${note.notebookId}/notes/${note.id}`, {
          method: "PATCH",
          json: { title: nextTitle, contentMd: md },
          keepalive: opts.keepalive,
        });
        saved.current = { title: nextTitle, md };
        // Tiêu đề rỗng được server suy ra từ nội dung: phản ánh lại nếu người dùng chưa gõ thêm.
        if (!nextTitle.trim() && titleRef.current === nextTitle) {
          titleRef.current = res.note.title;
          setTitle(res.note.title);
          saved.current.title = res.note.title;
        }
        setState("saved");
        onSavedRef.current(res.note);
      } catch {
        setState("error");
      } finally {
        inflight.current = false;
        if (again.current) {
          again.current = false;
          void flush();
        }
      }
    },
    [note.id, note.notebookId],
  );

  const schedule = useCallback(() => {
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }, [flush]);

  const onContentChange = useCallback(
    (md: string) => {
      latestMd.current = md;
      if (canEdit) schedule();
    },
    [canEdit, schedule],
  );

  // Lưu nốt khi rời đi / đóng tab.
  useEffect(() => {
    const onHide = () => void flush({ keepalive: true });
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush({ keepalive: true });
    };
  }, [flush]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="note-editor">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            if (canEdit) schedule();
          }}
          readOnly={!canEdit}
          maxLength={200}
          placeholder={t("notes.editor.titlePlaceholder")}
          aria-label={t("notes.editor.title")}
          data-testid="note-title"
          className="h-9 border-0 bg-transparent px-1 text-base font-semibold shadow-none focus-visible:ring-0"
        />
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" role="status" data-testid="save-state" data-state={state}>
          {state === "saving" && (
            <>
              <Loader2 className="size-3 animate-spin" /> {t("notes.save.saving")}
            </>
          )}
          {state === "dirty" && t("notes.save.dirty")}
          {state === "saved" && (
            <>
              <CheckCheck className="size-3.5 text-emerald-600" /> {t("notes.save.saved")}
            </>
          )}
          {state === "error" && (
            <span className="flex items-center gap-1 text-destructive">
              <TriangleAlert className="size-3.5" /> {t("notes.save.error")}
            </span>
          )}
        </span>
        {actions}
      </div>
      <MarkdownEditor
        value={initialContent}
        onChange={onContentChange}
        readOnly={!canEdit}
        placeholder={t("notes.editor.placeholder")}
        ariaLabel={t("notes.editor.content")}
        className="min-h-0 flex-1 rounded-none border-0"
        contentClassName="kbm-prose min-h-[40vh] px-4 py-3 outline-none"
        contentTestId="note-content"
        toolbarTestId="note-toolbar"
      />
      {!canEdit && <p className="px-4 pb-4 text-xs text-muted-foreground">{t("notes.readOnly")}</p>}
    </div>
  );
}
