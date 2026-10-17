import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { importFromConnection } from "@/server/connectors/connections";
import { importFromConnectionSchema } from "@/lib/validators/connectors";

type P = { id: string; connectionId: string };

/**
 * "Nhập nguồn vào sổ tay": với mỗi nguồn NotebookLM được chọn, lấy văn bản đầy đủ từ Bridge
 * (`GET /notebooks/{id}/sources/{sid}/fulltext`) → nguồn `text` cục bộ + job `ingest_source`.
 * Bridge cũ chưa có endpoint → 501 `bridge_fulltext_unsupported`.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id, connectionId } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "editor");
  const input = await parseBody(importFromConnectionSchema, req);
  const result = await importFromConnection({ notebookId: id, connectionId, userId: user.id, ...input });
  return Response.json(result, { status: result.imported.length > 0 ? 201 : 200 });
});
