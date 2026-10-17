/**
 * Google Drive: logic thuần (MIME, truy vấn) dùng chung client + server. Không có credential ở đây.
 */

export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_FOLDER = "application/vnd.google-apps.folder";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Tệp Google gốc (Docs/Slides/Sheets) không tải thẳng được → `files.export` sang định dạng Office tương ứng. */
export const DRIVE_EXPORT_TARGETS: Record<string, { mime: string; ext: string }> = {
  [GOOGLE_DOC]: { mime: DOCX, ext: "docx" },
  [GOOGLE_SLIDES]: { mime: PPTX, ext: "pptx" },
  [GOOGLE_SHEET]: { mime: XLSX, ext: "xlsx" },
};

/** MIME của tệp thường có thể tải thẳng (`alt=media`) và pipeline ingest xử lý được. */
export const DRIVE_DIRECT_MIMES: readonly string[] = [
  "application/pdf",
  DOCX,
  PPTX,
  XLSX,
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
];

export function driveExportTarget(mime: string): { mime: string; ext: string } | null {
  return DRIVE_EXPORT_TARGETS[mime] ?? null;
}

/** Tệp Drive có nhập được vào Nguồn không (Google Docs/Slides/Sheets hoặc định dạng tệp thường được hỗ trợ). */
export function isImportableDriveMime(mime: string): boolean {
  return mime in DRIVE_EXPORT_TARGETS || DRIVE_DIRECT_MIMES.includes(mime);
}

/** Thoát chuỗi cho toán tử `contains` / `=` của Drive query (`\` và `'`). */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Truy vấn `files.list`: không thùng rác, không thư mục, chỉ MIME nhập được; thêm tìm theo tên/nội dung nếu có `term`.
 */
export function buildDriveQuery(term?: string): string {
  const mimes = [...Object.keys(DRIVE_EXPORT_TARGETS), ...DRIVE_DIRECT_MIMES];
  const parts = [`trashed = false`, `mimeType != '${GOOGLE_FOLDER}'`, `(${mimes.map((m) => `mimeType = '${m}'`).join(" or ")})`];
  const t = term?.trim();
  if (t) {
    const v = escapeDriveQueryValue(t.slice(0, 200));
    parts.push(`(name contains '${v}' or fullText contains '${v}')`);
  }
  return parts.join(" and ");
}

/** Tên tệp khi nhập: thêm đuôi nếu tệp Google gốc được export (không có đuôi). */
export function driveImportFileName(name: string, mime: string): string {
  const target = driveExportTarget(mime);
  const clean = name.replace(/[\\/]/g, "_").trim() || "Tệp Google Drive";
  if (!target) return clean;
  return clean.toLowerCase().endsWith(`.${target.ext}`) ? clean : `${clean}.${target.ext}`;
}

export type DriveFileDto = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: number | null;
  webViewLink: string | null;
};

export type DriveFilesPage = { files: DriveFileDto[]; nextPageToken: string | null };

export type DriveImportResult = {
  imported: { driveFileId: string; sourceId: string; title: string }[];
  failed: { driveFileId: string; name: string | null; message: string }[];
};
