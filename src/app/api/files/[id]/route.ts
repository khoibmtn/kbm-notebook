import { Readable } from "node:stream";
import { ApiError, handleRoute, isUuid } from "@/server/api/errors";
import { enforceRateLimit } from "@/server/api/rate-limit";
import { clientIp } from "@/server/api/client-ip";
import { requireUser } from "@/server/auth/session";
import { canAccessFile, canAccessFileViaShare, getFile } from "@/server/storage/files";
import { getStorage } from "@/server/storage/local";

// Các MIME có thể thực thi script trong trình duyệt → luôn tải xuống, không hiển thị inline.
const FORCE_DOWNLOAD = /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml)/i;

/** Số lượt truy cập tệp bằng `?share=` mỗi IP mỗi phút. */
const SHARE_RATE_LIMIT = 300;

export const GET = handleRoute<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  if (!isUuid(id)) throw ApiError.notFound("Không tìm thấy tệp");
  const share = new URL(req.url).searchParams.get("share");
  // Khách mở liên kết chia sẻ artifact (`?share=<token>`) được đọc ảnh của chính artifact đó, không cần đăng nhập.
  // Truy cập chưa xác thực bị giới hạn tần suất theo IP (mỗi yêu cầu vẫn chỉ tốn tra cứu theo chỉ mục).
  if (share) {
    await enforceRateLimit(`files:share:${clientIp(req)}`, SHARE_RATE_LIMIT, 60_000, "Bạn truy cập tệp chia sẻ quá nhanh. Thử lại sau khoảng {minutes} phút.");
  }
  const viaShare = share ? await canAccessFileViaShare(share, id) : false;
  const user = viaShare ? null : (await requireUser()).user;
  const file = await getFile(id);
  // Không phân biệt "không tồn tại" và "không có quyền" để không lộ thông tin.
  if (!file || (!viaShare && !(user && (await canAccessFile(user.id, id))))) throw ApiError.notFound("Không tìm thấy tệp");

  const etag = `"${file.sha256}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  let stream: Readable;
  try {
    stream = await getStorage().getStream(file.storageKey);
  } catch {
    throw ApiError.notFound("Tệp không còn trên bộ nhớ");
  }
  const download = new URL(req.url).searchParams.get("download") === "1" || FORCE_DOWNLOAD.test(file.mime);
  const encoded = encodeURIComponent(file.originalName).replace(/['()]/g, escape);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
