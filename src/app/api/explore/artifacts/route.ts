import { handleRoute, parseQuery } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { listPublicArtifacts } from "@/server/community/explore";
import { exploreArtifactsQuery } from "@/lib/validators/community";

/** Explore: artifact công khai (lọc loại, sắp xếp mới nhất / nhiều lượt thích, tìm theo tiêu đề, 24 mục/trang). */
export const GET = handleRoute(async (req) => {
  await requireUser();
  const q = parseQuery(exploreArtifactsQuery, req);
  return listPublicArtifacts(q);
});
