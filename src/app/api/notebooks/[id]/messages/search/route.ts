import { handleRoute, parseQuery } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { searchMessages } from "@/server/team-chat/queries";
import { searchQuery } from "@/lib/validators/team-chat";

type P = { id: string };

/** Tìm tin nhắn trong mọi kênh mà user thuộc về trong notebook (DM của người khác không bao giờ xuất hiện). */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const { q, limit } = parseQuery(searchQuery, req);
  const results = await searchMessages({ viewerId: user.id, notebookId: id, q, limit });
  return { results };
});
