import { describe, expect, it } from "vitest";
import { buildSuggestedQuestions } from "@/lib/chat-suggestions";
import { frameToEvent, splitSseFrames } from "@/lib/chat-stream";
import { makeT } from "@/lib/i18n";
import { deriveNoteTitle, markdownExcerpt, noteFileName } from "@/lib/notes";
import { normalizeEditorMarkdown } from "@/lib/markdown";
import { composeChatSystem, defaultChatSystemPrompt, renderChatUserPrompt, resolveChatPrompt } from "@/server/ai/prompts/defaults";
import { mockGroundedAnswer } from "@/server/ai/mock";
import { buildUserTurn } from "@/server/chat/ask";
import { answerToNoteMarkdown } from "@/server/notes/from-chat";
import { webSourcesToEvidence } from "@/server/knowledge/providers/web";
import type { Evidence } from "@/server/knowledge/providers/types";

const t = makeT("vi");

describe("SSE client", () => {
  it("tách khung theo từng đợt dữ liệu, giữ phần dư chưa hoàn chỉnh", () => {
    const a = splitSseFrames('event: delta\ndata: {"text":"Xin "}\n\nevent: delta\ndata: {"te');
    expect(a.frames).toEqual([{ event: "delta", data: '{"text":"Xin "}' }]);
    const b = splitSseFrames(a.rest + 'xt":"chào"}\n\nevent: done\r\ndata: {"messageId":"m"}\r\n\r\n');
    expect(b.frames.map((f) => f.event)).toEqual(["delta", "done"]);
    expect(b.rest).toBe("");
  });
  it("khung → sự kiện có kiểu; bỏ qua JSON hỏng và loại lạ", () => {
    expect(frameToEvent({ event: "delta", data: '{"text":"a"}' })).toEqual({ type: "delta", text: "a" });
    expect(frameToEvent({ event: "error", data: '{"code":"x","message":"m"}' })).toEqual({ type: "error", code: "x", message: "m" });
    expect(frameToEvent({ event: "delta", data: "{hỏng" })).toBeNull();
    expect(frameToEvent({ event: "ping", data: "{}" })).toBeNull();
  });
});

describe("gợi ý câu hỏi (từ dữ liệu nguồn thật)", () => {
  const src = (over = {}) => ({ title: "Giáo trình sinh học", keyTopics: ["Quang hợp", "Hô hấp tế bào", "Di truyền"], summary: "Tóm tắt", status: "ready" as const, ...over });
  it("một nguồn: tóm tắt + chủ đề chính; nhiều nguồn: so sánh", () => {
    const one = buildSuggestedQuestions([src()], t);
    expect(one[0]).toBe("Tóm tắt nội dung chính của “Giáo trình sinh học”");
    expect(one).toContain("Giải thích “Quang hợp” theo các nguồn đã chọn");
    expect(one.length).toBeLessThanOrEqual(4);
    const many = buildSuggestedQuestions([src(), src({ title: "B", keyTopics: null })], t);
    expect(many[0]).toBe("Tóm tắt nội dung chính của 2 nguồn đã chọn");
    expect(many).toContain("So sánh điểm giống và khác nhau giữa các nguồn đã chọn");
  });
  it("không có nguồn sẵn sàng → không gợi ý gì", () => {
    expect(buildSuggestedQuestions([], t)).toEqual([]);
    expect(buildSuggestedQuestions([src({ status: "processing" as never })], t)).toEqual([]);
  });
});

describe("prompt chat", () => {
  it("prompt mặc định có quy tắc trích dẫn nghiêm ngặt và câu 'không tìm thấy'", () => {
    expect(defaultChatSystemPrompt).toContain("CHỈ dùng các số [n]");
    expect(defaultChatSystemPrompt).toContain("Không tìm thấy thông tin này trong các nguồn đã chọn");
    expect(defaultChatSystemPrompt).toContain("ngôn ngữ của câu hỏi");
    expect(defaultChatSystemPrompt).toContain("số thứ tự nguyên");
    expect(defaultChatSystemPrompt).toContain("[5.1]");
    expect(defaultChatSystemPrompt).toContain("[2.3]");
  });
  it("ghi đè của người dùng + system_instruction của sổ tay", () => {
    expect(resolveChatPrompt(null).system).toBe(defaultChatSystemPrompt);
    expect(resolveChatPrompt({ system: "  " }).system).toBe(defaultChatSystemPrompt);
    expect(resolveChatPrompt({ system: "Riêng", user: "Hỏi: {{question}}" })).toEqual({ system: "Riêng", user: "Hỏi: {{question}}" });
    expect(composeChatSystem("S", null)).toBe("S");
    expect(composeChatSystem("S", "  Ngắn gọn  ")).toContain("Ngắn gọn");
    expect(renderChatUserPrompt("{{question}}", " Câu? ")).toBe("Câu?");
    expect(renderChatUserPrompt("Hãy trả lời", "Câu?")).toBe("Hãy trả lời\n\nCâu?");
  });
  it("lượt người dùng: nguồn đánh số trước, câu hỏi sau; mock trả lời có căn cứ đúng định dạng đó", () => {
    const turn = buildUserTurn("[1] Nguồn: \"Bài\" (trang 2)\nQuang hợp ở lục lạp.", "Quang hợp ở đâu?");
    expect(turn).toMatch(/^NGUỒN[^\n]*\n\[1\] Nguồn: "Bài" \(trang 2\)\nQuang hợp ở lục lạp\.\n\nCÂU HỎI:\nQuang hợp ở đâu\?$/);
    const ans = mockGroundedAnswer(turn)!;
    expect(ans).toContain("Quang hợp ở lục lạp.");
    expect(ans).toMatch(/\[1\]$/);
    expect(buildUserTurn("", "Q?")).toContain("Không có đoạn nguồn nào");
    expect(mockGroundedAnswer("Câu hỏi thường")).toBeNull();
  });
});

