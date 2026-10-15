import { afterEach, describe, expect, it } from "vitest";
import {
  contentSchemaFor,
  dataTableContentSchema,
  flashcardsContentSchema,
  mindmapContentSchema,
  parseContent,
  quizContentSchema,
  type ArtifactEvidence,
  type MindmapNode,
} from "@/lib/artifacts/content";
import { buildContext } from "@/server/ai/context";
import { clearMockJson, MockAiProvider, registerMockJson } from "@/server/ai/mock";
import { composePrompt } from "@/server/artifacts/prompt";
import { runGenerator } from "@/server/artifacts/generators";
import { ArtifactGenerationError } from "@/server/artifacts/generators/common";
import { buildMindmapTree } from "@/server/artifacts/generators/mindmap";
import { normalizeQuizQuestion } from "@/server/artifacts/generators/quiz";
import { parseNumberedContext } from "@/server/ai/mock-artifacts";
import { DEFAULT_PROMPTS, ARTIFACT_TYPES } from "@/server/ai/prompts/defaults";
import { ARTIFACT_TYPE_LIST } from "@/lib/artifacts/content";
import { toJsonSchema, quizOutputSchema, mindmapOutputSchema } from "@/server/artifacts/schemas";

const evidence: ArtifactEvidence[] = [
  { id: "c1", provider: "local", sourceId: "s1", sourceTitle: "Tài liệu A", locator: { page: 1 }, text: "Quang hợp chuyển hoá ánh sáng thành năng lượng hoá học trong lục lạp của thực vật.", score: 0.03 },
  { id: "c2", provider: "local", sourceId: "s1", sourceTitle: "Tài liệu A", locator: { page: 2 }, text: "Ty thể tạo ra ATP trong quá trình hô hấp tế bào của sinh vật nhân thực.", score: 0.02 },
  { id: "c3", provider: "local", sourceId: "s2", sourceTitle: "Tài liệu B", locator: { page: 5 }, text: "Ribosome là nơi tổng hợp protein theo mã di truyền của RNA thông tin.", score: 0.01 },
];

function input(options: Record<string, unknown> = {}) {
  const ctx = buildContext(evidence);
  return {
    contextText: ctx.contextText,
    evidence: ctx.evidence as ArtifactEvidence[],
    instructions: "Tạo nội dung",
    options,
    provider: new MockAiProvider(),
  };
}

afterEach(() => clearMockJson());

