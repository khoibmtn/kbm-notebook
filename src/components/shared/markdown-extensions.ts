import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/react";

/**
 * Bộ extension Tiptap DUY NHẤT của ứng dụng (Ghi chú và Studio dùng chung): starter-kit (đã gồm link, danh sách),
 * danh sách việc cần làm, bảng và `@tiptap/markdown` để đọc/ghi Markdown.
 */
export function markdownExtensions(placeholder = ""): Extensions {
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
