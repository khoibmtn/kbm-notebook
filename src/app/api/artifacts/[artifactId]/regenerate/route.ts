import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { loadArtifactAccess, regenerateArtifact, requireManage, toArtifactDto } from "@/server/artifacts/service";
import { regenerateArtifactSchema } from "@/lib/artifacts/meta";

type P = { artifactId: string };

/** Tạo lại bằng job mới (editor+). Kết quả thành phiên bản mới; các phiên bản cũ được giữ. Body tuỳ chọn ghi đè prompt/tuỳ chọn/phạm vi/model. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireManage(access);
  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = {};
  }
  const input = regenerateArtifactSchema.parse(raw);
  const row = await regenerateArtifact(access.artifact, user.id, input);
  return Response.json(
    { artifact: toArtifactDto({ artifact: row, versionNo: null, creatorName: null }, access) },
    { status: 202 },
  );
});
