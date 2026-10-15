import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listConversations, POST as createConversation } from "@/app/api/notebooks/[id]/conversations/route";
import { DELETE as deleteConversation, GET as getConversation, PATCH as renameConversation } from "@/app/api/notebooks/[id]/conversations/[conversationId]/route";
import { POST as ask } from "@/app/api/notebooks/[id]/conversations/[conversationId]/messages/route";
import { POST as saveExchange } from "@/app/api/notebooks/[id]/conversations/[conversationId]/messages/[messageId]/save-exchange/route";
import { POST as toNote } from "@/app/api/notebooks/[id]/conversations/[conversationId]/messages/[messageId]/to-note/route";
import { GET as listSaved } from "@/app/api/notebooks/[id]/saved-exchanges/route";
import { GET as listNotes } from "@/app/api/notebooks/[id]/notes/route";
import { PUT as putPrompts } from "@/app/api/settings/prompts/route";
import { ASK_RATE_LIMIT } from "@/server/chat/ask";
import { db } from "@/server/db";
import { messages, notebooks, rateLimits } from "@/server/db/schema";
import { ingestSource } from "@/server/knowledge/ingest/pipeline";
import type { TextRequest, WebSource } from "@/server/ai/provider";
import { NO_EVIDENCE_ANSWER } from "@/server/chat/ask";
import { NOT_FOUND_SENTINEL } from "@/lib/citations";
import { splitSseFrames } from "@/lib/chat-stream";
import type { AskResult, ChatMessageDto, ConversationDto } from "@/lib/chat";
import type { NoteDto, NoteListItem } from "@/lib/notes";
import { createNotebookWithMembers, insertSource } from "../helpers/fixtures";
import { makeRequest, params, type TestUser } from "../helpers/users";

/** Provider giả: trả lời đóng hộp (có thể chứa [n] bịa) và ghi lại các yêu cầu để kiểm tra prompt. */
const canned = vi.hoisted(() => ({
  answer: null as string | null,
  web: [] as WebSource[],
  streamCalls: [] as unknown[],
  webCalls: 0,
  /** Nếu đặt: sau 2 đoạn đầu provider chờ promise này (giả lập phản hồi chậm để thử nút Dừng). */
  gate: null as Promise<void> | null,
}));

vi.mock("@/server/ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/ai")>();
  class CannedProvider extends mod.MockAiProvider {
    async generateText(req: TextRequest) {
      if (req.tools?.googleSearch) {
        canned.webCalls++;
        return { text: "Tóm tắt từ web về câu hỏi.", webSources: canned.web };
      }
      return super.generateText(req);
    }
    async *streamText(req: TextRequest) {
      canned.streamCalls.push(req);
      if (canned.answer === null) {
        yield* super.streamText(req);
        return;
      }
      let i = 0;
      for (const part of canned.answer.split(/(?<=\s)/)) {
        if (canned.gate && i === 2) await canned.gate;
        i++;
        yield { delta: part };
      }
      yield { done: true, usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } };
    }
  }
  return { ...mod, getAiProviderForUser: vi.fn(async () => new CannedProvider()) };
});

// Nguồn ngắn: embedding giả lập (băm từ) chỉ cho cosine đủ cao khi câu hỏi trùng nhiều từ với đoạn văn.
const PHOTO = "Quang hợp diễn ra ở lục lạp của tế bào thực vật.";

async function readySource(nb: string, user: TestUser, title = "Quang hợp", text = PHOTO, over: Parameters<typeof insertSource>[2] = {}) {
  const row = await insertSource(nb, user.id, { title, rawText: text, status: "pending", metadata: {}, ...over });
  await ingestSource(row.id);
  return row;
}

const call = <T>(res: Response) => res.json() as Promise<T>;

async function newConversation(nb: string, user: TestUser): Promise<ConversationDto> {
  const res = await createConversation(makeRequest(`/api/notebooks/${nb}/conversations`, { method: "POST", user, body: {} }), params({ id: nb }));
  expect(res.status).toBe(201);
  return (await call<{ conversation: ConversationDto }>(res)).conversation;
}

function askReq(nb: string, conv: string, user: TestUser | null, body: unknown, query = "?stream=0") {
  return ask(makeRequest(`/api/notebooks/${nb}/conversations/${conv}/messages`, { method: "POST", user, body, query }), params({ id: nb, conversationId: conv }));
}

