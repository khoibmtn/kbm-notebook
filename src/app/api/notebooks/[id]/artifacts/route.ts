import { z } from "zod";
import { handleRoute, parseBody, parseQuery } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { engineAvailability } from "@/server/artifacts/registry";
import { createArtifact, listArtifacts, toArtifactDto } from "@/server/artifacts/service";
import { ARTIFACT_TYPE_LIST } from "@/lib/artifacts/content";
import { createArtifactSchema, type ArtifactListResponse } from "@/lib/artifacts/meta";

type P = { id: string };

const listQuery = z.object({
  type: z.enum(ARTIFACT_TYPE_LIST).optional(),
  status: z.enum(["queued", "generating", "ready", "failed"]).optional(),
});

/** Danh sách artifact (mới nhất trước) mà người gọi được xem; lọc theo `type`, `status`. */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "viewer");
  const filter = parseQuery(listQuery, req);
  const artifacts = await listArtifacts(id, { userId: user.id, role }, filter);
  const body: ArtifactListResponse = { artifacts, engines: engineAvailability() };
  return body;
});

/** Tạo artifact (editor+): hàng `queued` + job `generate_artifact`. 501 nếu loại phụ thuộc engine chưa có. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const role = await requireNotebookRole(user.id, id, "editor");
  const input = await parseBody(createArtifactSchema, req);
  const row = await createArtifact({ notebookId: id, userId: user.id, input });
  const dto = toArtifactDto({ artifact: row, versionNo: null, creatorName: user.name }, { canEdit: true, canManage: role !== "viewer" });
  return Response.json({ artifact: dto }, { status: 201 });
});
