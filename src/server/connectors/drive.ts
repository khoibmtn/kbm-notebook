import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { accounts } from "@/server/db/schema";
import { env, googleAuthEnabled } from "@/server/env";
import { createSourceFromFile } from "@/server/knowledge/sources";
import type { SourceVisibility } from "@/lib/sources";
import {
  buildDriveQuery,
  driveExportTarget,
  driveImportFileName,
  isImportableDriveMime,
  type DriveFileDto,
  type DriveFilesPage,
  type DriveImportResult,
} from "@/lib/drive";
import { hasDriveScope } from "./settings";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** Làm mới token sớm hơn hạn này (ms) để không hết hạn giữa chừng. */
const EXPIRY_SKEW_MS = 60_000;
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink";

export type DriveDeps = { fetch?: typeof fetch; now?: () => number };

/* -------------------------------------------------------------------------- */
/* Token                                                                       */
/* -------------------------------------------------------------------------- */

type GoogleAccount = typeof accounts.$inferSelect;

async function googleAccountOf(userId: string): Promise<GoogleAccount | null> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "google")));
  // Ưu tiên tài khoản đã có scope Drive.
  return rows.find((r) => hasDriveScope(r.scope)) ?? rows[0] ?? null;
}

const refreshSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().optional(), scope: z.string().optional() });

/** Gọi trực tiếp token endpoint với refresh token (cần `GOOGLE_CLIENT_ID/SECRET`). Trả access token mới và lưu lại vào `accounts`. */
async function refreshAccessToken(account: GoogleAccount, deps: DriveDeps): Promise<string> {
  const e = env();
  if (!account.refreshToken) {
    throw new ApiError(412, "drive_reauth_required", "Phiên Google Drive đã hết hạn và không có refresh token. Hãy kết nối lại Google Drive trong Cài đặt → Kết nối.");
  }
  const doFetch = deps.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    client_id: e.GOOGLE_CLIENT_ID ?? "",
    client_secret: e.GOOGLE_CLIENT_SECRET ?? "",
  });
  let res: Response;
  try {
    res = await doFetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ApiError(502, "connector_error", `Không làm mới được token Google: ${err instanceof Error ? err.message : "lỗi mạng"}`);
  }
  if (!res.ok) {
    throw new ApiError(412, "drive_reauth_required", "Google từ chối làm mới token (đã bị thu hồi?). Hãy kết nối lại Google Drive trong Cài đặt → Kết nối.");
  }
  const parsed = refreshSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError(502, "connector_error", "Phản hồi làm mới token của Google không hợp lệ");
  const now = (deps.now ?? Date.now)();
  await db
    .update(accounts)
    .set({
      accessToken: parsed.data.access_token,
      accessTokenExpiresAt: parsed.data.expires_in ? new Date(now + parsed.data.expires_in * 1000) : null,
    })
    .where(eq(accounts.id, account.id));
  return parsed.data.access_token;
}

/**
 * Access token Drive của người dùng. Ném 412 với mã cụ thể khi chưa cấu hình Google / chưa liên kết / thiếu scope,
 * để UI hiển thị đúng lời nhắc thay vì lỗi chung.
 */
export async function getDriveAccessToken(userId: string, deps: DriveDeps = {}): Promise<string> {
  if (!googleAuthEnabled()) {
    throw new ApiError(412, "google_not_configured", "Máy chủ chưa cấu hình đăng nhập Google (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET), nên chưa dùng được Google Drive.");
  }
  const account = await googleAccountOf(userId);
  if (!account) throw new ApiError(412, "drive_not_connected", "Bạn chưa liên kết tài khoản Google. Vào Cài đặt → Kết nối → Kết nối Google Drive.");
  if (!hasDriveScope(account.scope)) {
    throw new ApiError(412, "drive_scope_missing", "Tài khoản Google chưa cấp quyền đọc Drive (drive.readonly). Vào Cài đặt → Kết nối → Kết nối Google Drive.");
  }
  const now = (deps.now ?? Date.now)();
  const expires = account.accessTokenExpiresAt?.getTime() ?? null;
  if (account.accessToken && (expires === null || expires - EXPIRY_SKEW_MS > now)) return account.accessToken;
  return refreshAccessToken(account, deps);
}

/* -------------------------------------------------------------------------- */
/* API                                                                         */
/* -------------------------------------------------------------------------- */

const fileSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  mimeType: z.string().default(""),
  modifiedTime: z.string().nullish(),
  size: z.union([z.string(), z.number()]).nullish(),
  webViewLink: z.string().nullish(),
});
const listSchema = z.object({ files: z.array(fileSchema).default([]), nextPageToken: z.string().nullish() });

function toDto(f: z.infer<typeof fileSchema>): DriveFileDto {
  const size = f.size === null || f.size === undefined ? null : Number(f.size);
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime ?? null,
    size: size !== null && Number.isFinite(size) ? size : null,
    webViewLink: f.webViewLink ?? null,
  };
}

