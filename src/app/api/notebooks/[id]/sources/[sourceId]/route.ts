import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import {
  assertCanManage,
  deleteSource,
  getSourceDetail,
  getSourceOrThrow,
  toSourceDto,
  updateSource,
} from "@/server/knowledge/sources";
import { updateSourceSchema } from "@/lib/validators/sources";

type P = { id: string; sourceId: string };

/** Metadata + văn bản theo trang/slide/mục + danh sách chunk cho Source viewer. */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id, sourceId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "viewer");
  const row = await getSourceOrThrow(user.id, id, sourceId);
  return { source: await getSourceDetail(row, { userId: user.id, role }) };
});

/** Đổi tên / đổi quyền riêng tư — chủ nguồn hoặc admin+. */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { id, sourceId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const row = await getSourceOrThrow(user.id, id, sourceId);
  assertCanManage(row, user.id, role);
  const patch = await parseBody(updateSourceSchema, req);
  const updated = await updateSource(row, patch);
  return { source: toSourceDto(updated, { userId: user.id, role }) };
});

/** Xoá mềm nguồn + xoá chunk — chủ nguồn hoặc admin+. */
export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { id, sourceId } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const row = await getSourceOrThrow(user.id, id, sourceId);
  assertCanManage(row, user.id, role);
  await deleteSource(row);
  return { ok: true };
});
