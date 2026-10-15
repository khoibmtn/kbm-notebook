import { ApiError, handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { loadArtifactAccess, requireEdit } from "@/server/artifacts/service";
import { probeImage } from "@/server/artifacts/slides/image-util";
import { getStorage } from "@/server/storage/local";

type P = { artifactId: string };

/**
 * Tải ảnh lên cho một slide (multipart, trường `file`) — người sửa được artifact (editor+ hoặc chia sẻ quyền sửa).
 * Kiểm tra bằng byte thật (PNG/JPEG/GIF/WebP) chứ không tin MIME khách gửi; vượt MAX_UPLOAD_MB → 413.
 * Trả `201 { fileId, url }`; tệp thuộc người tải lên, ai xem được artifact có tham chiếu sẽ đọc được (xem storage/files.ts).
 */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { artifactId } = await params;
  const { user } = await requireUser();
  const access = await loadArtifactAccess(user.id, artifactId);
  requireEdit(access);
  if (access.artifact.type !== "slide_deck" && access.artifact.type !== "infographic") {
    throw ApiError.badRequest("Loại artifact này không có ảnh", "unsupported_type");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw ApiError.badRequest("Yêu cầu phải là multipart/form-data", "invalid_form");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw ApiError.badRequest("Chưa chọn ảnh", "no_files");
  const bytes = Buffer.from(await file.arrayBuffer());
  const info = probeImage(bytes);
  if (!info) throw new ApiError(415, "unsupported_media_type", "Chỉ hỗ trợ ảnh PNG, JPEG, GIF hoặc WebP");
  const stored = await getStorage().put(bytes, { ownerId: user.id, mime: info.mime, name: file.name || "image" });
  return Response.json({ fileId: stored.id, url: `/api/files/${stored.id}` }, { status: 201 });
});
