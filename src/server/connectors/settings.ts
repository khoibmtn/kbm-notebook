import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { accounts, userSettings } from "@/server/db/schema";
import { decrypt, encrypt, maskSecret } from "@/server/crypto";
import { googleAuthEnabled, privateConnectorHostsAllowed } from "@/server/env";
import { ensureUserSettings } from "@/server/settings/service";
import { ENTERPRISE_LOCATIONS, type BridgeSettingsView, type ConnectorsOverview, type DriveStatusView, type EnterpriseSettingsView } from "@/lib/connectors";
import type { BridgeCredential } from "./bridge-client";
import type { EnterpriseCredential } from "./enterprise-client";
import { assertConnectorUrl } from "./http";

/**
 * Cấu hình kết nối cấp người dùng (Cài đặt → Kết nối). Lưu **một** chuỗi JSON mã hoá AES-256-GCM ở
 * `user_settings.connectors_enc` (cột thêm ở migration 0001). Secret không bao giờ rời server: view trả về chỉ có dạng che.
 */

const storedSchema = z.object({
  bridge: z
    .object({ url: z.string().min(1), token: z.string().min(1), allowPrivateHosts: z.boolean().default(false) })
    .optional(),
  enterprise: z
    .object({
      projectNumber: z.string().min(1),
      location: z.enum(ENTERPRISE_LOCATIONS as unknown as [string, ...string[]]),
      auth: z.discriminatedUnion("type", [
        z.object({ type: z.literal("access_token"), accessToken: z.string().min(1) }),
        z.object({ type: z.literal("service_account"), serviceAccountJson: z.string().min(1) }),
      ]),
    })
    .optional(),
});
type Stored = z.infer<typeof storedSchema>;

async function readStored(userId: string): Promise<Stored> {
  const s = await ensureUserSettings(userId);
  if (!s.connectorsEnc) return {};
  try {
    const parsed = storedSchema.safeParse(JSON.parse(decrypt(s.connectorsEnc)));
    return parsed.success ? parsed.data : {};
  } catch {
    // Khoá mã hoá đã đổi / dữ liệu hỏng: coi như chưa cấu hình (người dùng nhập lại).
    return {};
  }
}

async function writeStored(userId: string, data: Stored): Promise<void> {
  await ensureUserSettings(userId);
  const empty = !data.bridge && !data.enterprise;
  await db
    .update(userSettings)
    .set({ connectorsEnc: empty ? null : encrypt(JSON.stringify(data)) })
    .where(eq(userSettings.userId, userId));
}

/* -------------------------------------------------------------------------- */
/* Bridge                                                                      */
/* -------------------------------------------------------------------------- */

export function normalizeBridgeUrl(raw: string, allowPrivateHosts: boolean): string {
  const url = assertConnectorUrl(raw, { allowPrivateHosts });
  // Bỏ query/hash; giữ path (reverse proxy có thể đặt bridge dưới tiền tố).
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export type BridgeInput = { url: string; token?: string; allowPrivateHosts: boolean };

export async function getBridgeCredential(userId: string): Promise<BridgeCredential | null> {
  const b = (await readStored(userId)).bridge;
  return b ? { url: b.url, token: b.token, allowPrivateHosts: b.allowPrivateHosts } : null;
}

/** Credential để kiểm tra: ưu tiên giá trị người dùng đang nhập (chưa lưu), thiếu token thì dùng token đã lưu. */
export async function resolveBridgeCredential(userId: string, input?: { url?: string; token?: string; allowPrivateHosts?: boolean }): Promise<BridgeCredential> {
  const saved = (await readStored(userId)).bridge;
  const allowPrivateHosts = input?.allowPrivateHosts ?? saved?.allowPrivateHosts ?? false;
  const urlRaw = input?.url?.trim() || saved?.url;
  const token = input?.token?.trim() || saved?.token;
  if (!urlRaw) throw new ApiError(400, "connector_not_configured", "Chưa nhập URL của NotebookLM Bridge");
  if (!token) throw new ApiError(400, "connector_not_configured", "Chưa nhập token của NotebookLM Bridge");
  return { url: normalizeBridgeUrl(urlRaw, allowPrivateHosts), token, allowPrivateHosts };
}

export async function saveBridgeSettings(userId: string, input: BridgeInput): Promise<void> {
  const stored = await readStored(userId);
  const token = input.token?.trim() || stored.bridge?.token;
  if (!token) throw new ApiError(400, "validation_error", "Token là bắt buộc");
  const url = normalizeBridgeUrl(input.url, input.allowPrivateHosts);
  await writeStored(userId, { ...stored, bridge: { url, token, allowPrivateHosts: input.allowPrivateHosts } });
}

export async function clearBridgeSettings(userId: string): Promise<void> {
  const stored = await readStored(userId);
  delete stored.bridge;
  await writeStored(userId, stored);
}

/* -------------------------------------------------------------------------- */
/* Enterprise                                                                  */
/* -------------------------------------------------------------------------- */

export type EnterpriseInput = {
  projectNumber: string;
  location: (typeof ENTERPRISE_LOCATIONS)[number];
  /** Bỏ trống = giữ xác thực đã lưu. */
  auth?: EnterpriseCredential["auth"];
};

/** Kiểm tra JSON service account: phải có `client_email`, `private_key`, `type=service_account`. */
export function parseServiceAccountJson(raw: string): { clientEmail: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "invalid_service_account", "Service account JSON không hợp lệ");
  }
  const o = obj as { type?: unknown; client_email?: unknown; private_key?: unknown };
  if (o?.type !== "service_account" || typeof o.client_email !== "string" || typeof o.private_key !== "string") {
    throw new ApiError(400, "invalid_service_account", "Service account JSON thiếu type/client_email/private_key");
  }
  return { clientEmail: o.client_email };
}

