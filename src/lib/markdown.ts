/**
 * Tiện ích Markdown dùng cho trình soạn ghi chú (client + server).
 */

/**
 * Trình soạn escape ngoặc vuông (`\[1\]`); trả lại dạng trích dẫn gọn `[1]`, `[1, 3]`, `[2-4]`
 * để ghi chú giữ nguyên dạng như câu trả lời AI và đọc được khi xử lý thành nguồn.
 */
export function unescapeCitationBrackets(md: string): string {
  return md.replace(/\\\[(\s*\d{1,4}(?:\s*[-–—,;]\s*\d{1,4})*\s*)\\\]/g, "[$1]");
}

/** Chuẩn hoá Markdown xuất từ trình soạn trước khi lưu (`content_md`): bỏ escape trích dẫn, chuẩn xuống dòng cuối. */
export function normalizeEditorMarkdown(md: string): string {
  const out = unescapeCitationBrackets(md).replace(/\r\n/g, "\n").replace(/\s+$/g, "");
  return out;
}
