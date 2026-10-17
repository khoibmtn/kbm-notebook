import "server-only";
import type { BridgeTestResult, EnterpriseTestResult, ExternalNotebook } from "@/lib/connectors";
import { BridgeClient } from "./bridge-client";
import { EnterpriseClient, enterpriseHost, type EnterpriseDeps } from "./enterprise-client";
import { resolveBridgeCredential, resolveEnterpriseCredential, type EnterpriseInput } from "./settings";

/**
 * Cấp người dùng (Cài đặt → Kết nối): kiểm tra kết nối THẬT và liệt kê notebook ngoài.
 * Không bao giờ trả "ok" nếu lời gọi thật không thành công — lỗi được ném (`ApiError 502 connector_error`) kèm thông báo gốc.
 */

/** `GET /health` của Bridge (+ đếm notebook nếu đã đăng nhập Google). `authenticated:false` vẫn là kết quả thật (bridge chạy nhưng chưa đăng nhập). */
export async function testBridge(userId: string, input?: { url?: string; token?: string; allowPrivateHosts?: boolean }): Promise<BridgeTestResult> {
  const cred = await resolveBridgeCredential(userId, input);
  const client = new BridgeClient(cred);
  const health = await client.health();
  let notebookCount: number | null = null;
  if (health.authenticated) notebookCount = (await client.listNotebooks()).length;
  return {
    ok: true,
    version: health.version,
    notebooklmPyVersion: health.notebooklmPyVersion,
    authenticated: health.authenticated,
    account: health.account,
    detail: health.detail,
    notebookCount,
  };
}

export async function listBridgeNotebooks(userId: string): Promise<ExternalNotebook[]> {
  const cred = await resolveBridgeCredential(userId);
  return (await new BridgeClient(cred).listNotebooks()).map((n) => ({ id: n.id, title: n.title, sourceCount: n.sourceCount, updatedAt: n.updatedAt }));
}

export async function testEnterprise(userId: string, input?: Partial<EnterpriseInput>, deps?: EnterpriseDeps): Promise<EnterpriseTestResult> {
  const cred = await resolveEnterpriseCredential(userId, input);
  const notebooks = await new EnterpriseClient(cred, deps).listNotebooks();
  return { ok: true, notebookCount: notebooks.length, endpoint: enterpriseHost(cred.location) };
}

export async function listEnterpriseNotebooks(userId: string, deps?: EnterpriseDeps): Promise<ExternalNotebook[]> {
  const cred = await resolveEnterpriseCredential(userId);
  return (await new EnterpriseClient(cred, deps).listNotebooks()).map((n) => ({ id: n.id, title: n.title, sourceCount: n.sourceCount, updatedAt: n.updatedAt }));
}