async function askJson(nb: string, conv: string, user: TestUser, body: unknown) {
  const res = await askReq(nb, conv, user, body);
  return { res, body: (await res.json()) as AskResult & { error?: { code: string; message: string } } };
}

async function ctxWithSource(roles: Parameters<typeof createNotebookWithMembers>[0] = ["viewer", "editor"]) {
  const ctx = await createNotebookWithMembers(roles);
  const src = await readySource(ctx.notebook.id, ctx.owner);
  return { ...ctx, src };
}

beforeEach(() => {
  canned.answer = null;
  canned.web = [];
  canned.streamCalls = [];
  canned.webCalls = 0;
  canned.gate = null;
});

describe("hội thoại: CRUD + riêng tư", () => {
  it("tạo / liệt kê / đổi tên / xoá; chỉ chủ hội thoại thấy; người ngoài 404; viewer được chat", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer", "editor"]);
    const outsider = (await createNotebookWithMembers()).owner;
    const nb = notebook.id;

    const conv = await newConversation(nb, owner);
    expect(conv).toMatchObject({ notebookId: nb, title: null });

    // viewer tạo hội thoại riêng của họ
    const vConv = await newConversation(nb, members.viewer);
    const list = (await call<{ conversations: ConversationDto[] }>(await listConversations(makeRequest("/x", { user: owner }), params({ id: nb })))).conversations;
    expect(list.map((c) => c.id)).toEqual([conv.id]); // không thấy hội thoại của viewer
    const vList = (await call<{ conversations: ConversationDto[] }>(await listConversations(makeRequest("/x", { user: members.viewer }), params({ id: nb })))).conversations;
    expect(vList.map((c) => c.id)).toEqual([vConv.id]);

    // không đọc/đổi tên/xoá được hội thoại của người khác (kể cả owner của sổ tay) → 404
    const p = params({ id: nb, conversationId: vConv.id });
    expect((await getConversation(makeRequest("/x", { user: owner }), p)).status).toBe(404);
    expect((await renameConversation(makeRequest("/x", { method: "PATCH", user: owner, body: { title: "x" } }), p)).status).toBe(404);
    expect((await deleteConversation(makeRequest("/x", { method: "DELETE", user: owner }), p)).status).toBe(404);

    // người ngoài sổ tay: 404; chưa đăng nhập: 401
    expect((await listConversations(makeRequest("/x", { user: outsider }), params({ id: nb }))).status).toBe(404);
    expect((await listConversations(makeRequest("/x"), params({ id: nb }))).status).toBe(401);

    // đổi tên + xoá
    const own = params({ id: nb, conversationId: conv.id });
    const renamed = await renameConversation(makeRequest("/x", { method: "PATCH", user: owner, body: { title: "Ôn tập sinh học" } }), own);
    expect((await call<{ conversation: ConversationDto }>(renamed)).conversation.title).toBe("Ôn tập sinh học");
    expect((await renameConversation(makeRequest("/x", { method: "PATCH", user: owner, body: { title: "  " } }), own)).status).toBe(400);
    expect((await deleteConversation(makeRequest("/x", { method: "DELETE", user: owner }), own)).status).toBe(200);
    expect((await getConversation(makeRequest("/x", { user: owner }), own)).status).toBe(404);
  });
});

