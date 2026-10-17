import { z } from "zod";
import { handleRoute, parseBody, parseQuery } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { createTopicChannel, getOrCreateDm, listChannelsForUser, unreadSummary } from "@/server/team-chat/channels";
import { createChannelSchema } from "@/lib/validators/team-chat";

type P = { id: string };

/** Danh sách kênh user thấy (general, chủ đề, DM của chính mình). `?summary=1` → chỉ tổng chưa đọc. */
export const GET = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const { summary } = parseQuery(z.object({ summary: z.enum(["1", "0"]).optional() }), req);
  if (summary === "1") return unreadSummary(user.id, id);
  const channels = await listChannelsForUser(user.id, id);
  return { channels, unread: channels.filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0) };
});

/** Tạo chủ đề (editor+) hoặc mở DM (mọi thành viên, idempotent). */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  const input = await parseBody(createChannelSchema, req);
  if (input.type === "topic") {
    await requireNotebookRole(user.id, id, "editor");
    const channel = await createTopicChannel(user.id, id, input.name);
    return Response.json({ channel, created: true }, { status: 201 });
  }
  await requireNotebookRole(user.id, id, "viewer");
  const { channel, created } = await getOrCreateDm(user.id, id, input.userId);
  return Response.json({ channel, created }, { status: created ? 201 : 200 });
});
