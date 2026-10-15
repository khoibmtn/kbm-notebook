import { z } from "zod";
import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { loadArtifactAccess, requireManage, setVisibility, toDetailDto } from "@/server/artifacts/service";
import { shareVisibilitySchema } from "@/lib/artifacts/meta";

type P = { artifactId: string };

const bodySchema = shareVisibilitySchema.extend({ rotateToken: z.boolean().optional() });

/**
 * Đổi chế độ chia sẻ (editor+): private | notebook | link | public. `link` sinh `share_token`
 * (`rotateToken` đổi token mới, vô hiệu liên kết cũ). `public` chỉ chủ sổ tay được đặt.
 */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireManage(access);
  const input = await parseBody(bodySchema, req);
  const row = await setVisibility(access.artifact, { role: access.role ?? "viewer" }, input.visibility, { rotateToken: input.rotateToken });
  return { artifact: await toDetailDto({ ...access, artifact: row }) };
});