describe("hỏi đáp có trích dẫn", () => {
  it("loại [9] không có trong bằng chứng, giữ [1]; lưu citations/sources_used/scope/model/usage; tiêu đề tự đặt", async () => {
    const { owner, notebook, src } = await ctxWithSource();
    const conv = await newConversation(notebook.id, owner);
    canned.answer = "Quang hợp xảy ra ở lục lạp [1]. Đây là một chi tiết bịa [9].";

    const { res, body } = await askJson(notebook.id, conv.id, owner, { question: "Quang hợp diễn ra ở đâu?", scope: {} });
    expect(res.status).toBe(200);
    expect(body.message.content).toBe("Quang hợp xảy ra ở lục lạp [1]. Đây là một chi tiết bịa.");
    expect(body.message.content).not.toContain("[9]");
    expect(body.message.insufficientEvidence).toBe(false);
    expect(body.message.sourcesUsed).toHaveLength(1);
    expect(body.message.sourcesUsed![0]).toMatchObject({ sourceId: src.id, provider: "local", title: "Quang hợp", numbers: [1] });
    expect(body.message.citations!.length).toBeGreaterThanOrEqual(1);
    expect(body.message.citations![0]).toMatchObject({ sourceId: src.id, provider: "local" });
    expect(body.message.scope).toMatchObject({ sourceIds: [src.id], useWeb: false });
    expect(body.message.usage).toMatchObject({ inputTokens: 11, outputTokens: 7 });
    expect(body.message.model).toBe("mock-chat");
    expect(body.userMessage).toMatchObject({ role: "user", content: "Quang hợp diễn ra ở đâu?" });

    // đã lưu thật trong DB
    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows.map((r) => r.role).sort()).toEqual(["assistant", "user"]);
    const assistant = rows.find((r) => r.role === "assistant")!;
    expect(assistant.content).not.toContain("[9]");
    expect(assistant.sourcesUsed).toHaveLength(1);

    // tiêu đề tự đặt từ câu hỏi đầu tiên
    const got = await call<{ conversation: ConversationDto; messages: ChatMessageDto[] }>(
      await getConversation(makeRequest("/x", { user: owner }), params({ id: notebook.id, conversationId: conv.id })),
    );
    expect(got.conversation.title).toBe("Quang hợp diễn ra ở đâu?");
    expect(got.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("stream SSE: meta → delta… → done, nội dung ghép khớp bản lưu", async () => {
    const { owner, notebook } = await ctxWithSource();
    const conv = await newConversation(notebook.id, owner);
    canned.answer = "Lục lạp là nơi quang hợp [1], theo [1, 7].";
    const res = await askReq(notebook.id, conv.id, owner, { question: "Quang hợp ở đâu?", scope: {} }, "");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const { frames } = splitSseFrames(text);
    const names = frames.map((f) => f.event);
    expect(names[0]).toBe("meta");
    expect(names[names.length - 1]).toBe("done");
    expect(names.filter((n) => n === "delta").length).toBeGreaterThan(1);
    const meta = JSON.parse(frames[0].data) as { evidence: unknown[]; messageId: string };
    expect(meta.evidence.length).toBeGreaterThan(0);
    const streamed = frames.filter((f) => f.event === "delta").map((f) => (JSON.parse(f.data) as { text: string }).text).join("");
    expect(streamed).toBe("Lục lạp là nơi quang hợp [1], theo [1, 7].");
    const done = JSON.parse(frames[frames.length - 1].data) as { content: string; messageId: string; sourcesUsed: unknown[]; insufficientEvidence: boolean; usage: { totalTokens: number } };
    expect(done.content).toBe("Lục lạp là nơi quang hợp [1], theo [1].");
    expect(done.messageId).toBe(meta.messageId);
    expect(done.sourcesUsed).toHaveLength(1);
    expect(done.insufficientEvidence).toBe(false);
    expect(done.usage.totalTokens).toBe(18);
  });

  it("không có nguồn sẵn sàng → insufficientEvidence, trả lời nêu rõ thiếu bằng chứng, không gọi mô hình", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    await insertSource(notebook.id, owner.id, { status: "pending" }); // chưa ready
    const conv = await newConversation(notebook.id, owner);
    canned.answer = "Câu trả lời bịa [1]";
    const { res, body } = await askJson(notebook.id, conv.id, owner, { question: "Thủ đô của Pháp là gì?", scope: {} });
    expect(res.status).toBe(200);
    expect(body.message.insufficientEvidence).toBe(true);
    expect(body.message.content).toContain(NOT_FOUND_SENTINEL);
    expect(body.message.content).toBe(NO_EVIDENCE_ANSWER);
    expect(body.message.citations).toEqual([]);
    expect(body.message.sourcesUsed).toEqual([]);
    expect(canned.streamCalls).toHaveLength(0);
  });

  it("mô hình tự nói không tìm thấy → insufficientEvidence = true dù có bằng chứng", async () => {
    const { owner, notebook } = await ctxWithSource();
    const conv = await newConversation(notebook.id, owner);
    canned.answer = `${NOT_FOUND_SENTINEL}. Bạn có thể thêm nguồn liên quan.`;
    const { body } = await askJson(notebook.id, conv.id, owner, { question: "Quang hợp ở lục lạp?", scope: {} });
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.message.insufficientEvidence).toBe(true);
    expect(body.message.sourcesUsed).toEqual([]);
  });

  it("câu hỏi không liên quan (similarity < 0.25) → insufficientEvidence", async () => {
    const { owner, notebook } = await ctxWithSource();
    const conv = await newConversation(notebook.id, owner);
    canned.answer = "Không có thông tin.";
    const { body } = await askJson(notebook.id, conv.id, owner, { question: "zzqx wwvk plmnb trdfg hjkl", scope: {} });
    expect(body.message.insufficientEvidence).toBe(true);
  });

  it("viewer chat được; người ngoài sổ tay 404; chưa đăng nhập 401; hội thoại của người khác 404; thiếu câu hỏi 400", async () => {
    const { owner, notebook, members } = await ctxWithSource();
    const outsider = (await createNotebookWithMembers()).owner;
    canned.answer = "Lục lạp [1].";
    const vConv = await newConversation(notebook.id, members.viewer);
    const ok = await askJson(notebook.id, vConv.id, members.viewer, { question: "Quang hợp ở đâu?", scope: {} });
    expect(ok.res.status).toBe(200);
    expect(ok.body.message.sourcesUsed).toHaveLength(1);

    expect((await askReq(notebook.id, vConv.id, outsider, { question: "x", scope: {} })).status).toBe(404);
    expect((await askReq(notebook.id, vConv.id, null, { question: "x", scope: {} })).status).toBe(401);
    expect((await askReq(notebook.id, vConv.id, owner, { question: "x", scope: {} })).status).toBe(404); // hội thoại của viewer
    expect((await askReq(notebook.id, vConv.id, members.viewer, { question: "  ", scope: {} })).status).toBe(400);
  });

  it("web: bỏ qua khi allow_web=false (scope_adjusted); khi allow_web=true thì bằng chứng web có locator.url và trích dẫn mở được", async () => {
    const { owner, notebook } = await ctxWithSource();
    const conv = await newConversation(notebook.id, owner);
    canned.web = [{ url: "https://vi.wikipedia.org/wiki/Quang_h%E1%BB%A3p", title: "Quang hợp – Wikipedia" }];
    canned.answer = "Theo nguồn [1].";

    const off = await askJson(notebook.id, conv.id, owner, { question: "Quang hợp diễn ra ở đâu?", scope: { useWeb: true } });
    expect(off.body.scopeAdjustments).toEqual(["web_not_allowed"]);
    expect(off.body.scope.useWeb).toBe(false);
    expect(canned.webCalls).toBe(0);
    expect(off.body.evidence.every((e) => e.provider === "local")).toBe(true);

    // SSE cũng báo scope_adjusted
    const sse = splitSseFrames(await (await askReq(notebook.id, conv.id, owner, { question: "Quang hợp?", scope: { useWeb: true } }, "")).text());
    expect(sse.frames[0].event).toBe("scope_adjusted");
    expect(JSON.parse(sse.frames[0].data)).toMatchObject({ reason: "web_not_allowed" });

    await db.update(notebooks).set({ allowWeb: true }).where(eq(notebooks.id, notebook.id));
    canned.answer = "Có ở lục lạp [1] và theo web [2].";
    const on = await askJson(notebook.id, conv.id, owner, { question: "Quang hợp diễn ra ở đâu?", scope: { useWeb: true } });
    expect(canned.webCalls).toBe(1);
    expect(on.body.scopeAdjustments).toEqual([]);
    expect(on.body.scope.useWeb).toBe(true);
    const web = on.body.evidence.find((e) => e.provider === "web")!;
    expect(web).toMatchObject({ sourceId: null, sourceTitle: "Quang hợp – Wikipedia", locator: { url: "https://vi.wikipedia.org/wiki/Quang_h%E1%BB%A3p" } });
    const used = on.body.message.sourcesUsed!;
    expect(used.map((s) => s.provider).sort()).toEqual(["local", "web"]);
    expect(used.find((s) => s.provider === "web")).toMatchObject({ url: web.locator.url });
  });

  it("phạm vi: chỉ dùng nguồn được chọn; nguồn riêng tư của người khác bị loại; connectionIds không tạo bằng chứng", async () => {
    const { owner, notebook, members } = await ctxWithSource(["editor"]);
    const other = await readySource(notebook.id, owner, "Giải phẫu tim", "Tim có bốn buồng: hai tâm nhĩ và hai tâm thất, bơm máu đi khắp cơ thể.");
    const secret = await readySource(notebook.id, members.editor, "Bí mật quang hợp", "Quang hợp bí mật riêng tư của biên tập viên về lục lạp.", { visibility: "private" });
    canned.answer = "OK [1]";
    const conv = await newConversation(notebook.id, owner);

    const heart = await askJson(notebook.id, conv.id, owner, { question: "Tim có mấy buồng?", scope: { sourceIds: [other.id, secret.id] } });
    expect(heart.body.scope.sourceIds).toEqual([other.id]); // nguồn riêng của người khác bị loại
    expect(heart.body.evidence.every((e) => e.sourceId === other.id)).toBe(true);

    const none = await askJson(notebook.id, conv.id, owner, { question: "Quang hợp là gì?", scope: { sourceIds: [], connectionIds: ["11111111-1111-4111-8111-111111111111"] } });
    expect(none.body.scopeAdjustments).toEqual(["connections_unavailable"]);
    expect(none.body.evidence).toEqual([]);
    expect(none.body.message.insufficientEvidence).toBe(true);

    // editor thấy nguồn riêng của chính mình
    const eConv = await newConversation(notebook.id, members.editor);
    const mine = await askJson(notebook.id, eConv.id, members.editor, { question: "Quang hợp bí mật riêng tư?", scope: { sourceIds: [secret.id] } });
    expect(mine.body.evidence.some((e) => e.sourceId === secret.id)).toBe(true);
  });

  it("prompt: system = mặc định + system_instruction sổ tay (+ ghi đè chat của người dùng); lịch sử ≤ 10 lượt, bỏ [n] cũ", async () => {
    const { owner, notebook } = await ctxWithSource();
    await db.update(notebooks).set({ systemInstruction: "Luôn trả lời thật ngắn gọn." }).where(eq(notebooks.id, notebook.id));
    const conv = await newConversation(notebook.id, owner);
    canned.answer = "Lượt một [1].";
    await askJson(notebook.id, conv.id, owner, { question: "Quang hợp là gì?", scope: {} });
    canned.answer = "Lượt hai.";
    await askJson(notebook.id, conv.id, owner, { question: "Còn diệp lục thì sao?", scope: {} });

    const second = canned.streamCalls[1] as TextRequest;
    expect(second.system).toContain("Không tìm thấy thông tin này trong các nguồn đã chọn");
    expect(second.system).toContain("Luôn trả lời thật ngắn gọn.");
    const roles = second.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    expect(second.messages[0].content).toBe("Quang hợp là gì?");
    expect(second.messages[1].content).toBe("Lượt một."); // đã bỏ [1] của lượt cũ
    expect(second.messages[2].content).toMatch(/^NGUỒN/);
    expect(second.messages[2].content).toContain("[1] Nguồn: \"Quang hợp\"");
    expect(second.messages[2].content).toContain("CÂU HỎI:\nCòn diệp lục thì sao?");

    // ghi đè prompt chat của người dùng
    const put = await putPrompts(makeRequest("/api/settings/prompts", { method: "PUT", user: owner, body: { prompts: { chat: { system: "HỆ THỐNG RIÊNG: chỉ trả lời bằng gạch đầu dòng.", user: "Hỏi: {{question}}" } } } }));
    expect(put.status).toBe(200);
    canned.answer = "Lượt ba.";
    await askJson(notebook.id, conv.id, owner, { question: "Tóm tắt giúp tôi", scope: {} });
    const third = canned.streamCalls[2] as TextRequest;
    expect(third.system).toContain("HỆ THỐNG RIÊNG");
    expect(third.system).toContain("Luôn trả lời thật ngắn gọn.");
    expect(third.system).not.toContain("Quy tắc trích dẫn (bắt buộc)");
    expect(third.messages[third.messages.length - 1].content).toContain("CÂU HỎI:\nHỏi: Tóm tắt giúp tôi");
  });

  it("tạo lại câu trả lời: thay câu trả lời cuối, không nhân đôi câu hỏi; giữ nếu đã lưu cặp hỏi-đáp", async () => {
    const { owner, notebook } = await ctxWithSource();
    const conv = await newConversation(notebook.id, owner);
    canned.answer = "Bản một [1].";
    const first = await askJson(notebook.id, conv.id, owner, { question: "Quang hợp là gì?", scope: {} });
    canned.answer = "Bản hai [1].";
    const again = await askJson(notebook.id, conv.id, owner, { question: "Quang hợp là gì?", scope: {}, regenerate: true });
    expect(again.body.message.content).toBe("Bản hai [1].");
    expect(again.body.userMessage.id).toBe(first.body.userMessage.id);
    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows.map((r) => `${r.role}:${r.content}`).sort()).toEqual(["assistant:Bản hai [1].", "user:Quang hợp là gì?"]);

    // đã lưu cặp hỏi-đáp thì câu trả lời cũ không bị xoá
    const saved = await saveExchange(
      makeRequest("/x", { method: "POST", user: owner }),
      params({ id: notebook.id, conversationId: conv.id, messageId: again.body.message.id }),
    );
    expect(saved.status).toBe(201);
    canned.answer = "Bản ba [1].";
    await askJson(notebook.id, conv.id, owner, { question: "x", scope: {}, regenerate: true });
    const after = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(after.filter((m) => m.role === "assistant").map((m) => m.content).sort()).toEqual(["Bản ba [1].", "Bản hai [1]."]);
  });

  it("Dừng giữa chừng (client ngắt kết nối): lưu phần trả lời đã nhận, không có sự kiện done", async () => {
    const { owner, notebook } = await ctxWithSource();
    const conv = await newConversation(notebook.id, owner);
    canned.answer = "Một hai ba bốn năm sáu bảy tám chín mười [1].";
    let release!: () => void;
    canned.gate = new Promise<void>((r) => (release = r));
    const ac = new AbortController();
    const req = new Request(`http://localhost:3000/api/notebooks/${notebook.id}/conversations/${conv.id}/messages`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ question: "Quang hợp ở đâu?", scope: {} }),
      signal: ac.signal,
    });
    const res = await ask(req, params({ id: notebook.id, conversationId: conv.id }));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: delta")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    await reader.cancel(); // người dùng bấm "Dừng"
    release();
    // chờ server lưu phần đã nhận
    let saved: (typeof messages.$inferSelect)[] = [];
    for (let i = 0; i < 50 && saved.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 40));
      saved = (await db.select().from(messages).where(eq(messages.conversationId, conv.id))).filter((m) => m.role === "assistant");
    }
    expect(saved).toHaveLength(1);
    expect(saved[0].content.length).toBeGreaterThan(0);
    expect(saved[0].content.length).toBeLessThan("Một hai ba bốn năm sáu bảy tám chín mười [1].".length);
    expect(text).not.toContain("event: done");
  });

  it("giới hạn 60 câu / 10 phút → 429 kèm thông báo; hết cửa sổ thì dùng lại được", async () => {
    const { owner, notebook } = await ctxWithSource();
    const conv = await newConversation(notebook.id, owner);
    canned.answer = "ok [1]";
    await db.insert(rateLimits).values({ key: `ask:${owner.id}`, windowStart: new Date(), count: ASK_RATE_LIMIT.limit });
    const blocked = await askReq(notebook.id, conv.id, owner, { question: "Quang hợp?", scope: {} });
    expect(blocked.status).toBe(429);
    const err = (await blocked.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("rate_limited");
    expect(err.error.message).toMatch(/60 câu/);
    // câu hỏi bị chặn không được lưu
    expect(await db.select().from(messages).where(eq(messages.conversationId, conv.id))).toHaveLength(0);

    await db.update(rateLimits).set({ windowStart: new Date(Date.now() - 11 * 60 * 1000) }).where(eq(rateLimits.key, `ask:${owner.id}`));
    expect((await askReq(notebook.id, conv.id, owner, { question: "Quang hợp?", scope: {} })).status).toBe(200);
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, `ask:${owner.id}`));
    expect(row.count).toBe(1);
  });
});

