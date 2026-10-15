import { describe, expect, it, vi } from "vitest";

/** Không gọi Google thật: ghi lại tuỳ chọn khởi tạo để kiểm tra scope + credentials của service account. */
const gauth = vi.hoisted(() => ({ ctor: [] as unknown[], token: "ya29.minted-token" as string | null }));
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    constructor(opts: unknown) {
      gauth.ctor.push(opts);
    }
    async getAccessToken() {
      return gauth.token;
    }
  },
}));
import { buildContext } from "@/server/ai/context";
import { buildSourcesUsed } from "@/server/ai/citations";
import type { NotebookConnection } from "@/server/db/schema";
import { toConnectionDto } from "@/server/connectors/connections";
import {
  describeGoogleFailure,
  enterpriseHost,
  enterpriseParent,
  enterpriseUrls,
  resolveAccessToken,
} from "@/server/connectors/enterprise-client";
import { describeBridgeFailure, type BridgeAskResult } from "@/server/connectors/bridge-client";
import { assertConnectorUrl, isAlwaysBlockedIp, isPrivateHostUrl } from "@/server/connectors/http";
import { hasDriveScope, parseServiceAccountJson } from "@/server/connectors/settings";
import { bridgeResultToEvidence, NotebookLmBridgeProvider } from "@/server/knowledge/providers/notebooklm-bridge";
import { ENTERPRISE_NO_CHAT_MESSAGE, NotebookLmEnterpriseProvider } from "@/server/knowledge/providers/notebooklm-enterprise";
import { externalNotebookUrl, stripBridgeMarkers } from "@/lib/connectors";
import {
  buildDriveQuery,
  driveExportTarget,
  driveImportFileName,
  escapeDriveQueryValue,
  GOOGLE_DOC,
  GOOGLE_FOLDER,
  GOOGLE_SHEET,
  GOOGLE_SLIDES,
  isImportableDriveMime,
} from "@/lib/drive";

const CTX = { connectionId: "11111111-1111-4111-8111-111111111111", externalId: "nb-ext-1", label: "Giải phẫu" };

function bridgeResult(over: Partial<BridgeAskResult> = {}): BridgeAskResult {
  return {
    answer: "Tim có bốn buồng [1][2]. Máu đi theo vòng tuần hoàn [3].",
    conversationId: "conv-1",
    references: [
      { sourceId: "s1", sourceTitle: "Giải phẫu tim", citationNumber: 1, citedText: "Tim gồm hai tâm nhĩ và hai tâm thất.", startChar: 10, endChar: 45, score: null },
      { sourceId: "s2", sourceTitle: null, citationNumber: 2, citedText: "Bốn buồng tim.", startChar: 0, endChar: 14, score: null },
      // trùng lặp hoàn toàn với tham chiếu 1
      { sourceId: "s1", sourceTitle: "Giải phẫu tim", citationNumber: 3, citedText: "Tim gồm hai tâm nhĩ và hai tâm thất.", startChar: 10, endChar: 45, score: null },
      // không có văn bản trích → bỏ
      { sourceId: "s3", sourceTitle: "Rỗng", citationNumber: 4, citedText: "  ", startChar: 1, endChar: 2, score: null },
    ],
    ...over,
  };
}

