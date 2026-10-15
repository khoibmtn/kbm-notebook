/**
 * Tiện ích nguồn dùng chung client + server (không import code server-only).
 */

export type SourceFileType = "pdf" | "docx" | "pptx" | "xlsx" | "csv" | "md" | "txt" | "html" | "json";

type TypeDef = { exts: string[]; mimes: string[] };

const TYPES: Record<SourceFileType, TypeDef> = {
  pdf: { exts: ["pdf"], mimes: ["application/pdf"] },
  docx: { exts: ["docx"], mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  pptx: { exts: ["pptx"], mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
  xlsx: {
    exts: ["xlsx", "xls"],
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
  },
  csv: { exts: ["csv"], mimes: ["text/csv", "application/csv", "text/x-csv", "application/vnd.ms-excel"] },
  md: { exts: ["md", "markdown"], mimes: ["text/markdown", "text/x-markdown"] },
  txt: { exts: ["txt", "text", "log"], mimes: ["text/plain"] },
  html: { exts: ["html", "htm"], mimes: ["text/html", "application/xhtml+xml"] },
  json: { exts: ["json"], mimes: ["application/json", "text/json"] },
};

/** MIME "chung chung" trình duyệt hay gửi khi không nhận ra loại tệp → tin vào phần mở rộng. */
const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

const TEXT_LIKE: SourceFileType[] = ["md", "txt", "json", "csv", "html"];

/** Giá trị cho thuộc tính `accept` của input tệp. */
export const SOURCE_ACCEPT = Object.values(TYPES)
  .flatMap((d) => d.exts.map((e) => `.${e}`))
  .join(",");

export const SOURCE_EXTENSIONS: string[] = Object.values(TYPES).flatMap((d) => d.exts);

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * Xác định loại tệp được hỗ trợ từ tên + MIME. Trả null nếu không hỗ trợ
 * (phần mở rộng lạ, hoặc MIME mâu thuẫn rõ ràng với phần mở rộng).
 */
export function detectFileType(name: string, mime: string | null | undefined): SourceFileType | null {
  const ext = fileExtension(name);
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  for (const [type, def] of Object.entries(TYPES) as [SourceFileType, TypeDef][]) {
    if (!def.exts.includes(ext)) continue;
    if (GENERIC_MIMES.has(m) || def.mimes.includes(m)) return type;
    // Một số hệ điều hành gán text/plain cho .md/.json/.csv…
    if (TEXT_LIKE.includes(type) && m.startsWith("text/")) return type;
    return null;
  }
  return null;
}

export type SourceKind = "file" | "url" | "text" | "youtube" | "drive" | "chat_attachment";
export type SourceStatus = "pending" | "processing" | "ready" | "failed";
export type SourceVisibility = "shared" | "private";
export type SourcePageUnit = "page" | "slide" | "sheet";

/** Đối tượng nguồn trả về từ API (không có nội dung đầy đủ). */
export type SourceDto = {
  id: string;
  notebookId: string;
  kind: SourceKind;
  /** Loại tệp (pdf, docx…) nếu là tệp. */
  fileType: SourceFileType | null;
  title: string;
  mime: string | null;
  url: string | null;
  fileId: string | null;
  visibility: SourceVisibility;
  status: SourceStatus;
  /** 0–100 khi đang xử lý. */
  progress: number;
  error: string | null;
  pageCount: number | null;
  /** Đơn vị của pageCount: trang / slide / sheet. */
  pageUnit: SourcePageUnit | null;
  tokenCount: number | null;
  summary: string | null;
  keyTopics: string[] | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Người gọi được phép sửa/xoá (chủ nguồn hoặc admin+). */
  canManage: boolean;
};

export type SourceTextPage = {
  /** Số trang / slide / sheet (1-based) nếu có. */
  page: number | null;
  slide: number | null;
  section: string | null;
  /** Vị trí ký tự trong toàn văn nguồn. */
  start: number;
  end: number;
  text: string;
};

export type SourceChunkRef = { id: string; idx: number; page: number | null; startChar: number; endChar: number };

export type SourceDetailDto = SourceDto & {
  pages: SourceTextPage[];
  chunks: SourceChunkRef[];
};

/** Sự kiện realtime `source:status`. */
export type SourceStatusEvent = {
  sourceId: string;
  notebookId: string;
  status: SourceStatus;
  progress: number;
  error: string | null;
  visibility: SourceVisibility;
  createdBy: string;
  /** status: chỉ đổi trạng thái/tiến độ; created/updated/deleted: danh sách cần tải lại. */
  change: "status" | "created" | "updated" | "deleted";
};

type EvidenceLike = {
  id: string;
  provider?: string;
  sourceId: string | null;
  locator?: { page?: number; slide?: number; startChar?: number; endChar?: number };
};

/**
 * Đường dẫn mở Source viewer tại đúng đoạn của một bằng chứng (chip trích dẫn [n]).
 * `chunk` ưu tiên; `page/start/end` là dự phòng khi chunk đã bị xử lý lại (id đổi).
 * Trả null nếu bằng chứng không thuộc nguồn cục bộ.
 */
export function sourceViewerHref(notebookId: string, evidence: EvidenceLike): string | null {
  if (!evidence.sourceId) return null;
  if (evidence.provider && evidence.provider !== "local") return null;
  const q = new URLSearchParams();
  q.set("chunk", evidence.id);
  const loc = evidence.locator;
  const page = loc?.page ?? loc?.slide;
  if (page != null) q.set("page", String(page));
  if (loc?.startChar != null) q.set("start", String(loc.startChar));
  if (loc?.endChar != null) q.set("end", String(loc.endChar));
  return `/n/${notebookId}/sources/${evidence.sourceId}?${q.toString()}`;
}

export type ViewerHighlight = { chunk?: string; page?: number; start?: number; end?: number };

export function parseViewerHighlight(params: URLSearchParams): ViewerHighlight {
  const num = (k: string) => {
    const v = params.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  return {
    chunk: params.get("chunk") || undefined,
    page: num("page"),
    start: num("start"),
    end: num("end"),
  };
}

/** Ước lượng số token (≈ ký tự/4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