describe("ghi chú từ câu trả lời", () => {
  const evidence: Evidence[] = [
    { id: "a", provider: "local", sourceId: "s1", sourceTitle: "Giáo trình", locator: { page: 3 }, text: "x", score: 1 },
    { id: "b", provider: "local", sourceId: "s2", sourceTitle: "Bài giảng", locator: { slide: 2, section: "Mở đầu" }, text: "y", score: 1 },
    { id: "c", provider: "web", sourceId: null, sourceTitle: "Wikipedia", locator: { url: "https://vi.wikipedia.org/x" }, text: "z", score: 1 },
  ];
  it("giữ [n] trong bài và thêm danh sách nguồn kiểu chú thích, chỉ gồm [n] thực sự dùng", () => {
    const md = answerToNoteMarkdown("Ý một [1]. Ý hai [3]. Bịa [8].", evidence);
    expect(md).toBe(
      "Ý một [1]. Ý hai [3]. Bịa.\n\n---\n\n**Nguồn**\n\n- [1] Giáo trình — trang 3\n- [3] Wikipedia (https://vi.wikipedia.org/x)\n",
    );
    expect(answerToNoteMarkdown("Ý [2]", evidence)).toContain('- [2] Bài giảng — slide 2, mục "Mở đầu"');
  });
  it("không có trích dẫn → chỉ nội dung", () => {
    expect(answerToNoteMarkdown("Không tìm thấy.", evidence)).toBe("Không tìm thấy.");
  });
});

describe("tiện ích ghi chú", () => {
  it("tiêu đề suy từ nội dung, đoạn trích, tên tệp xuất", () => {
    expect(deriveNoteTitle("  Đã đặt  ", "x", "Không tên")).toBe("Đã đặt");
    expect(deriveNoteTitle("", "## Chương 1\n\nNội dung", "Không tên")).toBe("Chương 1");
    expect(deriveNoteTitle("", "   ", "Không tên")).toBe("Không tên");
    expect(markdownExcerpt("# Tiêu đề\n\n**Đậm** và [liên kết](http://x.com)\n```\ncode\n```")).toBe("Tiêu đề Đậm và liên kết");
    expect(noteFileName("Ôn tập: Chương 3 (Đại số)")).toBe("On-tap-Chuong-3-Dai-so.md");
    expect(noteFileName("???")).toBe("ghi-chu.md");
  });
  it("chuẩn hoá markdown của trình soạn", () => {
    expect(normalizeEditorMarkdown("a \\[1\\] b\r\n\n\n")).toBe("a [1] b");
  });
});

describe("kho web", () => {
  it("nguồn web → Evidence provider=web với locator.url, khử trùng URL, giới hạn số lượng", () => {
    const ev = webSourcesToEvidence(
      [
        { url: "https://a.com/1", title: "A" },
        { url: "https://a.com/1", title: "A lặp" },
        { url: "https://b.com/", title: "", snippet: "Đoạn trích B" },
        ...Array.from({ length: 10 }, (_, i) => ({ url: `https://c.com/${i}`, title: `C${i}` })),
      ],
      "Tóm tắt của mô hình về chủ đề.",
    );
    expect(ev).toHaveLength(6);
    expect(ev[0]).toMatchObject({ provider: "web", sourceId: null, sourceTitle: "A", locator: { url: "https://a.com/1" }, text: "Tóm tắt của mô hình về chủ đề." });
    expect(ev[1]).toMatchObject({ sourceTitle: "b.com", text: "Đoạn trích B" });
    expect(new Set(ev.map((e) => e.id)).size).toBe(6);
    expect(ev[0].score).toBeGreaterThan(ev[5].score);
    expect(webSourcesToEvidence([], "x")).toEqual([]);
  });
});