describe("bridgeResultToEvidence", () => {
  it("tham chiếu đã khử trùng đi trước; câu trả lời của bridge là bằng chứng external_answer ở cuối (xoá [n] riêng của bridge)", () => {
    const ev = bridgeResultToEvidence(bridgeResult(), { ...CTX, sourceTitles: new Map([["s2", "Bốn buồng (cache)"]]) });
    expect(ev).toHaveLength(3);

    const [r1, r2, answer] = ev;
    expect(answer).toMatchObject({
      provider: "notebooklm-bridge",
      kind: "external_answer",
      connectionId: CTX.connectionId,
      sourceId: null,
      sourceTitle: "Câu trả lời của NotebookLM · Giải phẫu",
      externalUrl: "https://notebooklm.google.com/notebook/nb-ext-1",
    });
    expect(answer.text).toBe("Tim có bốn buồng. Máu đi theo vòng tuần hoàn.");
    expect(answer.text).not.toMatch(/\[\d+\]/);

    expect(r1).toMatchObject({
      provider: "notebooklm-bridge",
      kind: "chunk",
      sourceId: "s1",
      sourceTitle: "Giải phẫu tim",
      text: "Tim gồm hai tâm nhĩ và hai tâm thất.",
      locator: { startChar: 10, endChar: 45, section: "NotebookLM" },
      connectionId: CTX.connectionId,
    });
    // bridge không trả source_title → lấy từ cache connection_sources
    expect(r2).toMatchObject({ sourceId: "s2", sourceTitle: "Bốn buồng (cache)" });
    // id duy nhất, điểm giảm dần
    expect(new Set(ev.map((e) => e.id)).size).toBe(ev.length);
    expect(ev.map((e) => e.score)).toEqual([...ev.map((e) => e.score)].sort((a, b) => b - a));
  });

  it("không có câu trả lời và không có tham chiếu → rỗng; thiếu tiêu đề → nhãn mặc định", () => {
    expect(bridgeResultToEvidence(bridgeResult({ answer: "  ", references: [] }), CTX)).toEqual([]);
    const [only] = bridgeResultToEvidence(
      bridgeResult({ answer: "", references: [{ sourceId: "zz", sourceTitle: null, citationNumber: null, citedText: "đoạn", startChar: null, endChar: null, score: null }] }),
      CTX,
    );
    expect(only.sourceTitle).toBe("Nguồn trong NotebookLM");
    expect(only.locator).toEqual({ startChar: undefined, endChar: undefined, section: "NotebookLM" });
  });

  it("đánh số [n] liên tục sau kho cục bộ và giữ phân biệt nguồn theo kết nối", () => {
    const local = [
      { id: "c1", provider: "local" as const, sourceId: "L1", sourceTitle: "Nguồn cục bộ", locator: { page: 2 }, text: "nội dung cục bộ", score: 0.03 },
    ];
    const conn = bridgeResultToEvidence(bridgeResult(), CTX);
    const { evidence, contextText } = buildContext([...local, ...conn]);
    expect(evidence).toHaveLength(4);
    expect(contextText).toContain('[1] Nguồn: "Nguồn cục bộ"');
    expect(contextText).toContain('[2] Nguồn: "Giải phẫu tim"');
    expect(contextText).toContain('[4] Nguồn: "Câu trả lời của NotebookLM · Giải phẫu"');
    expect(contextText).not.toContain("[1][2]");
    const used = buildSourcesUsed(evidence, [1, 2, 3, 4, 4]);
    expect(used.map((u) => u.numbers)).toEqual([[1], [2], [3], [4, 4]]);
    expect(used[3].url).toBe("https://notebooklm.google.com/notebook/nb-ext-1");
    // hai kết nối khác nhau có thể trùng sourceId ngoài nhưng không bị gộp nguồn
    const other = bridgeResultToEvidence(bridgeResult(), { ...CTX, connectionId: "22222222-2222-4222-8222-222222222222" });
    const merged = buildSourcesUsed([...conn, ...other], [1, 4]);
    expect(merged).toHaveLength(2);
  });
});

