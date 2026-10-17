/** Kiểu + tiện ích dùng chung cho Explore / công khai / nhóm / tìm kiếm (client + server). */
import type { ArtifactTypeName } from "@/lib/artifacts/content";

export const EXPLORE_PAGE_SIZE = 24;

export type ExploreSort = "new" | "likes";

export type AuthorDto = { id: string; name: string; image: string | null };

export type ExploreArtifactDto = {
  id: string;
  type: ArtifactTypeName;
  title: string;
  createdAt: string;
  author: AuthorDto;
  /** Chỉ có khi sổ tay chứa artifact đang công khai; ngược lại hiển thị "Sổ tay riêng". */
  notebook: { title: string; slug: string } | null;
  likeCount: number;
  commentCount: number;
};

export type ExploreNotebookDto = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  emoji: string | null;
  coverColor: string | null;
  ownerName: string;
  publicArtifactCount: number;
  updatedAt: string;
};

export type GroupRole = "owner" | "admin" | "member";

export type GroupSummaryDto = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: "private" | "public";
  memberCount: number;
  notebookCount: number;
  /** Vai trò của người xem trong nhóm (null nếu chưa tham gia). */
  myRole: GroupRole | null;
};

export type Paged<T> = { items: T[]; page: number; hasMore: boolean };

export type CommentDto = {
  id: string;
  body: string;
  createdAt: string;
  author: AuthorDto;
  canDelete: boolean;
};

export type SocialSummaryDto = {
  likeCount: number;
  commentCount: number;
  liked: boolean;
  /** Đã đăng nhập (và xem được artifact) → được thích/bình luận. */
  canInteract: boolean;
};

export type PublicNotebookDto = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  emoji: string | null;
  coverColor: string | null;
  ownerName: string;
  artifacts: { id: string; type: ArtifactTypeName; title: string; createdAt: string; likeCount: number; commentCount: number }[];
};

export type JoinRequestStatus = "pending" | "accepted" | "rejected";

export type JoinRequestDto = {
  id: string;
  notebookId: string;
  status: JoinRequestStatus;
  message: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; image: string | null };
};

/* ------------------------------ Tìm kiếm toàn cục ------------------------------ */

export const SEARCH_TYPES = ["notebooks", "sources", "notes", "artifacts", "messages", "public"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Ký tự đánh dấu đoạn khớp trong snippet (an toàn: không bao giờ chèn HTML). */
export const HL_START = "\u0001";
export const HL_END = "\u0002";

export type SearchResultDto = {
  type: SearchType;
  id: string;
  title: string;
  /** Tiêu đề với từ khớp được đánh dấu bằng `HL_START`/`HL_END`. */
  titleHl: string;
  /** Đoạn trích có đánh dấu khớp bằng `HL_START`/`HL_END`. */
  snippet: string | null;
  href: string;
  notebookId: string | null;
  notebookTitle: string | null;
  /** Thông tin phụ (loại artifact, kênh, tác giả, trang…). */
  meta: { kind?: string; channel?: string | null; author?: string | null; page?: number | null; createdAt?: string | null };
};

export type SearchResponseDto = {
  query: string;
  groups: Record<SearchType, SearchResultDto[]>;
};

/** Tách snippet thành các đoạn (khớp / không khớp) để render bằng `<mark>`. */
export function splitHighlight(snippet: string): { text: string; match: boolean }[] {
  const out: { text: string; match: boolean }[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const s = rest.indexOf(HL_START);
    if (s === -1) {
      out.push({ text: rest.replaceAll(HL_END, ""), match: false });
      break;
    }
    if (s > 0) out.push({ text: rest.slice(0, s).replaceAll(HL_END, ""), match: false });
    const e = rest.indexOf(HL_END, s + 1);
    if (e === -1) {
      out.push({ text: rest.slice(s + 1), match: true });
      break;
    }
    out.push({ text: rest.slice(s + 1, e), match: true });
    rest = rest.slice(e + 1);
  }
  return out.filter((p) => p.text.length > 0);
}

/* ------------------------------------ Slug ------------------------------------ */

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 60;

/** "Sinh học tế bào 101" → "sinh-hoc-te-bao-101" (bỏ dấu tiếng Việt, chỉ a-z0-9 và gạch ngang). */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}