describe("schema nội dung", () => {
  it("danh sách loại của lib khớp với defaults.ts", () => {
    expect([...ARTIFACT_TYPE_LIST].sort()).toEqual([...ARTIFACT_TYPES].sort());
    for (const t of ARTIFACT_TYPE_LIST) expect(DEFAULT_PROMPTS[t].system.length).toBeGreaterThan(10);
  });

  it("quiz: mcq phải có ≥2 lựa chọn và đáp án nằm trong lựa chọn; tf chỉ true/false", () => {
    const base = { id: "q1", stem: "?", explanation: "", difficulty: "easy" as const };
    const ok = { questions: [{ ...base, type: "mcq", options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], answer: "B" }], evidence: [] };
    expect(quizContentSchema.safeParse(ok).success).toBe(true);
    expect(quizContentSchema.safeParse({ ...ok, questions: [{ ...ok.questions[0], answer: "C" }] }).success).toBe(false);
    expect(quizContentSchema.safeParse({ ...ok, questions: [{ ...ok.questions[0], options: [{ key: "A", text: "a" }] }] }).success).toBe(false);
    expect(quizContentSchema.safeParse({ questions: [{ ...base, type: "tf", answer: "maybe" }], evidence: [] }).success).toBe(false);
    expect(quizContentSchema.safeParse({ questions: [], evidence: [] }).success).toBe(false);
  });

  it("flashcards, data_table (khoá cột trùng bị từ chối), mindmap đệ quy", () => {
    expect(flashcardsContentSchema.safeParse({ cards: [{ id: "c", front: "a", back: "b" }], evidence: [] }).success).toBe(true);
    expect(flashcardsContentSchema.safeParse({ cards: [{ id: "c", front: "", back: "b" }], evidence: [] }).success).toBe(false);
    const cols = [{ key: "a", label: "A" }, { key: "a", label: "A2" }];
    expect(dataTableContentSchema.safeParse({ columns: cols, rows: [], evidence: [] }).success).toBe(false);
    const tree: MindmapNode = { id: "r", label: "Gốc", children: [{ id: "x", label: "Con", children: [{ id: "y", label: "Cháu", children: [] }] }] };
    expect(mindmapContentSchema.safeParse({ root: tree, evidence: [] }).success).toBe(true);
  });

  it("slide_deck/infographic: chỉ kiểm khung (engine kiểm chi tiết)", () => {
    expect(contentSchemaFor("slide_deck").safeParse({ theme: { palette: "x", font: "y" }, slides: [{ id: "s1", title: "Bất kỳ" }], evidence: [] }).success).toBe(true);
    expect(contentSchemaFor("slide_deck").safeParse({ slides: [], evidence: [] }).success).toBe(false);
    expect(() => parseContent("infographic", { title: "t", blocks: [{ type: "stat" }], evidence: [] })).not.toThrow();
  });

  it("JSON schema gửi cho model hợp lệ (không còn $schema, có required)", () => {
    const js = toJsonSchema(quizOutputSchema) as { $schema?: string; required?: string[]; properties: Record<string, unknown> };
    expect(js.$schema).toBeUndefined();
    expect(js.required).toContain("questions");
    const mm = toJsonSchema(mindmapOutputSchema) as { properties: { nodes: { items: { properties: { parentId: unknown } } } } };
    expect(JSON.stringify(mm.properties.nodes.items.properties.parentId)).toContain("null");
  });
});

