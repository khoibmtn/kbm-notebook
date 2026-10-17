import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { connectorHttp, type ConnectorHttpResponse } from "./http";

/**
 * Client HTTP cho NotebookLM Bridge (sidecar KHÔNG CHÍNH THỨC, `bridge/notebooklm`). Chỉ nói chuyện với API JSON ổn định
 * của sidecar (bearer token). Mọi lỗi → `ApiError(502, 'connector_error')` kèm thông báo của bridge.
 */

export type BridgeCredential = {
  url: string;
  token: string;
  /** Cho phép host nội bộ/LAN (xem `http.ts`). */
  allowPrivateHosts: boolean;
};

export const BRIDGE_ASK_TIMEOUT_MS = 60_000;
export const BRIDGE_DEFAULT_TIMEOUT_MS = 20_000;
/** Upload tệp lớn + NotebookLM xử lý: chờ lâu hơn. */
export const BRIDGE_UPLOAD_TIMEOUT_MS = 120_000;

/* --- Schema phản hồi (lỏng: chỉ ràng buộc các trường ta dùng) ------------------ */

const healthSchema = z.object({
  ok: z.boolean().optional(),
  version: z.string().nullish(),
  notebooklm_py_version: z.string().nullish(),
  authenticated: z.boolean(),
  account: z.string().nullish(),
  detail: z.string().nullish(),
});
export type BridgeHealth = {
  version: string | null;
  notebooklmPyVersion: string | null;
  authenticated: boolean;
  account: string | null;
  detail: string | null;
};

const notebookSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullish(),
  source_count: z.number().nullish(),
  updated_at: z.string().nullish(),
  created_at: z.string().nullish(),
});
export type BridgeNotebook = { id: string; title: string; sourceCount: number | null; updatedAt: string | null };

const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullish(),
  kind: z.string().nullish(),
  status: z.string().nullish(),
  url: z.string().nullish(),
});
export type BridgeSource = { id: string; title: string; kind: string | null; status: string | null; url: string | null };

const notebookDetailSchema = notebookSchema.extend({ sources: z.array(sourceSchema).default([]) });
export type BridgeNotebookDetail = BridgeNotebook & { sources: BridgeSource[] };

const referenceSchema = z.object({
  source_id: z.string(),
  source_title: z.string().nullish(),
  citation_number: z.number().nullish(),
  cited_text: z.string().nullish(),
  start_char: z.number().nullish(),
  end_char: z.number().nullish(),
  score: z.number().nullish(),
});
const askSchema = z.object({
  answer: z.string(),
  conversation_id: z.string().nullish(),
  references: z.array(referenceSchema).default([]),
});
export type BridgeReference = {
  sourceId: string;
  sourceTitle: string | null;
  citationNumber: number | null;
  citedText: string | null;
  startChar: number | null;
  endChar: number | null;
  score: number | null;
};
export type BridgeAskResult = { answer: string; conversationId: string | null; references: BridgeReference[] };

const noteSchema = z.object({ id: z.string(), title: z.string().nullish() });
export type BridgeNote = { id: string; title: string };

const fulltextSchema = z.object({
  source_id: z.string(),
  title: z.string().nullish(),
  kind: z.string().nullish(),
  url: z.string().nullish(),
  text: z.string(),
  char_count: z.number().nullish(),
});
export type BridgeFulltext = { sourceId: string; title: string | null; kind: string | null; url: string | null; text: string };

const errorBodySchema = z.object({ error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional() });

/* --- Chuyển đổi ---------------------------------------------------------------- */

const toNotebook = (n: z.infer<typeof notebookSchema>): BridgeNotebook => ({
  id: n.id,
  title: n.title?.trim() || "(Không tên)",
  sourceCount: n.source_count ?? null,
  updatedAt: n.updated_at ?? n.created_at ?? null,
});
const toSource = (s: z.infer<typeof sourceSchema>): BridgeSource => ({
  id: s.id,
  title: s.title?.trim() || "(Nguồn không tên)",
  kind: s.kind ?? null,
  status: s.status ?? null,
  url: s.url ?? null,
});

/** Chuỗi `/notebooks/{id}/...` an toàn: id đi qua `encodeURIComponent`. */
const nb = (id: string) => `/notebooks/${encodeURIComponent(id)}`;

