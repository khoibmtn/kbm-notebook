/**
 * Kiểu + tiện ích thuần cho Connectors (P5), dùng chung client và server (không import code server-only).
 * Credential KHÔNG bao giờ xuất hiện ở đây: DTO chỉ có trạng thái, nhãn và số liệu hiển thị.
 */

export type ConnectorProvider = "notebooklm-bridge" | "notebooklm-enterprise";
export type ConnectionStatus = "unconfigured" | "ready" | "error";
export type EnterpriseLocation = "global" | "us" | "eu";
export const ENTERPRISE_LOCATIONS: readonly EnterpriseLocation[] = ["global", "us", "eu"] as const;
export type EnterpriseAuthType = "access_token" | "service_account";

/**
 * Trang NotebookLM của một notebook ngoài (liên kết "Mở trong NotebookLM").
 * Chỉ có cho Bridge (NotebookLM cá nhân); Enterprise không có URL công khai ổn định trong tài liệu API nên trả null.
 */
export function externalNotebookUrl(provider: ConnectorProvider, externalId: string): string | null {
  if (provider === "notebooklm-bridge") return `https://notebooklm.google.com/notebook/${encodeURIComponent(externalId)}`;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Cài đặt cấp người dùng                                                       */
/* -------------------------------------------------------------------------- */

export type BridgeSettingsView = {
  configured: boolean;
  url: string | null;
  tokenMask: string | null;
  /** Người dùng đã cho phép gọi tới địa chỉ nội bộ/LAN cho bridge này. */
  allowPrivateHosts: boolean;
};

export type EnterpriseSettingsView = {
  configured: boolean;
  projectNumber: string | null;
  location: EnterpriseLocation;
  authType: EnterpriseAuthType | null;
  /** Token che bớt, hoặc email của service account. */
  secretHint: string | null;
};

export type DriveStatusView = {
  /** Server có `GOOGLE_CLIENT_ID/SECRET` hay không. */
  googleConfigured: boolean;
  /** Người dùng đã liên kết tài khoản Google. */
  linked: boolean;
  /** Tài khoản đó đã cấp `drive.readonly`. */
  hasDriveScope: boolean;
};

export type ConnectorsOverview = {
  bridge: BridgeSettingsView;
  enterprise: EnterpriseSettingsView;
  drive: DriveStatusView;
  /** Chính sách máy chủ: có cho phép bridge nằm ở địa chỉ nội bộ/LAN không (`CONNECTORS_ALLOW_PRIVATE_HOSTS`). */
  privateHostsAllowedByServer: boolean;
};

export type BridgeTestResult = {
  ok: true;
  version: string | null;
  notebooklmPyVersion: string | null;
  authenticated: boolean;
  account: string | null;
  detail: string | null;
  notebookCount: number | null;
};

export type EnterpriseTestResult = {
  ok: true;
  notebookCount: number;
  endpoint: string;
};

/** Notebook ngoài (để chọn trong hộp thoại kết nối). */
export type ExternalNotebook = {
  id: string;
  title: string;
  sourceCount: number | null;
  updatedAt: string | null;
};

export type ExternalSource = {
  id: string;
  title: string;
  kind: string | null;
  status: string | null;
  url: string | null;
};

/* -------------------------------------------------------------------------- */
/* Kết nối trong sổ tay                                                         */
/* -------------------------------------------------------------------------- */

export type ConnectionSourceDto = {
  id: string;
  externalSourceId: string;
  title: string;
  kind: string | null;
  syncedAt: string;
};

export type ConnectionDto = {
  id: string;
  notebookId: string;
  provider: ConnectorProvider;
  externalId: string | null;
  externalUrl: string | null;
  label: string;
  status: ConnectionStatus;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  ownerUserId: string;
  ownerName: string | null;
  /** Kết nối do chính người xem tạo. */
  isMine: boolean;
  sharedWithMembers: boolean;
  /** Người xem được dùng kết nối này (của mình hoặc đã chia sẻ cho thành viên). */
  usable: boolean;
  /** Người xem được hỏi đáp qua kết nối (cần provider có chat; Enterprise thì không). */
  supportsChat: boolean;
  /** Xoá: người tạo hoặc admin+. */
  canDelete: boolean;
  sourceCount: number;
  sources: ConnectionSourceDto[];
};

export const CONNECTION_PROVIDER_LABEL: Record<ConnectorProvider, string> = {
  "notebooklm-bridge": "NotebookLM Bridge",
  "notebooklm-enterprise": "NotebookLM Enterprise",
};

/** Giới hạn độ dài khi gửi văn bản sang Bridge (ghi chú/nguồn). */
export const MAX_PUSH_TEXT_CHARS = 200_000;

/** `"…[1][2]…"` do Bridge tự đánh số → xoá để không lẫn với số trích dẫn `[n]` của KBM. */
export function stripBridgeMarkers(text: string): string {
  return text
    .replace(/\s*\[\s*\d{1,4}(?:\s*[-–—,;]\s*\d{1,4})*\s*\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
