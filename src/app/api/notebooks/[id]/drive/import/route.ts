import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { importDriveFiles } from "@/server/connectors/drive";
import { importDriveSchema } from "@/lib/validators/connectors";

type P = { id: string };

/** Nhập tệp Drive vào sổ tay: tải về (Google Docs/Slides/Sheets export docx/pptx/xlsx) → `sources(kind='drive')` + ingest. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "editor");
  const input = await parseBody(importDriveSchema, req);
  const result = await importDriveFiles({ userId: user.id, notebookId: id, fileIds: input.fileIds, visibility: input.visibility });
  return Response.json(result, { status: result.imported.length > 0 ? 201 : 200 });
});
