import { handleRoute, parseQuery } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { listDriveFiles } from "@/server/connectors/drive";
import { driveListQuerySchema } from "@/lib/validators/connectors";

type P = { id: string };

/**
 * Tệp Google Drive của người dùng (gần đây, hoặc tìm theo `?q=`), dùng token OAuth đã lưu (tự làm mới khi hết hạn).
 * 412 `google_not_configured` / `drive_not_connected` / `drive_scope_missing` khi chưa sẵn sàng — UI hiện lời nhắc kết nối.
 */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "editor");
  const { q, pageToken } = parseQuery(driveListQuerySchema, req);
  return listDriveFiles(user.id, { q, pageToken });
});
