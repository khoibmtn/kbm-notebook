import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { listExternalSources, pushSource } from "@/server/connectors/connections";
import { pushSourceSchema } from "@/lib/validators/connectors";

type P = { id: string; connectionId: string };

/** Nguồn HIỆN TẠI trong notebook ngoài (gọi thật, không dùng cache) — để chọn nguồn nhập. Cần dùng được kết nối. */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id, connectionId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "editor");
  return { sources: await listExternalSources({ notebookId: id, connectionId, userId: user.id }) };
});

/** "Đẩy nguồn sang NotebookLM": nguồn text/url/tệp của sổ tay → thêm vào notebook ngoài. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id, connectionId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "editor");
  const { sourceId } = await parseBody(pushSourceSchema, req);
  const pushed = await pushSource({ notebookId: id, connectionId, userId: user.id, sourceId });
  return Response.json({ pushed }, { status: 201 });
});
