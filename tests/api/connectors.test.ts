import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getOverview } from "@/app/api/connectors/route";
import { DELETE as deleteBridgeSettings, PUT as putBridge } from "@/app/api/connectors/bridge/route";
import { POST as testBridgeRoute } from "@/app/api/connectors/bridge/test/route";
import { GET as bridgeNotebooks } from "@/app/api/connectors/bridge/notebooks/route";
import { PUT as putEnterprise } from "@/app/api/connectors/enterprise/route";
import { POST as testEnterpriseRoute } from "@/app/api/connectors/enterprise/test/route";
import { GET as listConnectionsRoute, POST as createConnectionRoute } from "@/app/api/notebooks/[id]/connections/route";
import { DELETE as deleteConnectionRoute, PATCH as patchConnectionRoute } from "@/app/api/notebooks/[id]/connections/[connectionId]/route";
import { POST as syncRoute } from "@/app/api/notebooks/[id]/connections/[connectionId]/sync/route";
import { GET as externalSourcesRoute, POST as pushSourceRoute } from "@/app/api/notebooks/[id]/connections/[connectionId]/sources/route";
import { POST as pushNoteRoute } from "@/app/api/notebooks/[id]/connections/[connectionId]/notes/route";
import { POST as importRoute } from "@/app/api/notebooks/[id]/connections/[connectionId]/import/route";
import { GET as driveFilesRoute } from "@/app/api/notebooks/[id]/drive/files/route";
import { POST as driveImportRoute } from "@/app/api/notebooks/[id]/drive/import/route";
import { POST as createConversation } from "@/app/api/notebooks/[id]/conversations/route";
import { POST as ask } from "@/app/api/notebooks/[id]/conversations/[conversationId]/messages/route";
import { db } from "@/server/db";
import { accounts, connectionSources, jobs, notebookConnections, sources, userSettings } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { ingestSource } from "@/server/knowledge/ingest/pipeline";
import type { TextRequest } from "@/server/ai/provider";
import type { AskResult, ConversationDto } from "@/lib/chat";
import type { ConnectionDto, ConnectorsOverview, BridgeTestResult } from "@/lib/connectors";
import { startFakeBridge, type FakeBridge } from "../helpers/fake-bridge";
import { createNotebookWithMembers, insertSource } from "../helpers/fixtures";
import { makeRequest, params, type TestUser } from "../helpers/users";

/** AI giả: trả câu trả lời đóng hộp và ghi lại prompt để kiểm tra bằng chứng NotebookLM có vào ngữ cảnh. */
const canned = vi.hoisted(() => ({ answer: "OK [1]", calls: [] as TextRequest[] }));

vi.mock("@/server/ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/ai")>();
  class CannedProvider extends mod.MockAiProvider {
    async *streamText(req: TextRequest) {
      canned.calls.push(req);
      for (const part of canned.answer.split(/(?<=\s)/)) yield { delta: part };
      yield { done: true, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    }
  }
  return { ...mod, getAiProviderForUser: vi.fn(async () => new CannedProvider()) };
});

let bridge: FakeBridge;

