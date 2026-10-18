import { afterEach, describe, expect, it } from "vitest";
import { getAiProviderForUser } from "@/server/ai";
import { hashEmbed, MockAiProvider, minimalValueFor } from "@/server/ai/mock";
import { unwrapSdkErrorMessage } from "@/server/ai/gemini";
import { AiNotConfiguredError } from "@/server/ai/provider";
import { ARTIFACT_TYPES, DEFAULT_PROMPTS, renderUserPrompt, resolvePrompt } from "@/server/ai/prompts/defaults";
import { resetEnvCache } from "@/server/env";
import { createTestUser } from "../helpers/users";
import { updateAiSettings } from "@/server/settings/service";

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe("unwrapSdkErrorMessage (lỗi Gemini SDK)", () => {
  const google = { error: { code: 429, message: "You exceeded your current quota, please check your plan.", status: "RESOURCE_EXHAUSTED" } };

  it("JSON một lớp (generateContent) → câu thông báo", () => {
    expect(unwrapSdkErrorMessage(JSON.stringify(google))).toBe(google.error.message);
  });

  it("JSON lồng hai lớp (generateContentStream: error.message lại là JSON in đẹp) → câu thông báo trong cùng", () => {
    const nested = JSON.stringify({ error: { message: JSON.stringify(google, null, 2), status: "Too Many Requests" } });
    expect(unwrapSdkErrorMessage(nested)).toBe(google.error.message);
  });

  it("văn bản thường, JSON hỏng hoặc thiếu error.message → giữ nguyên (đã trim)", () => {
    expect(unwrapSdkErrorMessage("  fetch failed ")).toBe("fetch failed");
    expect(unwrapSdkErrorMessage("{not json")).toBe("{not json");
    expect(unwrapSdkErrorMessage(JSON.stringify({ error: { code: 500 } }))).toBe(JSON.stringify({ error: { code: 500 } }));
  });
});

describe("MockAiProvider", () => {
  const mock = new MockAiProvider();

  it("embed trả vector 768 chiều, chuẩn hoá L2, xác định", async () => {
    const [a1, a2, b] = await mock.embed(["Học máy là gì", "Học máy là gì", "Bóng đá Việt Nam"]);
    expect(a1).toHaveLength(768);
    expect(Math.sqrt(a1.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 5);
    expect(a1).toEqual(a2);
    expect(cosine(a1, b)).toBeLessThan(0.5);
  });

  it("văn bản gần nghĩa (chung từ) có cosine cao hơn văn bản khác chủ đề", () => {
    const q = hashEmbed("thuật toán học máy giám sát");
    const near = hashEmbed("học máy giám sát dùng thuật toán phân loại");
    const far = hashEmbed("công thức nấu phở bò");
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });

  it("generateText trả văn bản canned", async () => {
    const r = await mock.generateText({ messages: [{ role: "user", content: "Xin chào" }] });
    expect(r.text).toContain("Xin chào");
    expect(r.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("jsonSchema: trả __mockJson nếu có, nếu không thì object tối thiểu hợp lệ", async () => {
    const schema = {
      type: "object",
      required: ["title", "items"],
      properties: { title: { type: "string" }, items: { type: "array", items: { type: "string" } }, extra: { type: "number" } },
    };
    const withMock = await mock.generateText({ messages: [], jsonSchema: schema, __mockJson: { title: "T", items: ["a"] } });
    expect(withMock.json).toEqual({ title: "T", items: ["a"] });
    const minimal = await mock.generateText({ messages: [], jsonSchema: schema });
    expect(minimal.json).toEqual({ title: "", items: [] });
    expect(minimalValueFor({ type: "string", enum: ["x", "y"] })).toBe("x");
  });

  it("streamText phát từng delta rồi done", async () => {
    let text = "";
    let done = false;
    for await (const c of mock.streamText({ messages: [{ role: "user", content: "hỏi gì đó" }] })) {
      if (c.delta) text += c.delta;
      if (c.done) done = true;
    }
    expect(done).toBe(true);
    expect(text).toContain("hỏi gì đó");
  });

  it("listModels trả danh sách", async () => {
    expect(await mock.listModels()).toContain("mock-chat");
  });
});

describe("getAiProviderForUser", () => {
  const saved = { p: process.env.AI_PROVIDER, k: process.env.GEMINI_API_KEY };
  afterEach(() => {
    process.env.AI_PROVIDER = saved.p;
    process.env.GEMINI_API_KEY = saved.k;
    resetEnvCache();
  });

  it("AI_PROVIDER=mock → mock", async () => {
    const u = await createTestUser();
    expect((await getAiProviderForUser(u.id)).id).toBe("mock");
  });

  it("không có khoá người dùng lẫn server → AiNotConfiguredError", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "";
    resetEnvCache();
    const u = await createTestUser();
    await expect(getAiProviderForUser(u.id)).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("ưu tiên khoá người dùng, rồi khoá server", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "server-key-0123456789";
    resetEnvCache();
    const u = await createTestUser();
    expect((await getAiProviderForUser(u.id)).id).toBe("gemini"); // khoá server
    await updateAiSettings(u.id, { geminiApiKey: "user-key-0123456789" });
    expect((await getAiProviderForUser(u.id)).id).toBe("gemini"); // khoá người dùng
  });
});

describe("prompt mặc định", () => {
  it("có prompt cho mọi loại artifact trong docs/03", () => {
    expect([...ARTIFACT_TYPES].sort()).toEqual(
      ["data_table", "faq", "flashcards", "infographic", "mindmap", "note", "quiz", "report", "slide_deck", "study_guide", "timeline"],
    );
    for (const t of ARTIFACT_TYPES) {
      expect(DEFAULT_PROMPTS[t].system.length).toBeGreaterThan(40);
      expect(DEFAULT_PROMPTS[t].user).toContain("{{instructions}}");
    }
  });

  it("resolvePrompt ghi đè bằng prompt của người dùng", () => {
    const p = resolvePrompt("quiz", { user: "Tạo 5 câu\n{{instructions}}" });
    expect(p.system).toBe(DEFAULT_PROMPTS.quiz.system);
    expect(renderUserPrompt(p, "về lịch sử")).toBe("Tạo 5 câu\nvề lịch sử");
  });
});