describe("lưu cặp hỏi-đáp và chuyển thành ghi chú", () => {
  async function answered(roles: Parameters<typeof createNotebookWithMembers>[0] = ["viewer", "editor"]) {
    const ctx = await ctxWithSource(roles);
    canned.answer = "Quang hợp diễn ra ở lục lạp [1]. Chi tiết thêm [9].";
    const asker = ctx.members.viewer ?? ctx.owner;
    const conv = await newConversation(ctx.notebook.id, asker);
    const { body } = await askJson(ctx.notebook.id, conv.id, asker, { question: "Quang hợp diễn ra ở đâu?", scope: {} });
    return { ...ctx, conv, asker, answer: body.message };
  }

  it("save-exchange: viewer lưu được, idempotent; liệt kê chỉ của mình; id sai hội thoại → 404", async () => {
    const { notebook, conv, asker, answer, owner } = await answered();
    const p = params({ id: notebook.id, conversationId: conv.id, messageId: answer.id });
    const r1 = await saveExchange(makeRequest("/x", { method: "POST", user: asker }), p);
    expect(r1.status).toBe(201);
    const ex1 = (await call<{ exchange: { id: string; question: ChatMessageDto; answer: ChatMessageDto } }>(r1)).exchange;
    expect(ex1.question.content).toBe("Quang hợp diễn ra ở đâu?");
    expect(ex1.answer.id).toBe(answer.id);
    const r2 = await saveExchange(makeRequest("/x", { method: "POST", user: asker }), p);
    expect((await call<{ exchange: { id: string } }>(r2)).exchange.id).toBe(ex1.id);

    const mine = await call<{ exchanges: { id: string; answer: ChatMessageDto }[] }>(await listSaved(makeRequest("/x", { user: asker }), params({ id: notebook.id })));
    expect(mine.exchanges.map((e) => e.id)).toEqual([ex1.id]);
    const theirs = await call<{ exchanges: unknown[] }>(await listSaved(makeRequest("/x", { user: owner }), params({ id: notebook.id })));
    expect(theirs.exchanges).toEqual([]);

    // người khác không lưu được câu trả lời của hội thoại không phải của họ
    expect((await saveExchange(makeRequest("/x", { method: "POST", user: owner }), p)).status).toBe(404);
    // tin nhắn của người dùng không phải "câu trả lời"
    const userMsg = (await db.select().from(messages).where(eq(messages.conversationId, conv.id))).find((m) => m.role === "user")!;
    expect((await saveExchange(makeRequest("/x", { method: "POST", user: asker }), params({ id: notebook.id, conversationId: conv.id, messageId: userMsg.id }))).status).toBe(400);
  });

  it("to-note: editor tạo ghi chú origin=chat, nội dung + danh sách nguồn cuối bài; viewer bị 403", async () => {
    const { notebook, conv, answer, members, owner, src } = await answered();
    // câu trả lời của viewer — viewer không tạo được ghi chú
    const p = params({ id: notebook.id, conversationId: conv.id, messageId: answer.id });
    expect((await toNote(makeRequest("/x", { method: "POST", user: members.viewer }), p)).status).toBe(403);

    // owner hỏi trong hội thoại riêng rồi chuyển thành ghi chú
    const oConv = await newConversation(notebook.id, owner);
    canned.answer = "Quang hợp diễn ra ở lục lạp [1]. Chi tiết thêm [9].";
    const { body } = await askJson(notebook.id, oConv.id, owner, { question: "Quang hợp diễn ra ở đâu? Hãy giải thích thật chi tiết cho tôi.", scope: {} });
    const res = await toNote(makeRequest("/x", { method: "POST", user: owner }), params({ id: notebook.id, conversationId: oConv.id, messageId: body.message.id }));
    expect(res.status).toBe(201);
    const { note } = await call<{ note: NoteDto }>(res);
    expect(note).toMatchObject({ origin: "chat", visibility: "shared", isSource: false, canManage: true });
    expect(note.originRef).toEqual({ conversationId: oConv.id, messageId: body.message.id });
    expect(note.title).toBe("Quang hợp diễn ra ở đâu? Hãy giải thích thật chi tiết cho tôi.");
    expect(note.contentMd).toContain("Quang hợp diễn ra ở lục lạp [1]. Chi tiết thêm.");
    expect(note.contentMd).not.toContain("[9]");
    expect(note.contentMd).toMatch(/\*\*Nguồn\*\*\n\n- \[1\] Quang hợp/);
    expect(src.title).toBe("Quang hợp");

    // ghi chú xuất hiện trong danh sách
    const list = await call<{ notes: NoteListItem[] }>(await listNotes(makeRequest("/x", { user: owner }), params({ id: notebook.id })));
    expect(list.notes.map((n) => n.id)).toContain(note.id);
  });
});
