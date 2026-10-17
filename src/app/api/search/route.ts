import { handleRoute, parseQuery } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { globalSearch } from "@/server/search/global";
import { globalSearchQuery } from "@/lib/validators/community";

/**
 * Tìm kiếm toàn cục: `GET /api/search?q=&types=notebooks,sources,notes,artifacts,messages,public&notebookId=&limit=`.
 * Kết quả nhóm theo loại, chỉ trong sổ tay người gọi là thành viên (nguồn/ghi chú/artifact riêng và DM của người khác bị loại).
 */
export const GET = handleRoute(async (req) => {
  const { user } = await requireUser();
  const { q, types, notebookId, limit } = parseQuery(globalSearchQuery, req);
  if (notebookId) await requireNotebookRole(user.id, notebookId, "viewer");
  return globalSearch({ userId: user.id, q, types, notebookId, limit });
});
