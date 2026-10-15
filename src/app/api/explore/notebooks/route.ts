import { handleRoute, parseQuery } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { listPublicNotebooks } from "@/server/community/explore";
import { exploreNotebooksQuery } from "@/lib/validators/community";

/** Explore: sổ tay công khai (chỉ tiêu đề/mô tả/emoji + số artifact công khai). */
export const GET = handleRoute(async (req) => {
  await requireUser();
  const q = parseQuery(exploreNotebooksQuery, req);
  return listPublicNotebooks(q);
});