describe("NotebookLmBridgeProvider", () => {
  it("retrieve → gọi ask đúng notebook với câu hỏi đã cắt khoảng trắng; câu hỏi rỗng không gọi", async () => {
    const calls: string[][] = [];
    const provider = new NotebookLmBridgeProvider(CTX, {
      ask: async (id: string, q: string) => {
        calls.push([id, q]);
        return bridgeResult();
      },
    });
    expect(provider.kind).toBe("notebooklm-bridge");
    const ev = await provider.retrieve({ query: "  Tim mấy buồng?  ", notebookId: "n", userId: "u" });
    expect(calls).toEqual([["nb-ext-1", "Tim mấy buồng?"]]);
    expect(ev.length).toBeGreaterThan(0);
    expect(await provider.retrieve({ query: "   ", notebookId: "n", userId: "u" })).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("NotebookLmEnterpriseProvider", () => {
  it("retrieve ném 501 not_supported (không có chat API)", async () => {
    const provider = new NotebookLmEnterpriseProvider({
      listNotebooks: async () => [],
      getNotebook: async () => ({ id: "a", name: "a", title: "A", updatedAt: null, sourceCount: 0, sources: [] }),
      createNotebook: async () => ({ id: "a", name: "a", title: "A", updatedAt: null, sourceCount: null }),
      addSources: async () => undefined,
      share: async () => undefined,
    });
    await expect(provider.retrieve({ query: "q", notebookId: "n", userId: "u" })).rejects.toMatchObject({
      status: 501,
      code: "not_supported",
      message: ENTERPRISE_NO_CHAT_MESSAGE,
    });
  });
});

describe("enterprise URL building", () => {
  const cred = { projectNumber: "123456789012", location: "us" as const };

  it("host theo location và parent v1alpha", () => {
    expect(enterpriseHost("global")).toBe("global-discoveryengine.googleapis.com");
    expect(enterpriseHost("eu")).toBe("eu-discoveryengine.googleapis.com");
    expect(enterpriseParent(cred)).toBe("https://us-discoveryengine.googleapis.com/v1alpha/projects/123456789012/locations/us");
  });

  it("các endpoint notebooks / sources / share", () => {
    expect(enterpriseUrls.list(cred)).toBe("https://us-discoveryengine.googleapis.com/v1alpha/projects/123456789012/locations/us/notebooks:listRecentlyViewed?pageSize=100");
    expect(enterpriseUrls.create(cred)).toMatch(/\/locations\/us\/notebooks$/);
    expect(enterpriseUrls.get(cred, "abc")).toMatch(/\/notebooks\/abc$/);
    expect(enterpriseUrls.addSources(cred, "abc")).toMatch(/\/notebooks\/abc\/sources:batchCreate$/);
    expect(enterpriseUrls.share(cred, "abc")).toMatch(/\/notebooks\/abc:share$/);
    // ID có ký tự đặc biệt được mã hoá, không phá cấu trúc đường dẫn
    expect(enterpriseUrls.get(cred, "a/b?c")).toMatch(/\/notebooks\/a%2Fb%3Fc$/);
  });

  it("mô tả lỗi Google dễ hiểu (401 hết hạn, 403 quyền)", () => {
    expect(describeGoogleFailure(401, "{}")).toContain("hết hạn");
    expect(describeGoogleFailure(403, JSON.stringify({ error: { message: "Permission denied" } }))).toContain("Permission denied");
    expect(describeGoogleFailure(500, "not json")).toContain("HTTP 500");
  });

  it("service account: mint token bằng google-auth-library với scope cloud-platform; không có token → lỗi 502 rõ ràng", async () => {
    const sa = { type: "service_account", client_email: "sa@p.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" };
    expect(await resolveAccessToken({ type: "service_account", serviceAccountJson: JSON.stringify(sa) })).toBe("ya29.minted-token");
    expect(gauth.ctor.at(-1)).toEqual({ credentials: sa, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    gauth.token = null;
    await expect(resolveAccessToken({ type: "service_account", serviceAccountJson: JSON.stringify(sa) })).rejects.toMatchObject({ status: 502, code: "connector_error" });
    gauth.token = "ya29.minted-token";
  });

  it("access token dán tay được dùng nguyên; service account JSON sai → 400", async () => {
    expect(await resolveAccessToken({ type: "access_token", accessToken: "  ya29.token  " })).toBe("ya29.token");
    await expect(resolveAccessToken({ type: "service_account", serviceAccountJson: "{oops" })).rejects.toMatchObject({ status: 400, code: "invalid_service_account" });
    expect(() => parseServiceAccountJson(JSON.stringify({ type: "authorized_user" }))).toThrow(/thiếu/);
    expect(parseServiceAccountJson(JSON.stringify({ type: "service_account", client_email: "sa@p.iam.gserviceaccount.com", private_key: "k" }))).toEqual({ clientEmail: "sa@p.iam.gserviceaccount.com" });
  });
});

describe("Google Drive", () => {
  it("ánh xạ MIME export: Docs→docx, Slides→pptx, Sheets→xlsx", () => {
    expect(driveExportTarget(GOOGLE_DOC)).toEqual({ mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" });
    expect(driveExportTarget(GOOGLE_SLIDES)?.ext).toBe("pptx");
    expect(driveExportTarget(GOOGLE_SHEET)?.ext).toBe("xlsx");
    expect(driveExportTarget("application/pdf")).toBeNull();
  });

  it("chỉ nhập loại tệp hỗ trợ (không thư mục, không video)", () => {
    expect(isImportableDriveMime(GOOGLE_DOC)).toBe(true);
    expect(isImportableDriveMime("application/pdf")).toBe(true);
    expect(isImportableDriveMime("text/markdown")).toBe(true);
    expect(isImportableDriveMime(GOOGLE_FOLDER)).toBe(false);
    expect(isImportableDriveMime("video/mp4")).toBe(false);
  });

  it("tên tệp khi nhập có đuôi theo định dạng export", () => {
    expect(driveImportFileName("Bài giảng", GOOGLE_SLIDES)).toBe("Bài giảng.pptx");
    expect(driveImportFileName("Báo cáo.docx", GOOGLE_DOC)).toBe("Báo cáo.docx");
    expect(driveImportFileName("a/b.pdf", "application/pdf")).toBe("a_b.pdf");
  });

  it("truy vấn files.list thoát ký tự đặc biệt và giới hạn MIME", () => {
    expect(escapeDriveQueryValue("O'Neil \\ x")).toBe("O\\'Neil \\\\ x");
    const q = buildDriveQuery("tim' or 1=1");
    expect(q).toContain("trashed = false");
    expect(q).toContain(`mimeType != '${GOOGLE_FOLDER}'`);
    expect(q).toContain(`mimeType = '${GOOGLE_DOC}'`);
    expect(q).toContain("name contains 'tim\\' or 1=1'");
    expect(buildDriveQuery()).not.toContain("contains");
  });

  it("nhận biết scope drive", () => {
    expect(hasDriveScope("openid email https://www.googleapis.com/auth/drive.readonly")).toBe(true);
    expect(hasDriveScope("openid,email,https://www.googleapis.com/auth/drive.readonly")).toBe(true);
    expect(hasDriveScope("openid email profile")).toBe(false);
    expect(hasDriveScope(null)).toBe(false);
  });
});

describe("kiểm tra URL của Bridge (SSRF có điều kiện)", () => {
  it("localhost/LAN cần cho phép tường minh; link-local/metadata luôn bị chặn", () => {
    expect(isPrivateHostUrl("http://localhost:8765")).toBe(true);
    expect(isPrivateHostUrl("http://192.168.1.10:8765")).toBe(true);
    expect(isPrivateHostUrl("http://bridge:8765")).toBe(true);
    expect(isPrivateHostUrl("https://bridge.example.com")).toBe(false);

    expect(() => assertConnectorUrl("http://127.0.0.1:8765", { allowPrivateHosts: false })).toThrowError(/Cho phép địa chỉ nội bộ/);
    expect(assertConnectorUrl("http://127.0.0.1:8765", { allowPrivateHosts: true }).port).toBe("8765");
    expect(assertConnectorUrl("https://bridge.example.com/x", { allowPrivateHosts: false }).hostname).toBe("bridge.example.com");
    for (const bad of ["http://169.254.169.254/latest", "http://0.0.0.0:80", "http://[fe80::1]/"]) {
      expect(() => assertConnectorUrl(bad, { allowPrivateHosts: true })).toThrowError();
    }
    expect(() => assertConnectorUrl("ftp://x.example.com", { allowPrivateHosts: true })).toThrowError(/http/);
    expect(() => assertConnectorUrl("http://user:pw@x.example.com", { allowPrivateHosts: true })).toThrowError(/đăng nhập/);
    expect(isAlwaysBlockedIp("169.254.1.1")).toBe(true);
    expect(isAlwaysBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isAlwaysBlockedIp("192.168.1.1")).toBe(false);
  });

  it("mô tả lỗi bridge: 401, chưa đăng nhập, upstream_changed", () => {
    const body = (code: string, message: string) => Buffer.from(JSON.stringify({ error: { code, message } }));
    expect(describeBridgeFailure(401, body("unauthorized", "x")).message).toContain("token");
    expect(describeBridgeFailure(503, body("not_authenticated", "Chưa đăng nhập")).message).toBe("Chưa đăng nhập");
    expect(describeBridgeFailure(502, body("upstream_changed", "Đổi giao thức")).message).toContain("notebooklm-py");
    expect(describeBridgeFailure(500, Buffer.from("html")).message).toBe("Bridge trả về HTTP 500");
  });
});

describe("tiện ích", () => {
  it("stripBridgeMarkers và URL notebook ngoài", () => {
    expect(stripBridgeMarkers("Câu A [1]. Câu B [2, 3] [4-6].")).toBe("Câu A. Câu B.");
    expect(stripBridgeMarkers("Xem [text] và mục 3")).toBe("Xem [text] và mục 3");
    expect(externalNotebookUrl("notebooklm-bridge", "abc 1")).toBe("https://notebooklm.google.com/notebook/abc%201");
    expect(externalNotebookUrl("notebooklm-enterprise", "abc")).toBeNull();
  });
});

describe("DTO kết nối không lộ credential", () => {
  const row = {
    id: "33333333-3333-4333-8333-333333333333",
    notebookId: "44444444-4444-4444-8444-444444444444",
    ownerUserId: "55555555-5555-4555-8555-555555555555",
    provider: "notebooklm-bridge",
    externalId: "nb-1",
    label: "Sổ tay ngoài",
    config: { secretish: "SHOULD-NOT-LEAK", externalTitle: "T" },
    credentialEnc: "v1:aaaa:bbbb:SECRET-CIPHERTEXT",
    sharedWithMembers: false,
    status: "ready",
    lastError: null,
    lastSyncedAt: new Date("2026-10-01T00:00:00Z"),
    createdAt: new Date("2026-09-01T00:00:00Z"),
  } as unknown as NotebookConnection;
  const src = [{ id: "s", connectionId: row.id, externalSourceId: "e1", title: "Nguồn A", kind: "pdf", metadata: {}, syncedAt: new Date() }];

  it("chủ kết nối: usable, thấy nguồn; không có credentialEnc/config", () => {
    const dto = toConnectionDto(row, { ownerName: "An", sources: src, viewer: { userId: row.ownerUserId, role: "editor" } });
    const json = JSON.stringify(dto);
    expect(json).not.toMatch(/credential/i);
    expect(json).not.toContain("SECRET-CIPHERTEXT");
    expect(json).not.toContain("SHOULD-NOT-LEAK");
    expect(Object.keys(dto)).not.toContain("config");
    expect(dto).toMatchObject({ isMine: true, usable: true, supportsChat: true, canDelete: true, sourceCount: 1, externalUrl: "https://notebooklm.google.com/notebook/nb-1" });
  });

  it("thành viên khác khi chưa chia sẻ: không dùng được, không thấy nguồn/lỗi chi tiết; admin xoá được", () => {
    const failing = { ...row, status: "error", lastError: "ECONNREFUSED 10.0.0.5:8765" } as NotebookConnection;
    const dto = toConnectionDto(failing, { ownerName: "An", sources: src, viewer: { userId: "66666666-6666-4666-8666-666666666666", role: "editor" } });
    expect(dto).toMatchObject({ isMine: false, usable: false, supportsChat: false, canDelete: false, sourceCount: 0, sources: [] });
    expect(dto.lastError).toBe("Kết nối đang lỗi");
    expect(JSON.stringify(dto)).not.toContain("10.0.0.5");
    const admin = toConnectionDto(failing, { ownerName: "An", sources: src, viewer: { userId: "66666666-6666-4666-8666-666666666666", role: "admin" } });
    expect(admin.canDelete).toBe(true);
    const shared = toConnectionDto({ ...row, sharedWithMembers: true } as NotebookConnection, { ownerName: "An", sources: src, viewer: { userId: "66666666-6666-4666-8666-666666666666", role: "viewer" } });
    expect(shared).toMatchObject({ usable: true, supportsChat: true, sourceCount: 1 });
  });

  it("Enterprise: không hỗ trợ chat", () => {
    const dto = toConnectionDto({ ...row, provider: "notebooklm-enterprise" } as NotebookConnection, { ownerName: null, sources: [], viewer: { userId: row.ownerUserId, role: "owner" } });
    expect(dto.supportsChat).toBe(false);
    expect(dto.externalUrl).toBeNull();
  });
});