/** Rút gọn + làm sạch văn bản lấy từ máy chủ ngoài trước khi cho người dùng thấy (bỏ ký tự điều khiển/HTML, cắt độ dài). */
export function sanitizeUpstreamText(value: string | null | undefined, max = 120): string | null {
  if (!value) return null;
  const clean = value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Thông báo cố định (do KBM viết) cho các mã lỗi mà sidecar chính thức trả về. KHÔNG phản chiếu nội dung do máy chủ ngoài gửi. */
const BRIDGE_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Bridge chưa đăng nhập Google. Chạy `notebooklm login` trên máy chạy bridge.",
  client_unavailable: "Bridge chưa kết nối được NotebookLM. Chạy `notebooklm login` trên máy chạy bridge.",
  notebook_not_found: "Bridge không tìm thấy notebook này.",
  source_not_found: "Bridge không tìm thấy nguồn này.",
  artifact_not_found: "Bridge không tìm thấy artifact này.",
  note_not_found: "Bridge không tìm thấy ghi chú này.",
  rate_limited: "NotebookLM đang giới hạn tần suất. Thử lại sau ít phút.",
  timeout: "NotebookLM phản hồi quá chậm. Thử lại sau.",
  invalid_request: "Bridge từ chối yêu cầu vì dữ liệu không hợp lệ.",
  unsupported_media_type: "Bridge không hỗ trợ loại tệp này.",
  notebook_limit_reached: "Đã đạt giới hạn số notebook của tài khoản NotebookLM.",
  source_processing_failed: "NotebookLM không xử lý được nguồn này.",
  source_add_failed: "NotebookLM không thêm được nguồn này.",
  download_failed: "Bridge không tải được tệp từ NotebookLM.",
  artifact_not_ready: "Artifact trên NotebookLM chưa sẵn sàng.",
  feature_unavailable: "Tính năng này chưa khả dụng trên tài khoản NotebookLM.",
  misconfigured: "Bridge cấu hình chưa đúng — xem log của bridge.",
};

/**
 * Ánh xạ mã lỗi/HTTP của bridge sang thông báo người dùng đọc được.
 * Nội dung `message` do máy chủ ở URL bridge gửi KHÔNG được chuyển tiếp (URL do người dùng nhập có thể là dịch vụ bất kỳ —
 * nếu phản chiếu sẽ thành kênh đọc dữ liệu nội bộ); chỉ dùng mã lỗi đã biết + HTTP status.
 */
export function describeBridgeFailure(status: number, body: Buffer): { code: string | null; message: string } {
  let code: string | null = null;
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(body.toString("utf8")));
    if (parsed.success && parsed.data.error?.code && /^[a-z0-9_]{1,40}$/.test(parsed.data.error.code)) code = parsed.data.error.code;
  } catch {
    /* không phải JSON */
  }
  if (status === 401 || code === "unauthorized") return { code, message: "Bridge từ chối token (401). Kiểm tra lại BRIDGE_TOKEN." };
  if (code === "upstream_changed") return { code, message: "Giao thức NotebookLM đã đổi — cần nâng cấp notebooklm-py ở bridge." };
  if (code && BRIDGE_ERROR_MESSAGES[code]) return { code, message: BRIDGE_ERROR_MESSAGES[code] };
  if (status === 503) return { code, message: BRIDGE_ERROR_MESSAGES.not_authenticated };
  return { code, message: `Bridge trả về HTTP ${status}${code ? ` (${code})` : ""}` };
}

export class BridgeClient {
  constructor(private readonly cred: BridgeCredential) {}

  private base(): string {
    return this.cred.url.replace(/\/+$/, "");
  }

