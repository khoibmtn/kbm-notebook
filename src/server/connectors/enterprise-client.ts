import "server-only";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import type { EnterpriseAuthType, EnterpriseLocation } from "@/lib/connectors";

/**
 * Client REST cho NotebookLM Enterprise API (Google Cloud Discovery Engine `v1alpha`, **Preview**).
 * Tài liệu: https://cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks
 *
 * API này có quản lý notebook / nguồn / chia sẻ nhưng KHÔNG có endpoint hỏi đáp (chat) → xem
 * `providers/notebooklm-enterprise.ts` (retrieve ném 501 not_supported).
 */

export const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export type EnterpriseAuth =
  | { type: Extract<EnterpriseAuthType, "access_token">; accessToken: string }
  | { type: Extract<EnterpriseAuthType, "service_account">; serviceAccountJson: string };

export type EnterpriseCredential = {
  /** Số dự án GCP (project NUMBER, không phải project ID). */
  projectNumber: string;
  location: EnterpriseLocation;
  auth: EnterpriseAuth;
};

/** `us-discoveryengine.googleapis.com`, `eu-…`, `global-…`. */
export function enterpriseHost(location: EnterpriseLocation): string {
  return `${location}-discoveryengine.googleapis.com`;
}

/** `https://{loc}-discoveryengine.googleapis.com/v1alpha/projects/{n}/locations/{loc}` */
export function enterpriseParent(cred: Pick<EnterpriseCredential, "projectNumber" | "location">): string {
  return `https://${enterpriseHost(cred.location)}/v1alpha/projects/${encodeURIComponent(cred.projectNumber)}/locations/${cred.location}`;
}

export const enterpriseUrls = {
  list: (cred: Pick<EnterpriseCredential, "projectNumber" | "location">, pageSize = 100) =>
    `${enterpriseParent(cred)}/notebooks:listRecentlyViewed?pageSize=${pageSize}`,
  create: (cred: Pick<EnterpriseCredential, "projectNumber" | "location">) => `${enterpriseParent(cred)}/notebooks`,
  get: (cred: Pick<EnterpriseCredential, "projectNumber" | "location">, notebookId: string) =>
    `${enterpriseParent(cred)}/notebooks/${encodeURIComponent(notebookId)}`,
  addSources: (cred: Pick<EnterpriseCredential, "projectNumber" | "location">, notebookId: string) =>
    `${enterpriseParent(cred)}/notebooks/${encodeURIComponent(notebookId)}/sources:batchCreate`,
  share: (cred: Pick<EnterpriseCredential, "projectNumber" | "location">, notebookId: string) =>
    `${enterpriseParent(cred)}/notebooks/${encodeURIComponent(notebookId)}:share`,
};

export type EnterpriseNotebook = {
  id: string;
  name: string;
  title: string;
  updatedAt: string | null;
  sourceCount: number | null;
};

export type EnterpriseSource = { id: string; title: string; kind: string | null; status: string | null };

export type EnterpriseSourceInput =
  | { kind: "text"; title: string; content: string }
  | { kind: "web"; title?: string; url: string };

export type EnterpriseShareRole = "PROJECT_ROLE_READER" | "PROJECT_ROLE_WRITER";

const lastSegment = (name: string) => name.split("/").filter(Boolean).pop() ?? name;

const notebookSchema = z.object({
  name: z.string().optional(),
  notebookId: z.string().optional(),
  title: z.string().nullish(),
  sources: z.array(z.unknown()).optional(),
  metadata: z
    .object({ lastViewed: z.string().nullish(), createTime: z.string().nullish() })
    .partial()
    .nullish(),
});
const listSchema = z.object({ notebooks: z.array(notebookSchema).default([]) });
const sourceSchema = z.object({
  name: z.string().optional(),
  title: z.string().nullish(),
  sourceId: z.object({ id: z.string().optional() }).partial().nullish(),
  settings: z.object({ status: z.string().nullish() }).partial().nullish(),
  metadata: z.object({ sourceType: z.string().nullish() }).partial().passthrough().nullish(),
});
const googleErrorSchema = z.object({
  error: z.object({ code: z.number().optional(), status: z.string().optional(), message: z.string().optional() }).optional(),
});

function toNotebook(n: z.infer<typeof notebookSchema>): EnterpriseNotebook | null {
  const id = n.notebookId ?? (n.name ? lastSegment(n.name) : null);
  if (!id) return null;
  return {
    id,
    name: n.name ?? id,
    title: n.title?.trim() || "(Không tên)",
    updatedAt: n.metadata?.lastViewed ?? n.metadata?.createTime ?? null,
    sourceCount: n.sources ? n.sources.length : null,
  };
}

function toSource(raw: unknown): EnterpriseSource | null {
  const s = sourceSchema.safeParse(raw);
  if (!s.success) return null;
  const id = s.data.sourceId?.id ?? (s.data.name ? lastSegment(s.data.name) : null);
  if (!id) return null;
  return {
    id,
    title: s.data.title?.trim() || "(Nguồn không tên)",
    kind: (s.data.metadata as { sourceType?: string | null } | null | undefined)?.sourceType ?? null,
    status: s.data.settings?.status ?? null,
  };
}

