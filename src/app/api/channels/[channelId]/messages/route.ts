import { handleRoute, parseBody, parseQuery } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { createMessage } from "@/server/team-chat/actions";
import { listMessages } from "@/server/team-chat/queries";
import { listMessagesQuery, postMessageSchema } from "@/lib/validators/team-chat";

type P = { channelId: string };

/** Tin nhắn của kênh, keyset, mới nhất trước: `?before=<id>|after=<id>|around=<id>&limit=50`. */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { channelId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  const q = parseQuery(listMessagesQuery, req);
  return listMessages({ viewerId: user.id, channel: access.channel, ...q });
});

export const POST = handleRoute<P>(async (req, { params }) => {
  const { channelId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId, "viewer");
  const input = await parseBody(postMessageSchema, req);
  const message = await createMessage(access, { id: user.id, name: user.name }, input);
  return Response.json({ message }, { status: 201 });
});
