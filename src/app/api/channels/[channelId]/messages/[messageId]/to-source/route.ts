import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { attachmentsToSources } from "@/server/team-chat/actions";
import { toSourceSchema } from "@/lib/validators/team-chat";

type P = { channelId: string; messageId: string };

/**
 * Chuyển tệp đính kèm của tin nhắn vào Nguồn (editor+): tạo `sources(kind='chat_attachment', status='pending')`
 * và xếp job `ingest_source`. Body tuỳ chọn `{ attachmentId }`; bỏ trống = mọi tệp của tin.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { channelId, messageId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId, "editor");
  const text = await req.text();
  let raw: unknown = {};
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = {};
    }
  }
  const { attachmentId } = toSourceSchema.parse(raw);
  const sources = await attachmentsToSources(access, { id: user.id, name: user.name }, messageId, attachmentId);
  return Response.json({ sources }, { status: sources.every((s) => s.existing) ? 200 : 201 });
});
