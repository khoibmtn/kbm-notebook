import { ApiError, handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { setChannelMuted } from "@/server/team-chat/actions";
import { muteSchema } from "@/lib/validators/team-chat";

type P = { id: string; channelId: string };

/** Tắt/bật tiếng kênh cho riêng người dùng (body `{ muted }`, mặc định true). */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id, channelId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId);
  if (access.channel.notebookId !== id) throw ApiError.notFound("Không tìm thấy kênh");
  const text = await req.text();
  let raw: unknown = {};
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw ApiError.badRequest("Nội dung yêu cầu không phải JSON hợp lệ", "invalid_json");
    }
  }
  const { muted } = muteSchema.parse(raw);
  await setChannelMuted(access, user.id, muted);
  return { muted };
});
