import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { deleteConnection, updateConnection } from "@/server/connectors/connections";
import { updateConnectionSchema } from "@/lib/validators/connectors";

type P = { id: string; connectionId: string };

/** Đổi nhãn, bật/tắt chia sẻ với thành viên, cập nhật thông tin xác thực (chủ kết nối); đổi nhãn cũng cho admin+. */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { id, connectionId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const data = await parseBody(updateConnectionSchema, req);
  return { connection: await updateConnection({ notebookId: id, connectionId, userId: user.id, role, data }) };
});

/** Gỡ kết nối: người tạo (editor+) hoặc admin+ (mọi kết nối). */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { id, connectionId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  await deleteConnection({ notebookId: id, connectionId, userId: user.id, role });
  return { ok: true };
});
