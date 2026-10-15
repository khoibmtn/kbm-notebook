import "server-only";

// Chỉ các MIME an toàn mới hiển thị inline; mọi loại khác (html, svg, xml, loại lạ…) luôn tải xuống (L-16).
const INLINE_SAFE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|audio\/(mpeg|ogg|wav|webm)|video\/(mp4|webm))(\s*;.*)?$/i;

// MIME do client khai khi upload: chỉ chấp nhận dạng type/subtype ASCII hợp lệ, nếu không phục vụ như nhị phân
// (tránh `Headers` ném lỗi → 500 vĩnh viễn cho tệp đó).
const VALID_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(\s*;[\x20-\x7e]*)?$/i;

export function safeServedMime(mime: string): string {
  return VALID_MIME.test(mime) ? mime : "application/octet-stream";
}

export function isInlineSafe(mime: string): boolean {
  return INLINE_SAFE.test(mime);
}
