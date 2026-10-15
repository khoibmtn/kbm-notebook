import { ApiError, handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { discardFiles, receiveMultipart } from "@/server/storage/multipart";
import { requireChannelAccess } from "@/server/team-chat/access";
import { MAX_ATTACHMENTS } from "@/lib/validators/team-chat";

type P = { channelId: string };

/**
 * Tải tệp đính kèm (multipart, trường `files`, nhiều tệp). Trả về `fileId` để gửi kèm
 * `attachmentFileIds` khi POST tin nhắn. Tệp chưa gắn vào tin nào chỉ chủ tệp đọc được và bị dọn sau 24 giờ.
 * Body được ghi theo dòng xuống đĩa; có hạn mức theo người dùng (429) và quota dung lượng sổ tay (413).
 * Một tệp bị từ chối → cả lần tải bị huỷ (tin nhắn cần đủ tệp).
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { channelId } = await params;
  const { user } = await requireUser();
  const access = await requireChannelAccess(user.id, channelId, "viewer");

  const received = await receiveMultipart(req, {
    ownerId: user.id,
    notebookId: access.channel.notebookId,
    origin: "chat_upload",
    maxFiles: MAX_ATTACHMENTS,
    tooManyMessage: `Tối đa ${MAX_ATTACHMENTS} tệp mỗi lần`,
  });
  if (received.rejected.length > 0) {
    await discardFiles(received.files);
    const first = received.rejected[0];
    throw new ApiError(first.status, first.code, first.message, received.rejected);
  }
  if (received.files.length === 0) throw ApiError.badRequest("Chưa chọn tệp nào", "no_files");
  const files = received.files.map((f) => ({ fileId: f.row.id, name: f.row.originalName, mime: f.row.mime, size: f.row.sizeBytes }));
  return Response.json({ files }, { status: 201 });
});
