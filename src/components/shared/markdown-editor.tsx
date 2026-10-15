"use client";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Bold, Code, Heading1, Heading2, Heading3, Italic, List, ListOrdered, Quote, Redo2, Table2, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

export type MarkdownEditorProps = {
  /** Nội dung Markdown. */
  value: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="size-8"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const t = useT();
  const chain = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-2 py-1" role="toolbar" aria-label={t("studio.editor.toolbar")}>
      <ToolButton label={t("studio.editor.bold")} active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label={t("studio.editor.italic")} active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label={t("studio.editor.code")} active={editor.isActive("code")} onClick={() => chain().toggleCode().run()}>
        <Code />
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton label={t("studio.editor.h1")} active={editor.isActive("heading", { level: 1 })} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        <Heading1 />
      </ToolButton>
      <ToolButton label={t("studio.editor.h2")} active={editor.isActive("heading", { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        <Heading2 />
      </ToolButton>
      <ToolButton label={t("studio.editor.h3")} active={editor.isActive("heading", { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
        <Heading3 />
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton label={t("studio.editor.bullets")} active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton label={t("studio.editor.numbered")} active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolButton>
      <ToolButton label={t("studio.editor.quote")} active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
        <Quote />
      </ToolButton>
      <ToolButton label={t("studio.editor.table")} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table2 />
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton label={t("studio.editor.undo")} disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>
        <Undo2 />
      </ToolButton>
      <ToolButton label={t("studio.editor.redo")} disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>
        <Redo2 />
      </ToolButton>
    </div>
  );
}

/**
 * Trình soạn thảo Markdown dùng chung (Tiptap): vào/ra Markdown, tiêu đề, danh sách, bảng, trích dẫn, code.
 * `readOnly` ẩn thanh công cụ và khoá chỉnh sửa. Giá trị bên ngoài đổi (vd. khôi phục phiên bản) sẽ nạp lại vào editor.
 */
export function MarkdownEditor({ value, onChange, readOnly = false, placeholder, className, ariaLabel }: MarkdownEditorProps) {
  const lastEmitted = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: [StarterKit, Markdown, TableKit],
    content: value,
    contentType: "markdown",
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: "kbm-prose min-h-[16rem] px-4 py-3 focus:outline-none",
        "aria-label": ariaLabel ?? "Markdown",
        "data-placeholder": placeholder ?? "",
        "data-testid": "markdown-editor-content",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = ed.getMarkdown();
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
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-background", className)} data-testid="markdown-editor">
      {editor && !readOnly && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
