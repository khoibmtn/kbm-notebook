import { ApiError, handleRoute } from "@/server/api/errors";
import { getPublicNotebookBySlug } from "@/server/community/public-notebooks";

type P = { slug: string };

/**
 * Dữ liệu công khai của sổ tay (không cần đăng nhập): tiêu đề, mô tả, emoji, danh sách artifact CÔNG KHAI.
 * Không bao giờ có nguồn, ghi chú, hội thoại, tin nhắn hay danh sách thành viên.
 */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { slug } = await params;
  const nb = await getPublicNotebookBySlug(slug);
  if (!nb) throw ApiError.notFound("Không tìm thấy sổ tay công khai");
  return { notebook: nb };
});
