"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ClipboardEvent } from "react";

export type EditableTextProps = {
  value: string;
  placeholder?: string;
  /** true: Enter xác nhận (không xuống dòng). */
  singleLine?: boolean;
  onCommit: (value: string) => void;
  /** Enter trong danh sách bullet: tách chữ tại con trỏ. */
  onEnter?: (split: { before: string; after: string }) => void;
  /** Backspace khi ô trống (xoá bullet). */
  onBackspaceEmpty?: () => void;
  className?: string;
  style?: CSSProperties;
  field?: string;
  testId?: string;
};

/** Vị trí con trỏ (số ký tự tính từ đầu) trong phần tử contentEditable; null nếu không có selection trong nó. */
function caretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.anchorNode as Node, sel.anchorOffset);
  return range.toString().length;
}

/**
 * Ô chữ sửa trực tiếp (contentEditable) — chỉ nhận văn bản thuần (dán sẽ bỏ định dạng).
 * Chỉ "commit" khi mất focus hoặc Enter để mỗi lần sửa là một bước undo.
 */
export function EditableText({
  value,
  placeholder,
  singleLine = true,
  onCommit,
  onEnter,
  onBackspaceEmpty,
  className,
  style,
  field,
  testId,
}: EditableTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Văn bản ban đầu được render làm children (để SSR có chữ); sau đó DOM do người dùng/useLayoutEffect quản lý.
  const [initial] = useState(value);

  // Đồng bộ DOM với `value` khi không đang gõ (tránh nhảy con trỏ).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value && document.activeElement !== el) el.textContent = value;
  }, [value]);

  const read = (el: HTMLElement) => (el.textContent ?? "").replace(/\s*\n\s*/g, " ");

  const commit = (el: HTMLElement) => {
    const next = read(el);
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (e.key === "Escape") {
      el.textContent = value;
      el.blur();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (onEnter) {
        const text = read(el);
        const at = caretOffset(el) ?? text.length;
        const before = text.slice(0, at).trimEnd();
        el.textContent = before; // để lần blur sau đó không ghi đè bằng văn bản cũ
        onEnter({ before, after: text.slice(at).trimStart() });
      } else if (singleLine) {
        el.blur();
      }
      return;
    }
    if (e.key === "Backspace" && onBackspaceEmpty && read(el) === "") {
      e.preventDefault();
      onBackspaceEmpty();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ");
    if (!document.execCommand("insertText", false, text)) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      }
    }
  };

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label={placeholder}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-editable="true"
      data-field={field}
      data-testid={testId ?? (field ? `edit-${field}` : undefined)}
      data-placeholder={placeholder}
      className={className}
      style={style}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      {initial}
    </div>
  );
}