/** Thông báo dễ hiểu cho các lỗi thường gặp của Google API. */
export function describeGoogleFailure(status: number, body: string): string {
  let message = "";
  try {
    const p = googleErrorSchema.safeParse(JSON.parse(body));
    if (p.success) message = p.data.error?.message ?? "";
  } catch {
    /* không phải JSON */
  }
  if (status === 401) return `Token không hợp lệ hoặc đã hết hạn (401)${message ? `: ${message}` : ""}. Access token chỉ sống khoảng 1 giờ — dán token mới hoặc dùng service account.`;
  if (status === 403) {
    return `Không có quyền gọi NotebookLM Enterprise (403)${message ? `: ${message}` : ""}. Cần license Gemini Enterprise/NotebookLM Enterprise, bật Discovery Engine API và vai trò Cloud NotebookLM User.`;
  }
  if (status === 404) return `Không tìm thấy tài nguyên (404)${message ? `: ${message}` : ""}. Kiểm tra số dự án, location và ID notebook.`;
  return message ? `${message} (HTTP ${status})` : `NotebookLM Enterprise trả về HTTP ${status}`;
}

export type EnterpriseDeps = {
  fetch?: typeof fetch;
  /** Ghi đè cách lấy access token (test). */
  getAccessToken?: (auth: EnterpriseAuth) => Promise<string>;
};

/** Lấy access token: dán tay → dùng nguyên; service account → `google-auth-library` mint token (scope cloud-platform). */
export async function resolveAccessToken(auth: EnterpriseAuth): Promise<string> {
  if (auth.type === "access_token") return auth.accessToken.trim();
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(auth.serviceAccountJson) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_service_account", "Service account JSON không hợp lệ");
  }
  try {
    const client = new GoogleAuth({ credentials, scopes: [CLOUD_PLATFORM_SCOPE] });
    const token = await client.getAccessToken();
    if (!token) throw new Error("Không nhận được access token");
    return token;
  } catch (e) {
    throw new ApiError(502, "connector_error", `Không lấy được access token từ service account: ${e instanceof Error ? e.message : "lỗi không rõ"}`);
  }
}

export class EnterpriseClient {
  constructor(
    private readonly cred: EnterpriseCredential,
    private readonly deps: EnterpriseDeps = {},
  ) {}

  private async call(method: "GET" | "POST", url: string, json?: unknown): Promise<unknown> {
    const token = await (this.deps.getAccessToken ?? resolveAccessToken)(this.cred.auth);
    const doFetch = this.deps.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: json !== undefined ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new ApiError(502, "connector_error", `Không kết nối được tới ${new URL(url).host}: ${e instanceof Error ? e.message : "lỗi mạng"}`);
    }
    const text = await res.text();
    if (!res.ok) throw new ApiError(502, "connector_error", describeGoogleFailure(res.status, text), { upstreamStatus: res.status });
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(502, "connector_error", "Phản hồi của NotebookLM Enterprise không phải JSON");
    }
  }

  /** `notebooks:listRecentlyViewed` — dùng cho cả "Kiểm tra" và chọn notebook. */
  async listNotebooks(): Promise<EnterpriseNotebook[]> {
    const data = listSchema.parse(await this.call("GET", enterpriseUrls.list(this.cred)));
    return data.notebooks.map(toNotebook).filter((n): n is EnterpriseNotebook => n !== null);
  }

  async getNotebook(id: string): Promise<EnterpriseNotebook & { sources: EnterpriseSource[] }> {
    const raw = await this.call("GET", enterpriseUrls.get(this.cred, id));
    const parsed = notebookSchema.parse(raw);
    const nb = toNotebook(parsed);
    if (!nb) throw new ApiError(502, "connector_error", "Phản hồi notebook không có ID");
    const sources = (parsed.sources ?? []).map(toSource).filter((s): s is EnterpriseSource => s !== null);
    return { ...nb, sourceCount: sources.length, sources };
  }

  async createNotebook(title: string): Promise<EnterpriseNotebook> {
    const nb = toNotebook(notebookSchema.parse(await this.call("POST", enterpriseUrls.create(this.cred), { title })));
    if (!nb) throw new ApiError(502, "connector_error", "Phản hồi tạo notebook không có ID");
    return nb;
  }

  /** `sources:batchCreate` với nội dung văn bản hoặc URL web. */
  async addSources(notebookId: string, inputs: EnterpriseSourceInput[]): Promise<void> {
    const userContents = inputs.map((i) =>
      i.kind === "text"
        ? { textContent: { sourceName: i.title, content: i.content } }
        : { webContent: { url: i.url, ...(i.title ? { sourceName: i.title } : {}) } },
    );
    await this.call("POST", enterpriseUrls.addSources(this.cred, notebookId), { userContents });
  }

  async share(notebookId: string, accounts: { email: string; role: EnterpriseShareRole }[]): Promise<void> {
    await this.call("POST", enterpriseUrls.share(this.cred, notebookId), {
      accountAndRoles: accounts.map((a) => ({ email: a.email, role: a.role })),
    });
  }
}
