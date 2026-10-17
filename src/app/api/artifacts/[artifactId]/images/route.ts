import { ApiError, handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { loadArtifactAccess, requireEdit } from "@/server/artifacts/service";
import { probeImage } from "@/server/artifacts/slides/image-util";
import { env } from "@/server/env";
import { registerArtifactFile } from "@/server/storage/files";
import { getStorage } from "@/server/storage/local";
import { assertContentLength, formDataWithLimit } from "@/server/storage/multipart";
import { assertNotebookQuota, assertUploadBudget, chargeUploadBytes, chargeUploadFile } from "@/server/storage/quota";

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

  // Một ảnh duy nhất: đọc vào RAM nhưng có chặn trần (Content-Length trước, đếm byte khi đọc) + hạn mức/quota.
  const cap = env().MAX_UPLOAD_MB * 1024 * 1024 + 1024 * 1024;
  const declared = assertContentLength(req, cap);
  await assertUploadBudget(user.id, declared);
  await assertNotebookQuota(access.artifact.notebookId, declared ?? 0);
  const form = await formDataWithLimit(req, cap);
  const file = form.get("file");
  if (!file || typeof file === "string") throw ApiError.badRequest("Chưa chọn ảnh", "no_files");
  if (file.size > env().MAX_UPLOAD_MB * 1024 * 1024) {
    throw new ApiError(413, "payload_too_large", `Ảnh vượt quá giới hạn ${env().MAX_UPLOAD_MB}MB`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const info = probeImage(bytes);
  if (!info) throw new ApiError(415, "unsupported_media_type", "Chỉ hỗ trợ ảnh PNG, JPEG, GIF hoặc WebP");
  await chargeUploadFile(user.id);
  await chargeUploadBytes(user.id, bytes.length);
  const stored = await getStorage().put(bytes, {
    ownerId: user.id,
    mime: info.mime,
    name: file.name || "image",
    notebookId: access.artifact.notebookId,
    origin: "artifact_image",
  });
  // Chỉ server ghi nhận ảnh thuộc artifact — quyền đọc ảnh dựa vào bảng này, không dựa vào JSON nội dung do client sửa.
  await registerArtifactFile(access.artifact.id, stored.id);
  return Response.json({ fileId: stored.id, url: `/api/files/${stored.id}` }, { status: 201 });
});
