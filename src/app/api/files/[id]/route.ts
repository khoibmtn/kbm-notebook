import { Readable } from "node:stream";
import { ApiError, handleRoute, isUuid } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { canAccessFile, getFile } from "@/server/storage/files";
import { getStorage } from "@/server/storage/local";

// Các MIME có thể thực thi script trong trình duyệt → luôn tải xuống, không hiển thị inline.
const FORCE_DOWNLOAD = /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml)/i;

export const GET = handleRoute<{ id: string }>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  if (!isUuid(id)) throw ApiError.notFound("Không tìm thấy tệp");
  const file = await getFile(id);
  // Không phân biệt "không tồn tại" và "không có quyền" để không lộ thông tin.
  if (!file || !(await canAccessFile(user.id, id))) throw ApiError.notFound("Không tìm thấy tệp");

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
