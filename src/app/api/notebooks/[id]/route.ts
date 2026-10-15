import { ApiError, handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { updateNotebookSchema } from "@/lib/validators/notebooks";
import { getNotebook, softDeleteNotebook, updateNotebook } from "@/server/notebooks/service";

type P = { id: string };

export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "viewer");
  const notebook = await getNotebook(id);
  return { notebook, role };
});

export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "admin");
  const patch = await parseBody(updateNotebookSchema, req);
  if (patch.defaultArtifactVisibility === "public" && role !== "owner") {
    throw ApiError.forbidden("Chỉ chủ sở hữu mới được đặt chế độ chia sẻ công khai");
  }
  const notebook = await updateNotebook(id, patch);
  return { notebook, role };
});

export const DELETE = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "owner");
  await softDeleteNotebook(id);
  return { ok: true };
});
