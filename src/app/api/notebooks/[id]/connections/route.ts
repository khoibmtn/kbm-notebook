import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { createConnection, listConnections } from "@/server/connectors/connections";
import { createConnectionSchema } from "@/lib/validators/connectors";

type P = { id: string };

/**
 * Kết nối ngoài của sổ tay (viewer+): nhãn, provider, trạng thái, nguồn đã cache. Credential KHÔNG BAO GIỜ có trong kết quả;
 * thành viên chỉ thấy danh sách nguồn của kết nối mà họ dùng được (của mình hoặc đã chia sẻ).
 */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "viewer");
  return { connections: await listConnections(id, { userId: user.id, role }) };
});

/**
 * Tạo kết nối (editor+): kiểm tra thật bằng credential hiện tại của người tạo (Bridge `GET /notebooks/{id}`),
 * chụp credential vào `credential_enc`, cache nguồn.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const data = await parseBody(createConnectionSchema, req);
  const connection = await createConnection({ notebookId: id, userId: user.id, role, data });
  return Response.json({ connection }, { status: 201 });
});
