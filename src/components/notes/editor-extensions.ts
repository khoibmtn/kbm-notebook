import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/react";

/**
 * Bộ extension của trình soạn ghi chú: starter-kit (đã gồm link, danh sách), danh sách việc cần làm, bảng
 * và `@tiptap/markdown` để lưu/đọc Markdown (`content_md`).
 */
export function noteExtensions(placeholder = ""): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    Markdown,
  ];
}
