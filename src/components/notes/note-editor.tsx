"use client";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  CheckCheck,
  CheckSquare,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";
import { useT } from "@/lib/i18n-client";
import { normalizeEditorMarkdown } from "@/lib/markdown";
import type { NoteDto } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { noteExtensions } from "./editor-extensions";

export const AUTOSAVE_DELAY_MS = 800;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function ToolbarButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8 shrink-0", active && "bg-accent text-accent-foreground")}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const t = useT();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  function setLink() {
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt(t("notes.editor.linkPrompt"), prev);
    if (url === null) return;
    if (url.trim() === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1" role="toolbar" aria-label={t("notes.editor.toolbar")} data-testid="note-toolbar">
      <ToolbarButton label={t("notes.editor.undo")} disabled={!s.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.redo")} disabled={!s.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton label={t("notes.editor.h1")} active={s.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        <Heading1 />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.h2")} active={s.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.h3")} active={s.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
        <Heading3 />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton label={t("notes.editor.bold")} active={s.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.italic")} active={s.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.strike")} active={s.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.code")} active={s.code} onClick={() => chain().toggleCode().run()}>
        <Code />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.link")} active={s.link} onClick={setLink}>
        <Link2 />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton label={t("notes.editor.bullet")} active={s.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.ordered")} active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.task")} active={s.task} onClick={() => chain().toggleTaskList().run()}>
        <CheckSquare />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.quote")} active={s.quote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.codeBlock")} active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <Code2 />
      </ToolbarButton>
      <ToolbarButton label={t("notes.editor.table")} active={s.table} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} disabled={s.table}>
        <Table2 />
      </ToolbarButton>
      {s.table && (
        <ToolbarButton label={t("notes.editor.deleteTable")} onClick={() => chain().deleteTable().run()}>
          <Trash2 />
        </ToolbarButton>
      )}
    </div>
  );
}

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

  const editor = useEditor({
    extensions: noteExtensions(t("notes.editor.placeholder")),
    content: note.contentMd,
    contentType: "markdown",
    editable: canEdit,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "note-prose min-h-[40vh] px-4 py-3 text-[15px] leading-relaxed outline-none",
        "aria-label": t("notes.editor.content"),
        "data-testid": "note-content",
      },
    },
    onUpdate: ({ editor: e }) => {
      latestMd.current = normalizeEditorMarkdown(e.getMarkdown());
      if (canEdit) schedule();
    },
  });

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
      {canEdit && editor && <Toolbar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
        {!canEdit && <p className="px-4 pb-4 text-xs text-muted-foreground">{t("notes.readOnly")}</p>}
      </div>
    </div>
  );
}
