/**
 * Kiểu & tiện ích ghi chú dùng chung client + server.
 */

export type NoteOrigin = "manual" | "chat" | "team_chat" | "artifact";
export type NoteVisibility = "shared" | "private";

export type NoteDto = {
  id: string;
  notebookId: string;
  createdBy: string;
  title: string;
  contentMd: string;
  origin: NoteOrigin;
  originRef: Record<string, unknown> | null;
  visibility: NoteVisibility;
  /** Đã được thêm vào Nguồn (liên kết với một nguồn văn bản). */
  isSource: boolean;
  createdAt: string;
  updatedAt: string;
  /** Người gọi được phép sửa/xoá (tác giả hoặc admin+). */
  canManage: boolean;
};

/** Danh sách không kèm toàn văn (nhẹ). */
export type NoteListItem = Omit<NoteDto, "contentMd"> & { excerpt: string };

/** Tiêu đề hiển thị: tiêu đề do người dùng đặt, hoặc dòng đầu của nội dung. */
export function deriveNoteTitle(title: string, contentMd: string, fallback: string): string {
  const t = title.trim();
  if (t) return t;
  const first = contentMd
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s\d.[\]x]+/i, "").trim())
    .find(Boolean);
  return first ? first.slice(0, 80) : fallback;
}

/** Đoạn trích ngắn từ markdown (bỏ ký hiệu định dạng cơ bản). */
export function markdownExcerpt(md: string, max = 160): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

/** Tên tệp an toàn khi xuất ghi chú ra Markdown. */
export function noteFileName(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "ghi-chu"}.md`;
}