export async function getEnterpriseCredential(userId: string): Promise<EnterpriseCredential | null> {
  const e = (await readStored(userId)).enterprise;
  return e ? { projectNumber: e.projectNumber, location: e.location as EnterpriseCredential["location"], auth: e.auth } : null;
}

export async function resolveEnterpriseCredential(userId: string, input?: Partial<EnterpriseInput>): Promise<EnterpriseCredential> {
  const saved = (await readStored(userId)).enterprise;
  const projectNumber = input?.projectNumber?.trim() || saved?.projectNumber;
  const location = (input?.location ?? saved?.location) as EnterpriseCredential["location"] | undefined;
  const auth = input?.auth ?? saved?.auth;
  if (!projectNumber) throw new ApiError(400, "connector_not_configured", "Chưa nhập số dự án (project number)");
  if (!/^\d{4,20}$/.test(projectNumber)) throw new ApiError(400, "validation_error", "Số dự án phải là dãy số (project NUMBER, không phải project ID)");
  if (!location) throw new ApiError(400, "connector_not_configured", "Chưa chọn location");
  if (!auth) throw new ApiError(400, "connector_not_configured", "Chưa nhập access token hoặc service account JSON");
  if (auth.type === "service_account") parseServiceAccountJson(auth.serviceAccountJson);
  return { projectNumber, location, auth };
}

export async function saveEnterpriseSettings(userId: string, input: EnterpriseInput): Promise<void> {
  const stored = await readStored(userId);
  const cred = await resolveEnterpriseCredential(userId, input);
  await writeStored(userId, { ...stored, enterprise: { projectNumber: cred.projectNumber, location: cred.location, auth: cred.auth } });
}

export async function clearEnterpriseSettings(userId: string): Promise<void> {
  const stored = await readStored(userId);
  delete stored.enterprise;
  await writeStored(userId, stored);
}

/* -------------------------------------------------------------------------- */
/* Google Drive                                                                */
/* -------------------------------------------------------------------------- */

export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function hasDriveScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/[\s,]+/).some((s) => s === DRIVE_READONLY_SCOPE || s === "https://www.googleapis.com/auth/drive");
}

export async function getDriveStatus(userId: string): Promise<DriveStatusView> {
  const rows = await db
    .select({ scope: accounts.scope })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "google")));
  return {
    googleConfigured: googleAuthEnabled(),
    linked: rows.length > 0,
    hasDriveScope: rows.some((r) => hasDriveScope(r.scope)),
  };
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

export function toBridgeView(b: Stored["bridge"]): BridgeSettingsView {
  return b
    ? { configured: true, url: b.url, tokenMask: maskSecret(b.token), allowPrivateHosts: b.allowPrivateHosts }
    : { configured: false, url: null, tokenMask: null, allowPrivateHosts: false };
}

export function toEnterpriseView(e: Stored["enterprise"]): EnterpriseSettingsView {
  if (!e) return { configured: false, projectNumber: null, location: "global", authType: null, secretHint: null };
  let secretHint: string | null;
  if (e.auth.type === "access_token") secretHint = maskSecret(e.auth.accessToken);
  else {
    try {
      secretHint = parseServiceAccountJson(e.auth.serviceAccountJson).clientEmail;
    } catch {
      secretHint = null;
    }
  }
  return { configured: true, projectNumber: e.projectNumber, location: e.location as EnterpriseSettingsView["location"], authType: e.auth.type, secretHint };
}

export async function getConnectorsOverview(userId: string): Promise<ConnectorsOverview> {
  const [stored, drive] = await Promise.all([readStored(userId), getDriveStatus(userId)]);
  return {
    bridge: toBridgeView(stored.bridge),
    enterprise: toEnterpriseView(stored.enterprise),
    drive,
    privateHostsAllowedByServer: privateConnectorHostsAllowed(),
  };
}