beforeAll(async () => {
  bridge = await startFakeBridge();
});
afterAll(async () => {
  await bridge.close();
});
beforeEach(() => {
  bridge.authenticated = true;
  bridge.askFailure = null;
  bridge.fulltextSupported = true;
  bridge.calls.length = 0;
  bridge.notebooks.clear();
  bridge.askAnswer = (q) => ({ answer: `Trả lời cho: ${q}`, references: [] });
  canned.answer = "OK [1]";
  canned.calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const json = <T>(res: Response) => res.json() as Promise<T>;
type Err = { error: { code: string; message: string } };

async function saveBridge(user: TestUser, over: Record<string, unknown> = {}) {
  return putBridge(
    makeRequest("/api/connectors/bridge", { method: "PUT", user, body: { url: bridge.url, token: bridge.token, allowPrivateHosts: true, ...over } }),
  );
}

function connectionsUrl(nb: string, extra = "") {
  return `/api/notebooks/${nb}/connections${extra}`;
}

async function createConn(user: TestUser, nb: string, body: Record<string, unknown>) {
  return createConnectionRoute(makeRequest(connectionsUrl(nb), { method: "POST", user, body }), params({ id: nb }));
}
async function listConns(user: TestUser, nb: string) {
  const res = await listConnectionsRoute(makeRequest(connectionsUrl(nb), { user }), params({ id: nb }));
  const raw = await res.text();
  return { res, raw, list: res.ok ? (JSON.parse(raw) as { connections: ConnectionDto[] }).connections : [] };
}

/** Sổ tay + chủ đã cấu hình bridge + notebook ngoài "ext-1" (2 nguồn) + kết nối đã tạo. */
async function connectedNotebook(roles: Parameters<typeof createNotebookWithMembers>[0] = ["viewer", "editor", "admin"], shared = false) {
  const ctx = await createNotebookWithMembers(roles);
  bridge.addNotebook("ext-1", "Giải phẫu ngoài", [
    { id: "ext-1-a", title: "Giải phẫu tim", fulltext: "Tim có bốn buồng: hai tâm nhĩ và hai tâm thất." },
    { id: "ext-1-b", title: "Hệ tuần hoàn", fulltext: "Máu chảy trong hệ tuần hoàn kín." },
  ]);
  expect((await saveBridge(ctx.owner)).status).toBe(200);
  const res = await createConn(ctx.owner, ctx.notebook.id, { provider: "notebooklm-bridge", externalId: "ext-1", sharedWithMembers: shared });
  expect(res.status).toBe(201);
  const { connection } = await json<{ connection: ConnectionDto }>(res);
  return { ...ctx, connection };
}

/* -------------------------------------------------------------------------- */

describe("cài đặt Bridge cấp người dùng", () => {
  it("lưu mã hoá, không bao giờ trả token; cần đăng nhập", async () => {
    const { owner } = await createNotebookWithMembers();
    expect((await getOverview(makeRequest("/api/connectors"))).status).toBe(401);

    const empty = await json<{ connectors: ConnectorsOverview }>(await getOverview(makeRequest("/api/connectors", { user: owner })));
    expect(empty.connectors.bridge).toEqual({ configured: false, url: null, tokenMask: null, allowPrivateHosts: false });
    expect(empty.connectors.drive).toMatchObject({ googleConfigured: false, linked: false, hasDriveScope: false });

    const res = await saveBridge(owner);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(bridge.token);
    const view = (JSON.parse(body) as { connectors: ConnectorsOverview }).connectors.bridge;
    expect(view).toMatchObject({ configured: true, url: bridge.url, allowPrivateHosts: true });
    expect(view.tokenMask).toMatch(/…/);

    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, owner.id));
    expect(row.connectorsEnc).toMatch(/^v1:/);
    expect(row.connectorsEnc).not.toContain(bridge.token);
    expect(row.connectorsEnc).not.toContain("127.0.0.1");

    // đổi URL nhưng giữ token cũ (bỏ trống token)
    const keep = await putBridge(makeRequest("/x", { method: "PUT", user: owner, body: { url: `${bridge.url}/`, allowPrivateHosts: true } }));
    expect(keep.status).toBe(200);
    expect((await json<{ connectors: ConnectorsOverview }>(keep)).connectors.bridge.tokenMask).toBe(view.tokenMask);

    const del = await deleteBridgeSettings(makeRequest("/x", { method: "DELETE", user: owner }));
    expect((await json<{ connectors: ConnectorsOverview }>(del)).connectors.bridge.configured).toBe(false);
    const [after] = await db.select().from(userSettings).where(eq(userSettings.userId, owner.id));
    expect(after.connectorsEnc).toBeNull();
  });

  it("địa chỉ nội bộ cần đồng ý tường minh; link-local luôn bị chặn; thiếu token → 400", async () => {
    const { owner } = await createNotebookWithMembers();
    const refused = await saveBridge(owner, { allowPrivateHosts: false });
    expect(refused.status).toBe(400);
    expect((await json<Err>(refused)).error.code).toBe("private_host_requires_consent");

    const meta = await saveBridge(owner, { url: "http://169.254.169.254/latest", allowPrivateHosts: true });
    expect(meta.status).toBe(400);
    expect((await json<Err>(meta)).error.code).toBe("blocked_url");

    const noToken = await putBridge(makeRequest("/x", { method: "PUT", user: owner, body: { url: bridge.url, allowPrivateHosts: true } }));
    expect(noToken.status).toBe(400);
  });

  it("Kiểm tra kết nối gọi /health thật: authenticated + account; chưa đăng nhập Google; sai token; không có server", async () => {
    const { owner } = await createNotebookWithMembers();
    // chưa cấu hình và không gửi gì
    const none = await testBridgeRoute(makeRequest("/x", { method: "POST", user: owner, body: {} }));
    expect(none.status).toBe(400);
    expect((await json<Err>(none)).error.code).toBe("connector_not_configured");

    bridge.addNotebook("n1", "A");
    bridge.addNotebook("n2", "B");
    // thử với giá trị đang nhập (chưa lưu)
    const ok = await testBridgeRoute(makeRequest("/x", { method: "POST", user: owner, body: { url: bridge.url, token: bridge.token, allowPrivateHosts: true } }));
    expect(ok.status).toBe(200);
    expect(await json<BridgeTestResult>(ok)).toMatchObject({ ok: true, authenticated: true, account: "nguoi.dung@example.com", notebookCount: 2, notebooklmPyVersion: "0.8.5" });
    expect(bridge.calls.find((c) => c.path === "/health")?.auth).toBe(`Bearer ${bridge.token}`);

    // bridge chạy nhưng chưa đăng nhập Google → kết quả thật `authenticated:false`
    bridge.authenticated = false;
    await saveBridge(owner);
    const notAuthed = await json<BridgeTestResult>(await testBridgeRoute(makeRequest("/x", { method: "POST", user: owner, body: {} })));
    expect(notAuthed).toMatchObject({ ok: true, authenticated: false, account: null, notebookCount: null });
    expect(notAuthed.detail).toContain("notebooklm login");
    bridge.authenticated = true;

    // sai token → lỗi thật 502
    const bad = await testBridgeRoute(makeRequest("/x", { method: "POST", user: owner, body: { token: "sai-token-sai-token" } }));
    expect(bad.status).toBe(502);
    const badBody = await json<Err>(bad);
    expect(badBody.error.code).toBe("connector_error");
    expect(badBody.error.message).toContain("token");

    // không có máy chủ nào ở cổng đó → lỗi kết nối thật
    const down = await testBridgeRoute(makeRequest("/x", { method: "POST", user: owner, body: { url: "http://127.0.0.1:9", token: bridge.token, allowPrivateHosts: true } }));
    expect(down.status).toBe(502);
    expect((await json<Err>(down)).error.message).toMatch(/Không kết nối được|bị từ chối/);
  });

  it("liệt kê notebook NotebookLM của người dùng qua bridge", async () => {
    const { owner } = await createNotebookWithMembers();
    bridge.addNotebook("n1", "Sinh học", [{}, {}]);
    expect((await bridgeNotebooks(makeRequest("/x", { user: owner }))).status).toBe(400); // chưa cấu hình
    await saveBridge(owner);
    const res = await bridgeNotebooks(makeRequest("/x", { user: owner }));
    expect((await json<{ notebooks: { id: string; title: string; sourceCount: number }[] }>(res)).notebooks).toEqual([
      { id: "n1", title: "Sinh học", sourceCount: 2, updatedAt: null },
    ]);
  });
});

/* -------------------------------------------------------------------------- */