describe("generator tạo từ mock có JSON đã đăng ký", () => {
  it("quiz: chuẩn hoá đáp án, loại câu hỏng, cắt theo count, ánh xạ trích dẫn", async () => {
    registerMockJson("artifact:quiz", {
      title: "Q",
      questions: [
        { type: "mcq", stem: "Câu 1", options: [{ key: "a", text: "Một" }, { key: "b", text: "Hai" }], answer: "B.", explanation: "e", citations: [3], difficulty: "easy" },
        { type: "mcq", stem: "Câu hỏng", options: [{ key: "A", text: "Một" }, { key: "B", text: "Hai" }], answer: "Z", explanation: "e", citations: [1], difficulty: "easy" },
        { type: "mcq", stem: "Đáp án theo nội dung", options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }], answer: "alpha", explanation: "e", citations: [1], difficulty: "hard" },
        { type: "tf", stem: "Đúng không?", answer: "Đúng", explanation: "e", citations: [], difficulty: "medium" },
        { type: "short", stem: "Nêu", answer: "ATP", explanation: "e", citations: [2, 2], difficulty: "medium" },
      ],
    });
    const out = await runGenerator("quiz", input({ count: 3 }));
    const c = quizContentSchema.parse(out.content);
    expect(c.questions).toHaveLength(3);
    expect(c.questions.map((q) => q.answer)).toEqual(["B", "A", "true"]);
    expect(c.questions[0].options?.map((o) => o.key)).toEqual(["A", "B"]);
    expect(c.questions[0].citations).toEqual([1]);
    expect(c.questions[1].citations).toEqual([2]);
    expect(c.questions[2].citations).toBeUndefined();
    expect(c.evidence.map((e) => e.id)).toEqual(["c3", "c1"]); // chỉ bằng chứng thật sự được trích
    expect(new Set(c.questions.map((q) => q.id)).size).toBe(3);
    expect(out.title).toBe("Q");
  });

  it("quiz: toàn bộ câu hỏi hỏng → ArtifactGenerationError (không bịa)", async () => {
    registerMockJson("artifact:quiz", { title: "Q", questions: [{ type: "mcq", stem: "x", options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], answer: "Z", explanation: "", citations: [], difficulty: "easy" }] });
    await expect(runGenerator("quiz", input())).rejects.toBeInstanceOf(ArtifactGenerationError);
  });

  it("JSON sai schema → thử lại một lần rồi báo lỗi rõ ràng", async () => {
    let calls = 0;
    const { registerMockJsonFn } = await import("@/server/ai/mock");
    registerMockJsonFn("artifact:flashcards", () => {
      calls++;
      return { title: "x", cards: "không phải mảng" };
    });
    await expect(runGenerator("flashcards", input())).rejects.toThrow(/không hợp lệ/);
    expect(calls).toBe(2);
  });

  it("flashcards: bỏ thẻ rỗng, gắn tags, cắt count", async () => {
    registerMockJson("artifact:flashcards", {
      title: "F",
      cards: [
        { front: "Ty thể?", back: "Tạo ATP", tags: [" sinh học ", ""], citations: [2] },
        { front: "", back: "bỏ", citations: [] },
        { front: "Ribosome?", back: "Tổng hợp protein", hint: "Gợi ý", citations: [3] },
        { front: "Thừa", back: "thừa", citations: [] },
      ],
    });
    const c = flashcardsContentSchema.parse((await runGenerator("flashcards", input({ count: 2 }))).content);
    expect(c.cards.map((x) => x.front)).toEqual(["Ty thể?", "Ribosome?"]);
    expect(c.cards[0].tags).toEqual(["sinh học"]);
    expect(c.cards[1].hint).toBe("Gợi ý");
    expect(c.evidence.map((e) => e.id)).toEqual(["c2", "c3"]);
  });

  it("mindmap: dựng cây từ danh sách phẳng; cha thiếu → gắn gốc; chu trình bị loại; cắt theo depth", async () => {
    const nodes = [
      { id: "r", parentId: null, label: "Tế bào" },
      { id: "a", parentId: "r", label: "Bào quan", citations: [2] },
      { id: "b", parentId: "a", label: "Ty thể" },
      { id: "c", parentId: "b", label: "ATP" },
      { id: "orphan", parentId: "khong-ton-tai", label: "Mồ côi" },
      { id: "x", parentId: "y", label: "Vòng 1" },
      { id: "y", parentId: "x", label: "Vòng 2" },
    ];
    const tree = buildMindmapTree(nodes, 2);
    expect(tree.label).toBe("Tế bào");
    expect(tree.children.map((n) => n.label)).toEqual(["Bào quan", "Mồ côi"]);
    expect(tree.children[0].children.map((n) => n.label)).toEqual(["Ty thể"]);
    expect(tree.children[0].children[0].children).toEqual([]); // depth=2 cắt "ATP"

    registerMockJson("artifact:mindmap", { title: "M", nodes });
    const c = mindmapContentSchema.parse((await runGenerator("mindmap", input({ depth: 3 }))).content);
    expect(c.root.children[0].citations).toEqual([1]);
    expect(c.evidence.map((e) => e.id)).toEqual(["c2"]);
    expect(JSON.stringify(c.root)).not.toContain("Vòng");
  });

  it("data_table: khoá cột được chuẩn hoá duy nhất, ô thiếu thành chuỗi rỗng, dòng rỗng bị bỏ", async () => {
    registerMockJson("artifact:data_table", {
      title: "T",
      columns: [{ key: "Tên", label: "Tên bào quan" }, { key: "tên", label: "Chức năng" }],
      rows: [
        { cells: ["Ty thể", "Tạo ATP"], citations: [2] },
        { cells: ["", ""], citations: [] },
        { cells: ["Ribosome"], citations: [3] },
      ],
    });
    const c = dataTableContentSchema.parse((await runGenerator("data_table", input())).content);
    expect(c.columns.map((x) => x.key)).toEqual(["ten", "ten_2"]);
    expect(c.rows).toHaveLength(2);
    expect(c.rows[1].cells).toEqual({ ten: "Ribosome", ten_2: "" });
  });

  it("report: markdown được hậu kiểm [n]", async () => {
    registerMockJson("artifact:report", { title: "R", markdown: "Ý A [3]. Ý B [1][8]." });
    const out = await runGenerator("report", input());
    expect(out.content).toMatchObject({ markdown: "Ý A [1]. Ý B [2]." });
    expect((out.content as { evidence: ArtifactEvidence[] }).evidence.map((e) => e.id)).toEqual(["c3", "c1"]);
  });

  it("slide_deck/infographic ném 501 not_implemented khi chưa có engine", async () => {
    await expect(runGenerator("slide_deck", input())).rejects.toMatchObject({ status: 501, code: "not_implemented" });
    await expect(runGenerator("infographic", input())).rejects.toMatchObject({ status: 501, code: "not_implemented" });
  });
});

