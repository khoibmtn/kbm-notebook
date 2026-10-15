import { ApiError, handleRoute } from "@/server/api/errors";
import { getSession } from "@/server/auth/session";
import { findArtifactByToken, loadArtifactAccess, toDetailDto } from "@/server/artifacts/service";

type P = { token: string };

/**
 * Xem artifact qua liên kết chia sẻ — KHÔNG cần đăng nhập. Chỉ hợp lệ khi artifact đang ở chế độ `link` (hoặc `public`)
 * và token đúng; mọi trường hợp khác trả 404 chung để không lộ sự tồn tại. Trả bản chỉ đọc (không có share_token).
 */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { token } = await params;
  const row = await findArtifactByToken(token);
  if (!row || (row.visibility !== "link" && row.visibility !== "public")) throw ApiError.notFound("Liên kết không hợp lệ hoặc đã bị thu hồi");
  const session = await getSession().catch(() => null);
  const access = await loadArtifactAccess(session?.user.id ?? null, row.id, { shareToken: token });
  const detail = await toDetailDto({ ...access, canEdit: false, canManage: false });
  return { artifact: { ...detail, shareToken: null, generationConfig: null } };
});