describe("kết nối notebook (Bridge)", () => {
  it("tạo kết nối kiểm tra thật với bridge, chụp credential mã hoá, cache nguồn, DTO không có credential", async () => {
    const { owner, notebook, connection } = await connectedNotebook();
    expect(connection).toMatchObject({
      provider: "notebooklm-bridge",
      externalId: "ext-1",
      label: "Giải phẫu ngoài",
      status: "ready",
      isMine: true,
      usable: true,
      supportsChat: true,
      sharedWithMembers: false,
      sourceCount: 2,
      externalUrl: "https://notebooklm.google.com/notebook/ext-1",
    });
    expect(connection.sources.map((s) => s.title).sort()).toEqual(["Giải phẫu tim", "Hệ tuần hoàn"]);
    expect(connection.lastSyncedAt).not.toBeNull();
    // bridge được gọi bằng đúng token
    expect(bridge.calls.some((c) => c.path === "/notebooks/ext-1" && c.auth === `Bearer ${bridge.token}`)).toBe(true);

    const [row] = await db.select().from(notebookConnections).where(eq(notebookConnections.id, connection.id));
    expect(row.credentialEnc).toMatch(/^v1:/);
    expect(row.credentialEnc).not.toContain(bridge.token);
    expect(JSON.stringify(row.config)).not.toContain(bridge.token);

    const { raw, list } = await listConns(owner, notebook.id);
    expect(raw.toLowerCase()).not.toContain("credential");
    expect(raw).not.toContain(bridge.token);
    expect(raw).not.toContain(row.credentialEnc as string);
    expect(list).toHaveLength(1);
  });

  it("notebook ngoài không tồn tại → lỗi thật từ bridge, không tạo kết nối; trùng → 409; chưa cấu hình → 412", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer", "editor"]);
    bridge.addNotebook("ext-1", "Có thật");
    const body = { provider: "notebooklm-bridge", externalId: "ext-1" };

    expect((await createConn(owner, notebook.id, body)).status).toBe(412); // chưa lưu cài đặt bridge
    await saveBridge(owner);
    const missing = await createConn(owner, notebook.id, { ...body, externalId: "khong-co" });
    expect(missing.status).toBe(502);
    expect((await json<Err>(missing)).error.message).toContain("khong-co");
    expect((await listConns(owner, notebook.id)).list).toHaveLength(0);

    expect((await createConn(owner, notebook.id, body)).status).toBe(201);
    expect((await createConn(owner, notebook.id, body)).status).toBe(409);

    // viewer không tạo được; chưa đăng nhập 401
    expect((await createConn(members.viewer, notebook.id, body)).status).toBe(403);
    expect((await createConn(null as unknown as TestUser, notebook.id, body)).status).toBe(401);
    expect((await createConn(members.editor, notebook.id, { ...body, label: "x" })).status).toBe(412); // editor chưa cấu hình bridge
  });

  it("kết nối giữ credential đã chụp dù người tạo đổi Cài đặt sau đó; 'Cập nhật thông tin xác thực' chụp lại", async () => {
    const { owner, notebook, connection } = await connectedNotebook();
    const before = bridge.calls.length;
    // người dùng đổi token trong Cài đặt thành giá trị sai
    await saveBridge(owner, { token: "token-moi-khong-hop-le-0000" });
    const synced = await syncRoute(makeRequest("/x", { method: "POST", user: owner }), params({ id: notebook.id, connectionId: connection.id }));
    expect(synced.status).toBe(200); // vẫn chạy bằng token đã chụp
    expect(bridge.calls.slice(before).every((c) => c.auth === `Bearer ${bridge.token}`)).toBe(true);

    // chụp lại → dùng token mới (sai) → kết nối báo lỗi thật
    const refresh = await patchConnectionRoute(
      makeRequest("/x", { method: "PATCH", user: owner, body: { refreshCredentials: true } }),
      params({ id: notebook.id, connectionId: connection.id }),
    );
    expect(refresh.status).toBe(502);
    // khôi phục token đúng rồi chụp lại thành công
    await saveBridge(owner);
    const ok = await patchConnectionRoute(
      makeRequest("/x", { method: "PATCH", user: owner, body: { refreshCredentials: true } }),
      params({ id: notebook.id, connectionId: connection.id }),
    );
    expect(ok.status).toBe(200);
    expect((await json<{ connection: ConnectionDto }>(ok)).connection.status).toBe("ready");
  });

  it("sync làm mới cache nguồn (thêm/bớt) và ghi trạng thái lỗi THẬT khi bridge hỏng", async () => {
    const { owner, notebook, connection } = await connectedNotebook();
    const nb = bridge.notebooks.get("ext-1")!;
    nb.sources.push({ id: "ext-1-c", title: "Nguồn mới", kind: "pasted_text", status: "ready", url: null });
    nb.sources = nb.sources.filter((s) => s.id !== "ext-1-a");

    const res = await syncRoute(makeRequest("/x", { method: "POST", user: owner }), params({ id: notebook.id, connectionId: connection.id }));
    expect(res.status).toBe(200);
    const dto = (await json<{ connection: ConnectionDto }>(res)).connection;
    expect(dto.sources.map((s) => s.title).sort()).toEqual(["Hệ tuần hoàn", "Nguồn mới"]);
    const cached = await db.select().from(connectionSources).where(eq(connectionSources.connectionId, connection.id));
    expect(cached.map((c) => c.externalSourceId).sort()).toEqual(["ext-1-b", "ext-1-c"]);

    // bridge mất đăng nhập Google → sync lỗi và trạng thái chuyển 'error' với thông báo thật
    bridge.authenticated = false;
    const fail = await syncRoute(makeRequest("/x", { method: "POST", user: owner }), params({ id: notebook.id, connectionId: connection.id }));
    expect(fail.status).toBe(502);
    const [row] = await db.select().from(notebookConnections).where(eq(notebookConnections.id, connection.id));
    expect(row.status).toBe("error");
    expect(row.lastError).toContain("đăng nhập");
    const { list } = await listConns(owner, notebook.id);
    expect(list[0]).toMatchObject({ status: "error" });
    expect(list[0].lastError).toContain("đăng nhập");

    // phục hồi → lại 'ready'
    bridge.authenticated = true;
    expect((await syncRoute(makeRequest("/x", { method: "POST", user: owner }), params({ id: notebook.id, connectionId: connection.id }))).status).toBe(200);
    const [back] = await db.select().from(notebookConnections).where(eq(notebookConnections.id, connection.id));
    expect(back).toMatchObject({ status: "ready", lastError: null });
  });

  it("quyền: thành viên thấy kết nối nhưng không dùng/đổi/xoá của người khác; admin xoá được; chia sẻ chỉ chủ đổi", async () => {
    const { owner, notebook, members, connection } = await connectedNotebook();
    const nb = notebook.id;
    const idp = (connectionId: string) => params({ id: nb, connectionId });

    // danh sách hiển thị cho mọi thành viên nhưng ẩn nguồn khi chưa chia sẻ
    const seen = (await listConns(members.viewer, nb)).list;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ label: "Giải phẫu ngoài", provider: "notebooklm-bridge", status: "ready", isMine: false, usable: false, supportsChat: false, sources: [], sourceCount: 0, canDelete: false });

    // không đồng bộ / liệt kê nguồn / đẩy ghi chú được khi chưa chia sẻ
    expect((await syncRoute(makeRequest("/x", { method: "POST", user: members.editor }), idp(connection.id))).status).toBe(403);
    expect((await externalSourcesRoute(makeRequest("/x", { user: members.editor }), idp(connection.id))).status).toBe(403);
    expect((await pushNoteRoute(makeRequest("/x", { method: "POST", user: members.editor, body: { title: "t", content: "c" } }), idp(connection.id))).status).toBe(403);

    // chỉ chủ đổi chia sẻ
    const patch = (user: TestUser, body: unknown) => patchConnectionRoute(makeRequest("/x", { method: "PATCH", user, body }), idp(connection.id));
    expect((await patch(members.admin, { sharedWithMembers: true })).status).toBe(403);
    expect((await patch(members.editor, { sharedWithMembers: true })).status).toBe(403);
    const shared = await patch(owner, { sharedWithMembers: true });
    expect(shared.status).toBe(200);
    expect((await json<{ connection: ConnectionDto }>(shared)).connection.sharedWithMembers).toBe(true);

    // khi đã chia sẻ, editor dùng được và thấy nguồn
    const nowSeen = (await listConns(members.editor, nb)).list[0];
    expect(nowSeen).toMatchObject({ usable: true, supportsChat: true, sourceCount: 2 });
    expect((await syncRoute(makeRequest("/x", { method: "POST", user: members.editor }), idp(connection.id))).status).toBe(200);
    // đổi nhãn: chủ hoặc admin+, editor khác thì không
    expect((await patch(members.editor, { label: "Hack" })).status).toBe(403);
    expect((await patch(members.admin, { label: "Nhãn mới" })).status).toBe(200);

    // xoá: editor không phải chủ → 403; viewer → 403; admin → ok
    const del = (user: TestUser) => deleteConnectionRoute(makeRequest("/x", { method: "DELETE", user }), idp(connection.id));
    expect((await del(members.editor)).status).toBe(403);
    expect((await del(members.viewer)).status).toBe(403);
    expect((await del(members.admin)).status).toBe(200);
    expect((await listConns(owner, nb)).list).toHaveLength(0);
    expect(await db.select().from(connectionSources).where(eq(connectionSources.connectionId, connection.id))).toHaveLength(0);
  });

  it("chủ kết nối tự xoá được; người ngoài sổ tay 404; id sai notebook 404", async () => {
    const { owner, notebook, connection } = await connectedNotebook([]);
    const other = await createNotebookWithMembers();
    const del = (nb: string, user: TestUser) => deleteConnectionRoute(makeRequest("/x", { method: "DELETE", user }), params({ id: nb, connectionId: connection.id }));
    expect((await del(notebook.id, other.owner)).status).toBe(404);
    expect((await del(other.notebook.id, other.owner)).status).toBe(404); // kết nối không thuộc notebook đó
    expect((await del(notebook.id, owner)).status).toBe(200);
    expect((await del(notebook.id, owner)).status).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */

describe("hỏi đáp với connectionIds", () => {
  async function conv(user: TestUser, nb: string) {
    const res = await createConversation(makeRequest("/x", { method: "POST", user, body: {} }), params({ id: nb }));
    return (await json<{ conversation: ConversationDto }>(res)).conversation;
  }
  async function askWith(user: TestUser, nb: string, c: string, scope: unknown, question = "Quang hợp diễn ra ở đâu?") {
    const res = await ask(
      makeRequest(`/api/notebooks/${nb}/conversations/${c}/messages`, { method: "POST", user, body: { question, scope }, query: "?stream=0" }),
      params({ id: nb, conversationId: c }),
    );
    return { res, body: (await res.json()) as AskResult & Err };
  }
  async function withLocalSource(nb: string, owner: TestUser) {
    const row = await insertSource(nb, owner.id, { title: "Quang hợp", rawText: "Quang hợp diễn ra ở lục lạp của tế bào thực vật.", status: "pending", metadata: {} });
    await ingestSource(row.id);
    return row;
  }

  it("gộp bằng chứng: cục bộ trước, NotebookLM sau; [n] liên tục, hợp lệ; chip trỏ nguồn ngoài; không còn connections_unavailable", async () => {
    const { owner, notebook, connection } = await connectedNotebook();
    const local = await withLocalSource(notebook.id, owner);
    bridge.askAnswer = () => ({
      answer: "Lục lạp là nơi diễn ra quang hợp [1][2].",
      references: [
        { source_id: "ext-1-a", cited_text: "Quang hợp xảy ra ở lục lạp, nhờ diệp lục.", start_char: 12, end_char: 53 },
        { source_id: "ext-1-b", cited_text: "Diệp lục hấp thụ ánh sáng đỏ và xanh tím.", start_char: 0, end_char: 41 },
      ],
    });
    canned.answer = "Ở lục lạp [1], NotebookLM cũng khẳng định điều này [2] với trích đoạn [3] và [4]. Số lạ [9].";
    const c = await conv(owner, notebook.id);
    const { res, body } = await askWith(owner, notebook.id, c.id, { sourceIds: [local.id], connectionIds: [connection.id] });
    expect(res.status).toBe(200);
    expect(body.scopeAdjustments).toEqual([]);
    expect(body.scope.connectionIds).toEqual([connection.id]);

    const ev = body.evidence;
    expect(ev.map((e) => e.provider)).toEqual(["local", "notebooklm-bridge", "notebooklm-bridge", "notebooklm-bridge"]);
    expect(ev[0].sourceId).toBe(local.id);
    expect(ev[1]).toMatchObject({ kind: "external_answer", sourceId: null, connectionId: connection.id, externalUrl: "https://notebooklm.google.com/notebook/ext-1" });
    expect(ev[1].text).toBe("Lục lạp là nơi diễn ra quang hợp."); // dấu [1][2] của bridge đã bị xoá
    expect(ev[2]).toMatchObject({ kind: "chunk", sourceId: "ext-1-a", sourceTitle: "Giải phẫu tim", locator: { startChar: 12, endChar: 53, section: "NotebookLM" } });
    expect(ev[3]).toMatchObject({ sourceId: "ext-1-b", sourceTitle: "Hệ tuần hoàn" });

    // câu hỏi đúng được gửi tới bridge
    const askCall = bridge.calls.find((x) => x.path === "/notebooks/ext-1/ask");
    expect(askCall?.body).toMatchObject({ question: "Quang hợp diễn ra ở đâu?" });

    // hậu kiểm: [9] bị loại, [1..4] giữ nguyên; nguồn đã dùng gồm cả nguồn ngoài
    const msg = body.message;
    expect(msg.content).not.toContain("[9]");
    expect(msg.content).toMatch(/\[1\].*\[2\].*\[3\].*\[4\]/);
    expect(msg.sourcesUsed!.map((s) => s.provider)).toEqual(["local", "notebooklm-bridge", "notebooklm-bridge", "notebooklm-bridge"]);
    expect(msg.citations).toHaveLength(4);

    // prompt có câu trả lời & trích đoạn của NotebookLM, đánh số liên tục, không lẫn [1][2] của bridge
    const prompt = String(canned.calls.at(-1)!.messages.at(-1)!.content);
    expect(prompt).toContain('[2] Nguồn: "Câu trả lời của NotebookLM · Giải phẫu ngoài"');
    expect(prompt).toContain('[3] Nguồn: "Giải phẫu tim"');
    expect(prompt).toContain("Quang hợp xảy ra ở lục lạp, nhờ diệp lục.");

    // trạng thái kết nối vẫn 'ready' sau lần gọi thật thành công
    const [row] = await db.select().from(notebookConnections).where(eq(notebookConnections.id, connection.id));
    expect(row.status).toBe("ready");
  });

  it("chỉ chọn kết nối (không có nguồn cục bộ) vẫn trả lời từ NotebookLM; SSE phát meta kèm bằng chứng", async () => {
    const { owner, notebook, connection } = await connectedNotebook([]);
    bridge.askAnswer = () => ({ answer: "Tim có bốn buồng.", references: [{ source_id: "ext-1-a", cited_text: "Hai tâm nhĩ và hai tâm thất.", start_char: 0, end_char: 28 }] });
    canned.answer = "Bốn buồng [1].";
    const c = await conv(owner, notebook.id);
    const { body } = await askWith(owner, notebook.id, c.id, { sourceIds: [], connectionIds: [connection.id] }, "Tim có mấy buồng?");
    expect(body.evidence.map((e) => e.kind)).toEqual(["external_answer", "chunk"]);
    expect(body.message.insufficientEvidence).toBe(false);
    expect(body.message.content).toBe("Bốn buồng [1].");
  });

  it("thành viên không dùng được kết nối chưa chia sẻ (403), dùng được sau khi chủ bật chia sẻ", async () => {
    const { owner, notebook, members, connection } = await connectedNotebook();
    const c = await conv(members.viewer, notebook.id);
    const denied = await askWith(members.viewer, notebook.id, c.id, { sourceIds: [], connectionIds: [connection.id] });
    expect(denied.res.status).toBe(403);
    // không để lại tin nhắn người dùng khi bị từ chối
    expect(bridge.calls.filter((x) => x.path.endsWith("/ask"))).toHaveLength(0);

    await patchConnectionRoute(makeRequest("/x", { method: "PATCH", user: owner, body: { sharedWithMembers: true } }), params({ id: notebook.id, connectionId: connection.id }));
    bridge.askAnswer = () => ({ answer: "Có.", references: [] });
    canned.answer = "Có [1].";
    const allowed = await askWith(members.viewer, notebook.id, c.id, { sourceIds: [], connectionIds: [connection.id] });
    expect(allowed.res.status).toBe(200);
    expect(allowed.body.evidence).toHaveLength(1);
    expect(bridge.calls.filter((x) => x.path.endsWith("/ask"))).toHaveLength(1);

    // tắt chia sẻ lại → 403
    await patchConnectionRoute(makeRequest("/x", { method: "PATCH", user: owner, body: { sharedWithMembers: false } }), params({ id: notebook.id, connectionId: connection.id }));
    expect((await askWith(members.viewer, notebook.id, c.id, { sourceIds: [], connectionIds: [connection.id] })).res.status).toBe(403);
  });

  it("kết nối lỗi: có bằng chứng khác → vẫn trả lời + báo connection_error; không có gì khác → 502 connector_error với lỗi thật", async () => {
    const { owner, notebook, connection } = await connectedNotebook([]);
    const local = await withLocalSource(notebook.id, owner);
    bridge.askFailure = { status: 502, code: "upstream_error", message: "Google từ chối yêu cầu" };
    canned.answer = "Ở lục lạp [1].";
    const c = await conv(owner, notebook.id);

    const partial = await askWith(owner, notebook.id, c.id, { sourceIds: [local.id], connectionIds: [connection.id] });
    expect(partial.res.status).toBe(200);
    expect(partial.body.scopeAdjustments).toEqual(["connection_error"]);
    expect(partial.body.scopeAdjustmentDetails![0]).toContain("Google từ chối yêu cầu");
    expect(partial.body.evidence.every((e) => e.provider === "local")).toBe(true);
    const [row] = await db.select().from(notebookConnections).where(eq(notebookConnections.id, connection.id));
    expect(row).toMatchObject({ status: "error" });
    expect(row.lastError).toContain("Google từ chối yêu cầu");

    const only = await askWith(owner, notebook.id, c.id, { sourceIds: [], connectionIds: [connection.id] });
    expect(only.res.status).toBe(502);
    expect(only.body.error).toMatchObject({ code: "connector_error" });
    expect(only.body.error.message).toContain("Google từ chối yêu cầu");
  });

  it("id kết nối lạ → connections_unavailable (không lỗi); Enterprise không có chat → connections_unavailable", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const c = await conv(owner, notebook.id);
    const unknown = await askWith(owner, notebook.id, c.id, { sourceIds: [], connectionIds: ["11111111-1111-4111-8111-111111111111"] });
    expect(unknown.res.status).toBe(200);
    expect(unknown.body.scopeAdjustments).toEqual(["connections_unavailable"]);

    // một kết nối Enterprise do chủ sổ tay tạo (dòng DB) → bị bỏ qua cho hỏi đáp
    const [ent] = await db
      .insert(notebookConnections)
      .values({ notebookId: notebook.id, ownerUserId: owner.id, provider: "notebooklm-enterprise", externalId: "e1", label: "Ent", status: "ready", sharedWithMembers: true })
      .returning();
    const enterprise = await askWith(owner, notebook.id, c.id, { sourceIds: [], connectionIds: [ent.id] });
    expect(enterprise.res.status).toBe(200);
    expect(enterprise.body.scopeAdjustments).toEqual(["connections_unavailable"]);
    expect(enterprise.body.scope.connectionIds).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe("ghi ngược, đẩy nguồn và nhập nguồn", () => {
  it("'Lưu vào NotebookLM': ghi chú được tạo trong notebook ngoài (thành công thật, lỗi thật)", async () => {
    const { owner, notebook, connection } = await connectedNotebook([]);
    const url = (cid = connection.id) => params({ id: notebook.id, connectionId: cid });
    const res = await pushNoteRoute(makeRequest("/x", { method: "POST", user: owner, body: { title: "Ghi chú tim", content: "Tim có **bốn** buồng." } }), url());
    expect(res.status).toBe(201);
    const note = (await json<{ note: { externalNoteId: string; title: string } }>(res)).note;
    expect(note.title).toBe("Ghi chú tim");
    expect(bridge.notebooks.get("ext-1")!.notes).toEqual([{ id: note.externalNoteId, title: "Ghi chú tim", content: "Tim có **bốn** buồng." }]);

    expect((await pushNoteRoute(makeRequest("/x", { method: "POST", user: owner, body: { title: "", content: "x" } }), url())).status).toBe(400);
    bridge.notebooks.delete("ext-1");
    const gone = await pushNoteRoute(makeRequest("/x", { method: "POST", user: owner, body: { title: "t", content: "c" } }), url());
    expect(gone.status).toBe(502);
    const [row] = await db.select().from(notebookConnections).where(eq(notebookConnections.id, connection.id));
    expect(row.status).toBe("error");
  });

  it("đẩy nguồn text và url sang NotebookLM; nguồn riêng của người khác 404", async () => {
    const { owner, notebook, members, connection } = await connectedNotebook(["editor"]);
    const textSrc = await insertSource(notebook.id, owner.id, { kind: "text", title: "Ghi chú dán", rawText: "Nội dung dán vào" });
    const urlSrc = await insertSource(notebook.id, owner.id, { kind: "url", title: "Bài viết", url: "https://example.com/bai-viet", rawText: null });
    const secret = await insertSource(notebook.id, members.editor.id, { kind: "text", title: "Bí mật", rawText: "x", visibility: "private" });
    const push = (sourceId: string, user: TestUser = owner) =>
      pushSourceRoute(makeRequest("/x", { method: "POST", user, body: { sourceId } }), params({ id: notebook.id, connectionId: connection.id }));

    const t = await push(textSrc.id);
    expect(t.status).toBe(201);
    expect(bridge.calls.find((c) => c.method === "POST" && c.path === "/notebooks/ext-1/sources" && (c.body as { type?: string })?.type === "text")?.body).toEqual({
      type: "text",
      title: "Ghi chú dán",
      text: "Nội dung dán vào",
    });
    expect((await push(urlSrc.id)).status).toBe(201);
    expect(bridge.notebooks.get("ext-1")!.sources.map((s) => s.title)).toEqual(expect.arrayContaining(["Ghi chú dán", "Bài viết"]));
    expect((await push(secret.id)).status).toBe(404);
    expect((await push("22222222-2222-4222-8222-222222222222")).status).toBe(404);
    expect((await pushSourceRoute(makeRequest("/x", { method: "POST", user: owner, body: { sourceId: "khong-phai-uuid" } }), params({ id: notebook.id, connectionId: connection.id }))).status).toBe(400);
  });

  it("nhập nguồn từ NotebookLM → nguồn text cục bộ + job ingest_source; liệt kê nguồn thật", async () => {
    const { owner, notebook, connection } = await connectedNotebook([]);
    const idp = params({ id: notebook.id, connectionId: connection.id });
    const listed = await json<{ sources: { id: string; title: string }[] }>(await externalSourcesRoute(makeRequest("/x", { user: owner }), idp));
    expect(listed.sources.map((s) => s.id)).toEqual(["ext-1-a", "ext-1-b"]);

    const res = await importRoute(makeRequest("/x", { method: "POST", user: owner, body: { externalSourceIds: ["ext-1-a", "ext-1-zzz"] } }), idp);
    expect(res.status).toBe(201);
    const out = await json<{ imported: { sourceId: string; title: string; externalSourceId: string }[]; failed: { externalSourceId: string; message: string }[] }>(res);
    expect(out.imported).toHaveLength(1);
    expect(out.failed).toEqual([{ externalSourceId: "ext-1-zzz", message: expect.stringContaining("not found") }]);

    const [src] = await db.select().from(sources).where(eq(sources.id, out.imported[0].sourceId));
    expect(src).toMatchObject({ kind: "text", title: "Giải phẫu tim", rawText: "Tim có bốn buồng: hai tâm nhĩ và hai tâm thất.", status: "pending" });
    expect(src.metadata).toMatchObject({ importedFrom: { connectionId: connection.id, externalSourceId: "ext-1-a" } });
    const queued = await db.select().from(jobs).where(eq(jobs.type, "ingest_source"));
    expect(queued.some((j) => (j.payload as { sourceId?: string }).sourceId === src.id)).toBe(true);

    // ingest thật tạo chunk để hỏi đáp cục bộ
    await ingestSource(src.id);
    const [ready] = await db.select().from(sources).where(eq(sources.id, src.id));
    expect(ready.status).toBe("ready");
  });

  it("bridge cũ chưa có endpoint fulltext → 501 bridge_fulltext_unsupported (không tạo nguồn)", async () => {
    const { owner, notebook, connection } = await connectedNotebook([]);
    bridge.fulltextSupported = false;
    const res = await importRoute(
      makeRequest("/x", { method: "POST", user: owner, body: { externalSourceIds: ["ext-1-a"] } }),
      params({ id: notebook.id, connectionId: connection.id }),
    );
    expect(res.status).toBe(501);
    expect((await json<Err>(res)).error.code).toBe("bridge_fulltext_unsupported");
    expect(await db.select().from(sources).where(eq(sources.notebookId, notebook.id))).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("NotebookLM Enterprise (REST v1alpha, fetch giả)", () => {
  const PROJECT = "123456789012";

  function stubGoogle(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
    const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        const url = String(input);
        const headers = new Headers(init.headers);
        calls.push({ url, method: init.method ?? "GET", auth: headers.get("authorization"), body: init.body ? JSON.parse(String(init.body)) : null });
        const out = handler(url, init);
        return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    return calls;
  }

  async function saveEnt(user: TestUser, over: Record<string, unknown> = {}) {
    return putEnterprise(
      makeRequest("/x", { method: "PUT", user, body: { projectNumber: PROJECT, location: "us", auth: { type: "access_token", accessToken: "ya29.fake-access-token-value" }, ...over } }),
    );
  }

  it("lưu mã hoá; Kiểm tra gọi notebooks:listRecentlyViewed đúng URL + Bearer và trả số notebook thật; lỗi 403 hiển thị lỗi thật", async () => {
    const { owner } = await createNotebookWithMembers();
    const saved = await saveEnt(owner);
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain("ya29.fake-access-token-value");
    const view = (JSON.parse(text) as { connectors: ConnectorsOverview }).connectors.enterprise;
    expect(view).toMatchObject({ configured: true, projectNumber: PROJECT, location: "us", authType: "access_token" });

    const calls = stubGoogle(() => ({
      body: { notebooks: [{ name: `projects/${PROJECT}/locations/us/notebooks/n1`, notebookId: "n1", title: "Sổ tay 1" }, { notebookId: "n2", title: "Sổ tay 2" }] },
    }));
    const ok = await testEnterpriseRoute(makeRequest("/x", { method: "POST", user: owner, body: {} }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, notebookCount: 2, endpoint: "us-discoveryengine.googleapis.com" });
    expect(calls[0]).toMatchObject({
      url: `https://us-discoveryengine.googleapis.com/v1alpha/projects/${PROJECT}/locations/us/notebooks:listRecentlyViewed?pageSize=100`,
      method: "GET",
      auth: "Bearer ya29.fake-access-token-value",
    });

    stubGoogle(() => ({ status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED", message: "Discovery Engine API has not been used" } } }));
    const denied = await testEnterpriseRoute(makeRequest("/x", { method: "POST", user: owner, body: {} }));
    expect(denied.status).toBe(502);
    expect((await json<Err>(denied)).error.message).toContain("Discovery Engine API has not been used");

    // service account JSON sai định dạng bị từ chối khi lưu
    const badSa = await saveEnt(owner, { auth: { type: "service_account", serviceAccountJson: JSON.stringify({ type: "user", note: "không phải service account" }) } });
    expect(badSa.status).toBe(400);
    expect((await json<Err>(badSa)).error.code).toBe("invalid_service_account");
    // số dự án phải là dãy số
    expect((await saveEnt(owner, { projectNumber: "my-project-id" })).status).toBe(400);
  });

  it("tạo kết nối Enterprise: getNotebook thật, cache nguồn, không hỗ trợ chat/ghi chú", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    await saveEnt(owner);
    const calls = stubGoogle((url) => {
      if (url.endsWith("/notebooks/ent-1")) {
        return {
          body: {
            name: `projects/${PROJECT}/locations/us/notebooks/ent-1`,
            notebookId: "ent-1",
            title: "Hồ sơ Enterprise",
            sources: [{ sourceId: { id: "es1" }, title: "Tài liệu 1", settings: { status: "SOURCE_STATUS_COMPLETE" } }, { name: "projects/p/locations/us/notebooks/ent-1/sources/es2", title: "Tài liệu 2" }],
          },
        };
      }
      return { status: 404, body: { error: { message: "not found" } } };
    });
    const res = await createConn(owner, notebook.id, { provider: "notebooklm-enterprise", externalId: "ent-1", sharedWithMembers: true });
    expect(res.status).toBe(201);
    const { connection } = await json<{ connection: ConnectionDto }>(res);
    expect(connection).toMatchObject({ provider: "notebooklm-enterprise", label: "Hồ sơ Enterprise", status: "ready", supportsChat: false, sourceCount: 2, externalUrl: null });
    expect(connection.sources.map((s) => s.externalSourceId).sort()).toEqual(["es1", "es2"]);
    expect(calls[0].url).toBe(`https://us-discoveryengine.googleapis.com/v1alpha/projects/${PROJECT}/locations/us/notebooks/ent-1`);

    const idp = params({ id: notebook.id, connectionId: connection.id });
    const note = await pushNoteRoute(makeRequest("/x", { method: "POST", user: owner, body: { title: "t", content: "c" } }), idp);
    expect(note.status).toBe(501);
    expect((await json<Err>(note)).error.code).toBe("not_supported");
    const imp = await importRoute(makeRequest("/x", { method: "POST", user: owner, body: { externalSourceIds: ["es1"] } }), idp);
    expect(imp.status).toBe(501);

    // đẩy nguồn text → sources:batchCreate với textContent
    const textSrc = await insertSource(notebook.id, owner.id, { kind: "text", title: "Văn bản", rawText: "abc" });
    stubGoogle(() => ({ body: {} }));
    const calls2 = stubGoogle(() => ({ body: {} }));
    const pushed = await pushSourceRoute(makeRequest("/x", { method: "POST", user: owner, body: { sourceId: textSrc.id } }), idp);
    expect(pushed.status).toBe(201);
    expect(calls2[0].url).toMatch(/\/notebooks\/ent-1\/sources:batchCreate$/);
    expect(calls2[0].body).toEqual({ userContents: [{ textContent: { sourceName: "Văn bản", content: "abc" } }] });
  });
});

/* -------------------------------------------------------------------------- */

describe("Google Drive", () => {
  const SCOPE = "openid email profile https://www.googleapis.com/auth/drive.readonly";

  function setGoogleEnv(on: boolean) {
    process.env.GOOGLE_CLIENT_ID = on ? "client-id" : "";
    process.env.GOOGLE_CLIENT_SECRET = on ? "client-secret" : "";
    resetEnvCache();
  }
  afterEach(() => setGoogleEnv(false));

  async function link(user: TestUser, over: Partial<typeof accounts.$inferInsert> = {}) {
    await db.insert(accounts).values({
      userId: user.id,
      accountId: `g-${user.id}`,
      providerId: "google",
      accessToken: "drive-token-1",
      refreshToken: "refresh-1",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: SCOPE,
      ...over,
    });
  }

  function stubDrive(handler: (url: string, init: RequestInit) => Response | { status?: number; body: unknown; raw?: Buffer }) {
    const calls: { url: string; auth: string | null; method: string; body: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        const url = String(input);
        calls.push({ url, auth: new Headers(init.headers).get("authorization"), method: init.method ?? "GET", body: init.body ? String(init.body) : null });
        const out = handler(url, init);
        if (out instanceof Response) return out;
        if (out.raw) return new Response(new Uint8Array(out.raw), { status: out.status ?? 200 });
        return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    return calls;
  }

  const listOf = async (user: TestUser, nb: string, query = "") => driveFilesRoute(makeRequest(`/api/notebooks/${nb}/drive/files`, { user, query }), params({ id: nb }));

  it("báo rõ từng trường hợp chưa sẵn sàng: chưa cấu hình Google, chưa liên kết, thiếu scope; trạng thái trong overview", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const code = async (res: Response) => (await json<Err>(res)).error.code;

    let res = await listOf(owner, notebook.id);
    expect(res.status).toBe(412);
    expect(await code(res)).toBe("google_not_configured");

    setGoogleEnv(true);
    res = await listOf(owner, notebook.id);
    expect(await code(res)).toBe("drive_not_connected");
    const noLink = await json<{ connectors: ConnectorsOverview }>(await getOverview(makeRequest("/x", { user: owner })));
    expect(noLink.connectors.drive).toEqual({ googleConfigured: true, linked: false, hasDriveScope: false });

    await link(owner, { scope: "openid email profile" });
    res = await listOf(owner, notebook.id);
    expect(await code(res)).toBe("drive_scope_missing");
    const noScope = await json<{ connectors: ConnectorsOverview }>(await getOverview(makeRequest("/x", { user: owner })));
    expect(noScope.connectors.drive).toEqual({ googleConfigured: true, linked: true, hasDriveScope: false });

    await db.update(accounts).set({ scope: SCOPE }).where(eq(accounts.userId, owner.id));
    const ok = await json<{ connectors: ConnectorsOverview }>(await getOverview(makeRequest("/x", { user: owner })));
    expect(ok.connectors.drive).toEqual({ googleConfigured: true, linked: true, hasDriveScope: true });
    // viewer không nhập được
    const viewerCtx = await createNotebookWithMembers(["viewer"]);
    expect((await listOf(viewerCtx.members.viewer, viewerCtx.notebook.id)).status).toBe(403);
  });

  it("liệt kê + tìm tệp: truy vấn files.list đúng, Bearer đúng, chỉ trả loại nhập được", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    setGoogleEnv(true);
    await link(owner);
    const calls = stubDrive(() => ({
      body: {
        files: [
          { id: "fileDoc00001", name: "Bài giảng tim", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-10-01T00:00:00Z" },
          { id: "filePdf00001", name: "Sách.pdf", mimeType: "application/pdf", size: "2048" },
          { id: "fileVid00001", name: "Video", mimeType: "video/mp4" },
        ],
        nextPageToken: "NEXT",
      },
    }));
    const res = await listOf(owner, notebook.id, "?q=tim%20m%E1%BA%A1ch");
    expect(res.status).toBe(200);
    const page = await json<{ files: { id: string; size: number | null }[]; nextPageToken: string | null }>(res);
    expect(page.files.map((f) => f.id)).toEqual(["fileDoc00001", "filePdf00001"]);
    expect(page.files[1].size).toBe(2048);
    expect(page.nextPageToken).toBe("NEXT");
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/drive/v3/files");
    expect(calls[0].auth).toBe("Bearer drive-token-1");
    expect(url.searchParams.get("q")).toContain("name contains 'tim mạch'");
    expect(url.searchParams.get("q")).toContain("trashed = false");
    expect(url.searchParams.get("orderBy")).toBeNull(); // có tìm kiếm → không sắp theo thời gian
    await listOf(owner, notebook.id);
    expect(new URL(calls[1].url).searchParams.get("orderBy")).toBe("modifiedTime desc");
  });

  it("token hết hạn → làm mới bằng refresh token qua token endpoint với client id/secret, lưu lại vào accounts", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    setGoogleEnv(true);
    await link(owner, { accessToken: "old-token", accessTokenExpiresAt: new Date(Date.now() - 1000) });
    const calls = stubDrive((url) =>
      url.startsWith("https://oauth2.googleapis.com/token") ? { body: { access_token: "fresh-token", expires_in: 3599 } } : { body: { files: [] } },
    );
    const res = await listOf(owner, notebook.id);
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ url: "https://oauth2.googleapis.com/token", method: "POST" });
    const form = new URLSearchParams(calls[0].body ?? "");
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("refresh-1");
    expect(form.get("client_id")).toBe("client-id");
    expect(form.get("client_secret")).toBe("client-secret");
    expect(calls[1].auth).toBe("Bearer fresh-token");
    const [acc] = await db.select().from(accounts).where(and(eq(accounts.userId, owner.id), eq(accounts.providerId, "google")));
    expect(acc.accessToken).toBe("fresh-token");
    expect(acc.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3000_000);

    // refresh bị Google từ chối → yêu cầu kết nối lại (412)
    await db.update(accounts).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(accounts.userId, owner.id));
    stubDrive(() => ({ status: 400, body: { error: "invalid_grant" } }));
    const revoked = await listOf(owner, notebook.id);
    expect(revoked.status).toBe(412);
    expect((await json<Err>(revoked)).error.code).toBe("drive_reauth_required");
  });

  it("nhập tệp: Google Doc export docx, PDF tải thẳng → files + sources(kind='drive', driveFileId) + job ingest; lỗi từng tệp được báo", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    setGoogleEnv(true);
    await link(owner);
    const docx = Buffer.from("PK\u0003\u0004 giả lập docx");
    const pdf = Buffer.from("%PDF-1.4 giả lập");
    const calls = stubDrive((url) => {
      const u = new URL(url);
      const media = u.searchParams.get("alt") === "media";
      if (u.pathname === "/drive/v3/files/docFile00001") return { body: { id: "docFile00001", name: "Bài giảng", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-10-01T00:00:00Z", webViewLink: "https://docs.google.com/document/d/docFile00001" } };
      if (u.pathname === "/drive/v3/files/docFile00001/export") return { raw: docx, body: null };
      if (u.pathname === "/drive/v3/files/pdfFile00001") return media ? { raw: pdf, body: null } : { body: { id: "pdfFile00001", name: "Sách.pdf", mimeType: "application/pdf" } };
      if (u.pathname === "/drive/v3/files/vidFile00001") return { body: { id: "vidFile00001", name: "clip", mimeType: "video/mp4" } };
      return { status: 404, body: { error: { message: "File not found" } } };
    });

    const res = await driveImportRoute(
      makeRequest("/x", { method: "POST", user: owner, body: { fileIds: ["docFile00001", "pdfFile00001", "vidFile00001", "missing00001"], visibility: "private" } }),
      params({ id: notebook.id }),
    );
    expect(res.status).toBe(201);
    const out = await json<{ imported: { driveFileId: string; sourceId: string; title: string }[]; failed: { driveFileId: string; message: string }[] }>(res);
    expect(out.imported.map((i) => [i.driveFileId, i.title])).toEqual([
      ["docFile00001", "Bài giảng.docx"],
      ["pdfFile00001", "Sách.pdf"],
    ]);
    expect(out.failed.map((f) => f.driveFileId)).toEqual(["vidFile00001", "missing00001"]);
    expect(out.failed[0].message).toContain("chưa được hỗ trợ");

    // export đúng MIME docx
    const exportCall = calls.find((c) => c.url.includes("/export"))!;
    expect(new URL(exportCall.url).searchParams.get("mimeType")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const rows = await db.select().from(sources).where(eq(sources.notebookId, notebook.id));
    const doc = rows.find((r) => r.title === "Bài giảng.docx")!;
    expect(doc).toMatchObject({ kind: "drive", status: "pending", visibility: "private" });
    expect(doc.fileId).not.toBeNull();
    expect(doc.metadata).toMatchObject({ driveFileId: "docFile00001", driveMimeType: "application/vnd.google-apps.document", fileType: "docx" });
    const queued = await db.select().from(jobs).where(eq(jobs.type, "ingest_source"));
    expect(queued.some((j) => (j.payload as { sourceId?: string }).sourceId === doc.id)).toBe(true);
  });
});