describe("mock dựng từ ngữ cảnh (dev/e2e, không đăng ký JSON)", () => {
  it("mọi loại nội bộ cho ra nội dung hợp lệ theo schema, trích dẫn tới bằng chứng thật", async () => {
    for (const type of ["note", "report", "study_guide", "faq", "timeline", "quiz", "flashcards", "mindmap", "data_table"] as const) {
      const out = await runGenerator(type, input({ count: 3 }));
      expect(() => parseContent(type, out.content), type).not.toThrow();
      expect((out.content as { evidence: unknown[] }).evidence.length, type).toBeGreaterThan(0);
      expect(out.title, type).toContain("[mock]");
    }
  });

  it("parseNumberedContext đọc lại đúng khối [n] Nguồn", () => {
    const ctx = buildContext(evidence);
    const blocks = parseNumberedContext(`yêu cầu\n\nNGUỒN:\n${ctx.contextText}`);
    expect(blocks.map((b) => [b.n, b.title])).toEqual([[1, "Tài liệu A"], [2, "Tài liệu A"], [3, "Tài liệu B"]]);
    expect(blocks[0].sentences[0]).toContain("Quang hợp");
  });
});

describe("normalizeQuizQuestion", () => {
  it("tf: chấp nhận đúng/sai/true/false", () => {
    const q = { type: "tf" as const, stem: "s", answer: "Sai", explanation: "", citations: [], difficulty: "easy" as const };
    expect(normalizeQuizQuestion(q)?.answer).toBe("false");
    expect(normalizeQuizQuestion({ ...q, answer: "???" })).toBeNull();
  });
});

describe("composePrompt", () => {
  it("ghép mặc định ⊕ ghi đè người dùng ⊕ prompt riêng ⊕ tuỳ chọn; ngôn ngữ mặc định tiếng Việt", () => {
    const p = composePrompt({ type: "quiz", customPrompt: "Tập trung vào ty thể", options: { count: 7, difficulty: "hard", questionTypes: ["mcq", "tf"] } });
    expect(p.system).toBe(DEFAULT_PROMPTS.quiz.system);
    expect(p.user).toContain("Tập trung vào ty thể");
    expect(p.user).toContain("Ngôn ngữ đầu ra: Tiếng Việt");
    expect(p.user).toContain("đúng 7 câu hỏi");
    expect(p.user).toContain("Độ khó: khó");
    expect(p.user).toContain("trắc nghiệm một đáp án (mcq), đúng/sai (tf)");
    expect(p.options.count).toBe(7);
    expect(p.language).toBe("Tiếng Việt");

    const o = composePrompt({
      type: "report",
      override: { system: "SYSTEM RIÊNG", user: "Viết báo cáo.\n{{instructions}}\n{{options}}", options: { tone: "thân mật" } },
      options: { language: "English", length: "short", format: "faq" },
    });
    expect(o.system).toBe("SYSTEM RIÊNG");
    expect(o.user).toContain("Ngôn ngữ đầu ra: English");
    expect(o.user).toContain("Độ dài: ngắn");
    expect(o.user).toContain("Kiểu tài liệu: Bộ câu hỏi thường gặp");
    expect(o.user).toContain("tone: thân mật");
    expect(o.language).toBe("English");
  });

  it("slide_deck: tuỳ chọn mặc định `slides` được đổi thành slideCount; lần tạo ghi đè", () => {
    expect(composePrompt({ type: "slide_deck" }).options.slideCount).toBe(12);
    expect(composePrompt({ type: "slide_deck", options: { slideCount: "auto" } }).user).toContain("Số slide: tự chọn");
  });
});