  private async call(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: { json?: unknown; body?: Buffer; contentType?: string; timeoutMs?: number } = {},
  ): Promise<ConnectorHttpResponse> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.cred.token}` };
    let body: Buffer | undefined = opts.body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = Buffer.from(JSON.stringify(opts.json), "utf8");
    } else if (opts.contentType) {
      headers["Content-Type"] = opts.contentType;
    }
    const res = await connectorHttp({
      url: `${this.base()}${path}`,
      method,
      headers,
      body,
      timeoutMs: opts.timeoutMs ?? BRIDGE_DEFAULT_TIMEOUT_MS,
      allowPrivateHosts: this.cred.allowPrivateHosts,
    });
    if (res.status < 200 || res.status >= 300) {
      const { code, message } = describeBridgeFailure(res.status, res.body);
      throw new ApiError(502, "connector_error", message, { upstreamStatus: res.status, upstreamCode: code });
    }
    return res;
  }

  private async json<T>(schema: z.ZodType<T>, res: ConnectorHttpResponse): Promise<T> {
    let raw: unknown;
    try {
      raw = JSON.parse(res.body.toString("utf8"));
    } catch {
      throw new ApiError(502, "connector_error", "Phản hồi của bridge không phải JSON — URL có đúng là NotebookLM Bridge không?");
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(502, "connector_error", "Phản hồi của bridge không đúng định dạng mong đợi (phiên bản bridge không khớp?)");
    }
    return parsed.data;
  }

  async health(): Promise<BridgeHealth> {
    const res = await this.call("GET", "/health?refresh=true");
    const h = await this.json(healthSchema, res);
    return {
      version: sanitizeUpstreamText(h.version, 40),
      notebooklmPyVersion: sanitizeUpstreamText(h.notebooklm_py_version, 40),
      authenticated: h.authenticated,
      account: sanitizeUpstreamText(h.account, 120),
      detail: sanitizeUpstreamText(h.detail, 160),
    };
  }

  async listNotebooks(): Promise<BridgeNotebook[]> {
    const res = await this.call("GET", "/notebooks");
    return (await this.json(z.array(notebookSchema), res)).map(toNotebook);
  }

  /** Lấy notebook + nguồn. Bridge trả 404 `notebook_not_found` nếu không tồn tại. */
  async getNotebook(id: string): Promise<BridgeNotebookDetail> {
    const res = await this.call("GET", nb(id));
    const d = await this.json(notebookDetailSchema, res);
    return { ...toNotebook(d), sourceCount: d.sources.length, sources: d.sources.map(toSource) };
  }

  async listSources(id: string): Promise<BridgeSource[]> {
    const res = await this.call("GET", `${nb(id)}/sources`);
    return (await this.json(z.array(sourceSchema), res)).map(toSource);
  }

  async ask(id: string, question: string, opts: { sourceIds?: string[]; conversationId?: string } = {}): Promise<BridgeAskResult> {
    const res = await this.call("POST", `${nb(id)}/ask`, {
      json: {
        question,
        ...(opts.sourceIds?.length ? { source_ids: opts.sourceIds } : {}),
        ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}),
      },
      timeoutMs: BRIDGE_ASK_TIMEOUT_MS,
    });
    const a = await this.json(askSchema, res);
    return {
      answer: a.answer,
      conversationId: a.conversation_id ?? null,
      references: a.references.map((r) => ({
        sourceId: r.source_id,
        sourceTitle: r.source_title ?? null,
        citationNumber: r.citation_number ?? null,
        citedText: r.cited_text ?? null,
        startChar: r.start_char ?? null,
        endChar: r.end_char ?? null,
        score: r.score ?? null,
      })),
    };
  }

  async createNote(id: string, title: string, content: string): Promise<BridgeNote> {
    const res = await this.call("POST", `${nb(id)}/notes`, { json: { title, content } });
    const n = await this.json(noteSchema, res);
    return { id: n.id, title: n.title ?? title };
  }

  async addTextSource(id: string, title: string, text: string): Promise<BridgeSource> {
    const res = await this.call("POST", `${nb(id)}/sources`, { json: { type: "text", title, text }, timeoutMs: BRIDGE_UPLOAD_TIMEOUT_MS });
    return toSource(await this.json(sourceSchema, res));
  }

  async addUrlSource(id: string, url: string, title?: string): Promise<BridgeSource> {
    const res = await this.call("POST", `${nb(id)}/sources`, {
      json: { type: "url", url, ...(title ? { title } : {}) },
      timeoutMs: BRIDGE_UPLOAD_TIMEOUT_MS,
    });
    return toSource(await this.json(sourceSchema, res));
  }

  /** Tải tệp lên (multipart/form-data: `file`, `title?`). */
  async addFileSource(id: string, file: { name: string; mime: string; data: Buffer }, title?: string): Promise<BridgeSource> {
    const boundary = `----kbm${randomUUID().replace(/-/g, "")}`;
    const safeName = file.name.replace(/[\r\n"\\]/g, "_");
    const parts: Buffer[] = [];
    if (title) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`, "utf8"));
    }
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${file.mime || "application/octet-stream"}\r\n\r\n`, "utf8"),
      file.data,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    );
    const res = await this.call("POST", `${nb(id)}/sources`, {
      body: Buffer.concat(parts),
      contentType: `multipart/form-data; boundary=${boundary}`,
      timeoutMs: BRIDGE_UPLOAD_TIMEOUT_MS,
    });
    return toSource(await this.json(sourceSchema, res));
  }

  /** Văn bản đầy đủ của một nguồn (endpoint `GET /notebooks/{id}/sources/{sid}/fulltext`, thêm vào sidecar ở P5). */
  async getSourceFulltext(id: string, sourceId: string): Promise<BridgeFulltext> {
    let res: ConnectorHttpResponse;
    try {
      res = await this.call("GET", `${nb(id)}/sources/${encodeURIComponent(sourceId)}/fulltext`, { timeoutMs: BRIDGE_UPLOAD_TIMEOUT_MS });
    } catch (err) {
      // Bridge cũ (chưa có endpoint) trả 404 không kèm mã `source_not_found`.
      if (err instanceof ApiError && err.code === "connector_error") {
        const d = err.details as { upstreamStatus?: number; upstreamCode?: string | null } | undefined;
        if (d?.upstreamStatus === 404 && d.upstreamCode !== "source_not_found" && d.upstreamCode !== "notebook_not_found") {
          throw new ApiError(501, "bridge_fulltext_unsupported", "Bridge chưa hỗ trợ xuất văn bản nguồn — hãy nâng cấp sidecar lên bản có /sources/{id}/fulltext");
        }
      }
      throw err;
    }
    const f = await this.json(fulltextSchema, res);
    return { sourceId: f.source_id, title: f.title ?? null, kind: f.kind ?? null, url: f.url ?? null, text: f.text };
  }
}
