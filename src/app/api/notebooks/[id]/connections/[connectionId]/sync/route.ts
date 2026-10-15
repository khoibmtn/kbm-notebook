import { handleRoute } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { syncConnection } from "@/server/connectors/connections";

type P = { id: string; connectionId: string };

/** Đồng bộ lại danh sách nguồn (tiêu đề, loại) của notebook ngoài vào cache `connection_sources`. */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { id, connectionId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  return { connection: await syncConnection({ notebookId: id, connectionId, userId: user.id, role }) };
});
