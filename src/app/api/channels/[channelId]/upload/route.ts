import { ApiError, handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireChannelAccess } from "@/server/team-chat/access";
import { storeAttachments } from "@/server/team-chat/actions";
import { MAX_ATTACHMENTS } from "@/lib/validators/team-chat";

type P = { channelId: string };

/**
 * Tải tệp đính kèm (multipart, trường `files`, nhiều tệp). Trả về `fileId` để gửi kèm
 * `attachmentFileIds` khi POST tin nhắn. Tệp chưa gắn vào tin nào chỉ chủ tệp đọc được.
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { channelId } = await params;
  const { user } = await requireUser();
  await requireChannelAccess(user.id, channelId, "viewer");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw ApiError.badRequest("Yêu cầu phải là multipart/form-data", "invalid_form");
  }
  const uploads = [...form.getAll("files"), ...form.getAll("file")].filter((v): v is File => v instanceof File);
  if (uploads.length === 0) throw ApiError.badRequest("Chưa chọn tệp nào", "no_files");
  if (uploads.length > MAX_ATTACHMENTS) throw ApiError.badRequest(`Tối đa ${MAX_ATTACHMENTS} tệp mỗi lần`, "too_many_files");
  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;
  for (const f of uploads) {
    if (f.size > maxBytes) {
      throw new ApiError(413, "payload_too_large", `Tệp "${f.name}" vượt quá giới hạn ${Math.round(maxBytes / 1024 / 1024)}MB`);
    }
  }
  const files = await storeAttachments(user.id, uploads);
  return Response.json({ files }, { status: 201 });
});
