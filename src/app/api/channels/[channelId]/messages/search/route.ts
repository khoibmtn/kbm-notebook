import { handleRoute, parseQuery } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { searchMessages } from "@/server/team-chat/queries";
import { searchQuery } from "@/lib/validators/team-chat";

type P = { channelId: string };

/** Tìm trong một kênh (full-text `tsv` + ILIKE dự phòng). */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { channelId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  const { q, limit } = parseQuery(searchQuery, req);
  const results = await searchMessages({
    viewerId: user.id,
    notebookId: access.channel.notebookId,
    channelId: access.channel.id,
    q,
    limit,
  });
  return { results };
});
