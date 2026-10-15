"use client";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
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
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n-client";
import { normalizeEditorMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { markdownExtensions } from "./markdown-extensions";

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

export function MarkdownToolbar({ editor, testId = "markdown-toolbar" }: { editor: Editor; testId?: string }) {
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
    <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1" role="toolbar" aria-label={t("notes.editor.toolbar")} data-testid={testId}>
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


export type MarkdownEditorProps = {
  /** Nội dung Markdown. */
  value: string;
  /** Gọi với Markdown đã chuẩn hoá (`normalizeEditorMarkdown`) mỗi khi người dùng sửa. */
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  /** Lớp của vùng nội dung (mặc định: `kbm-prose`, cao tối thiểu 16rem). */
  contentClassName?: string;
  ariaLabel?: string;
  /** `data-testid` của vùng nội dung / thanh công cụ. */
  contentTestId?: string;
  toolbarTestId?: string;
};

/**
 * Trình soạn thảo Markdown dùng chung (Tiptap) cho Ghi chú và Studio: vào/ra Markdown, tiêu đề, danh sách (kể cả
 * việc cần làm), bảng, trích dẫn, mã. `readOnly` ẩn thanh công cụ và khoá chỉnh sửa. Giá trị bên ngoài đổi
 * (vd. khôi phục phiên bản) sẽ nạp lại vào editor.
 */
export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  placeholder,
  className,
  contentClassName,
  ariaLabel,
  contentTestId = "markdown-editor-content",
  toolbarTestId,
}: MarkdownEditorProps) {
  const lastEmitted = useRef(normalizeEditorMarkdown(value));
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: markdownExtensions(placeholder ?? ""),
    content: value,
    contentType: "markdown",
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: contentClassName ?? "kbm-prose min-h-[16rem] px-4 py-3 focus:outline-none",
        "aria-label": ariaLabel ?? "Markdown",
        "data-testid": contentTestId,
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = normalizeEditorMarkdown(ed.getMarkdown());
      // Nạp ban đầu có thể phát "update" với đúng nội dung vừa nạp → không coi là thay đổi của người dùng.
      if (md === lastEmitted.current) return;
      lastEmitted.current = md;
      onChangeRef.current?.(md);
    },
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const next = normalizeEditorMarkdown(value);
    if (next === lastEmitted.current) return;
    lastEmitted.current = next;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  return (
    <TooltipProvider>
      <div className={cn("flex flex-col overflow-hidden rounded-xl border bg-background", className)} data-testid="markdown-editor">
        {editor && !readOnly && <MarkdownToolbar editor={editor} testId={toolbarTestId} />}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
    </TooltipProvider>
  );
}
