import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { assertCanManage, getSourceOrThrow, reprocessSource, toSourceDto } from "@/server/knowledge/sources";

type P = { id: string; sourceId: string };

/** Xử lý lại nguồn (extract + chunk + embed) — chủ nguồn hoặc admin+; chỉ khi đang `ready`/`failed`. */
export const POST = handleRoute<P>(async (_req, { params }) => {
  const { id, sourceId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const row = await getSourceOrThrow(user.id, id, sourceId);
  assertCanManage(row, user.id, role);
  const updated = await reprocessSource(row);
  return Response.json(
    { source: toSourceDto(updated, { userId: user.id, role }) },
    { status: 202 },
  );
});
