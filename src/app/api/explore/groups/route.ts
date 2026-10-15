import { handleRoute, parseQuery } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { listGroupsForExplore } from "@/server/community/explore";
import { exploreGroupsQuery } from "@/lib/validators/community";

/** Explore: nhóm học tập công khai + nhóm riêng mà người dùng là thành viên. */
export const GET = handleRoute(async (req) => {
  const { user } = await requireUser();
  const q = parseQuery(exploreGroupsQuery, req);
  return listGroupsForExplore({ viewerId: user.id, ...q });
});