async function driveFetch(userId: string, url: string, deps: DriveDeps, init: { as: "json" } | { as: "buffer"; maxBytes: number }): Promise<unknown> {
  let token = await getDriveAccessToken(userId, deps);
  const doFetch = deps.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new ApiError(502, "connector_error", `Không kết nối được tới Google Drive: ${err instanceof Error ? err.message : "lỗi mạng"}`);
    }
    if (res.status === 401 && attempt === 0) {
      // Token đã bị thu hồi/hết hạn sớm: thử làm mới đúng một lần.
      const account = await googleAccountOf(userId);
      if (account) {
        token = await refreshAccessToken(account, deps);
        continue;
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = "";
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
      } catch {
        /* không phải JSON */
      }
      if (res.status === 401 || res.status === 403) {
        throw new ApiError(res.status === 403 ? 403 : 412, res.status === 403 ? "drive_forbidden" : "drive_reauth_required", `Google Drive từ chối truy cập (${res.status})${message ? `: ${message}` : ""}`);
      }
      if (res.status === 404) throw new ApiError(404, "not_found", "Không tìm thấy tệp trên Google Drive");
      throw new ApiError(502, "connector_error", `Google Drive trả về HTTP ${res.status}${message ? `: ${message}` : ""}`);
    }
    if (init.as === "json") return res.json();
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > init.maxBytes) throw new ApiError(413, "payload_too_large", `Tệp vượt quá ${Math.round(init.maxBytes / 1024 / 1024)}MB`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > init.maxBytes) throw new ApiError(413, "payload_too_large", `Tệp vượt quá ${Math.round(init.maxBytes / 1024 / 1024)}MB`);
    return buf;
  }
  throw new ApiError(412, "drive_reauth_required", "Không làm mới được phiên Google Drive. Hãy kết nối lại.");
}

/** Danh sách tệp gần đây (mặc định) hoặc tìm theo tên/nội dung. */
export async function listDriveFiles(
  userId: string,
  opts: { q?: string; pageToken?: string; pageSize?: number } = {},
  deps: DriveDeps = {},
): Promise<DriveFilesPage> {
  const params = new URLSearchParams({
    q: buildDriveQuery(opts.q),
    pageSize: String(Math.min(Math.max(opts.pageSize ?? 25, 1), 100)),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  // Tìm kiếm toàn văn không kết hợp với sắp xếp theo thời gian trên mọi truy vấn → chỉ sắp khi liệt kê "gần đây".
  if (!opts.q?.trim()) params.set("orderBy", "modifiedTime desc");
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const data = listSchema.parse(await driveFetch(userId, `${DRIVE_API}/files?${params}`, deps, { as: "json" }));
  return { files: data.files.map(toDto).filter((f) => isImportableDriveMime(f.mimeType)), nextPageToken: data.nextPageToken ?? null };
}

/** Tải một tệp Drive về bộ nhớ: tệp Google gốc → export Office, tệp thường → `alt=media`. */
export async function downloadDriveFile(
  userId: string,
  fileId: string,
  maxBytes: number,
  deps: DriveDeps = {},
): Promise<{ meta: DriveFileDto; fileName: string; mime: string; data: Buffer }> {
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(fileId)) throw ApiError.badRequest("Mã tệp Google Drive không hợp lệ");
  const meta = toDto(
    fileSchema.parse(await driveFetch(userId, `${DRIVE_API}/files/${fileId}?fields=${FILE_FIELDS}&supportsAllDrives=true`, deps, { as: "json" })),
  );
  if (!isImportableDriveMime(meta.mimeType)) {
    throw new ApiError(415, "unsupported_type", `Định dạng của “${meta.name}” (${meta.mimeType || "không rõ"}) chưa được hỗ trợ`);
  }
  const target = driveExportTarget(meta.mimeType);
  const url = target
    ? `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(target.mime)}`
    : `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`;
  const data = (await driveFetch(userId, url, deps, { as: "buffer", maxBytes })) as Buffer;
  return { meta, fileName: driveImportFileName(meta.name, meta.mimeType), mime: target?.mime ?? meta.mimeType, data };
}

/** Nhập các tệp Drive vào sổ tay: tải về → `files` + `sources(kind='drive', metadata.driveFileId)` + job ingest. */
export async function importDriveFiles(
  input: { userId: string; notebookId: string; fileIds: string[]; visibility: SourceVisibility },
  deps: DriveDeps = {},
): Promise<DriveImportResult> {
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  const result: DriveImportResult = { imported: [], failed: [] };
  // Kiểm tra token một lần để lỗi chung (chưa kết nối…) trả về dạng HTTP lỗi thay vì từng tệp.
  await getDriveAccessToken(input.userId, deps);
  for (const fileId of [...new Set(input.fileIds)]) {
    try {
      const dl = await downloadDriveFile(input.userId, fileId, maxBytes, deps);
      const file = new File([new Uint8Array(dl.data)], dl.fileName, { type: dl.mime });
      const source = await createSourceFromFile({
        notebookId: input.notebookId,
        userId: input.userId,
        file,
        visibility: input.visibility,
        kind: "drive",
        metadata: { driveFileId: fileId, driveMimeType: dl.meta.mimeType, driveModifiedTime: dl.meta.modifiedTime, driveLink: dl.meta.webViewLink },
      });
      result.imported.push({ driveFileId: fileId, sourceId: source.id, title: source.title });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "drive_reauth_required" || err.code === "drive_not_connected" || err.code === "drive_scope_missing" || err.code === "google_not_configured")) throw err;
      result.failed.push({ driveFileId: fileId, name: null, message: err instanceof Error ? err.message : "Lỗi không xác định" });
    }
  }
  return result;
}
