import { handleRoute, parseBody, parseQuery } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { listGroupsForExplore } from "@/server/community/explore";
import { createGroup, summarizeGroup } from "@/server/community/groups";
import { createGroupSchema, exploreGroupsQuery } from "@/lib/validators/community";

/** Nhóm công khai + nhóm của tôi. */
export const GET = handleRoute(async (req) => {
  const { user } = await requireUser();
  const q = parseQuery(exploreGroupsQuery, req);
  return listGroupsForExplore({ viewerId: user.id, ...q });
});

/** Tạo nhóm: người tạo là `owner`. `visibility`: `public` = ai cũng tham gia được, `private` = chỉ theo lời mời (thêm bằng email). */
export const POST = handleRoute(async (req) => {
  const { user } = await requireUser();
  const input = await parseBody(createGroupSchema, req);
  const group = await createGroup(user.id, input);
  return Response.json({ group: await summarizeGroup(group, user.id) }, { status: 201 });
});
