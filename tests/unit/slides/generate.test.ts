import { describe, expect, it } from "vitest";
import { MockAiProvider } from "../../../src/server/ai/mock";
import { SlideGenerationError, editSlideWithAi, generateSlideDeck } from "../../../src/server/artifacts/slides/generate";
import { slideDeckSchema } from "../../../src/server/artifacts/slides/types";
import { cannedDeck, cannedProvider } from "./helpers";
import { sampleDeck } from "./fixtures";

const evidence = sampleDeck().evidence;
const contextText = evidence.map((e, i) => `[${i + 1}] ${e.sourceTitle}\n${e.text}`).join("\n\n");
const base = { contextText, evidence, instructions: "" };

describe("generateSlideDeck", () => {
  it("2 giai đoạn: dàn ý → nội dung; gắn evidence, id, theme; bỏ trích dẫn không hợp lệ; cắt bullet > 6", async () => {
    const { outline, content } = cannedDeck(8);
    const { provider, calls } = cannedProvider([outline, content]);
    const deck = await generateSlideDeck({ ...base, options: { slideCount: 8 }, provider });
    expect(calls).toHaveLength(2);
    expect(calls[0].system).toMatch(/DÀN Ý/);
    expect(calls[1].messages[0].content).toMatch(/DÀN Ý \(8 slide/);
    expect(deck.slides).toHaveLength(8);
    expect(deck.evidence).toEqual(evidence);
    expect(deck.theme.palette).toBe("emerald");
    expect(new Set(deck.slides.map((s) => s.id)).size).toBe(8);
    for (const s of deck.slides) expect(s.citations).toEqual([1, 2]);
    const bullets = deck.slides.find((s) => s.layout === "title_bullets");
    expect(bullets?.bullets).toHaveLength(6);
    const table = deck.slides.find((s) => s.layout === "table");
    expect(table?.table?.rows[1]).toEqual(["z", ""]);
    expect(slideDeckSchema.safeParse(deck).success).toBe(true);
  });

  it("'auto' được phép vượt 15 slide (không có trần cứng)", async () => {
    const { outline, content } = cannedDeck(22);
    const { provider, calls } = cannedProvider([outline, content]);
    const deck = await generateSlideDeck({ ...base, options: { slideCount: "auto" }, provider });
    expect(deck.slides).toHaveLength(22);
    expect(calls[0].messages[0].content).toMatch(/không có giới hạn cứng/);
  });

  it("thử lại đúng 1 lần kèm lỗi xác thực khi đầu ra sai, rồi thành công", async () => {
    const good = cannedDeck(5);
    const { provider, calls } = cannedProvider([{ deckTitle: "", slides: [] }, good.outline, good.content]);
    const deck = await generateSlideDeck({ ...base, options: { slideCount: 5 }, provider });
    expect(deck.slides).toHaveLength(5);
    expect(calls).toHaveLength(3); // dàn ý lỗi + dàn ý thử lại + nội dung
    expect(calls[1].messages[0].content).toMatch(/KẾT QUẢ LẦN TRƯỚC KHÔNG HỢP LỆ/);
  });

  it("ném lỗi sau 2 lần thất bại (số slide không khớp yêu cầu)", async () => {
    const wrong = cannedDeck(4);
    const { provider, calls } = cannedProvider([wrong.outline]);
    await expect(generateSlideDeck({ ...base, options: { slideCount: 6 }, provider })).rejects.toBeInstanceOf(SlideGenerationError);
    expect(calls).toHaveLength(2);
  });

  it("tạo ảnh cho tối đa N slide image_text khi includeImages và provider có generateImage (dataUrl)", async () => {
    // 14 slide → chu kỳ layout cho nhiều slide image_text
    const { outline, content } = cannedDeck(14);
    const { provider } = cannedProvider([outline, content], { image: true });
    const deck = await generateSlideDeck({ ...base, options: { slideCount: 14, includeImages: true, maxImages: 1 }, provider });
    const imgSlides = deck.slides.filter((s) => s.layout === "image_text");
    expect(imgSlides.length).toBeGreaterThan(1);
    expect(imgSlides.filter((s) => s.image?.dataUrl?.startsWith("data:image/png;base64,"))).toHaveLength(1);

    const again = await generateSlideDeck({ ...base, options: { slideCount: 14, includeImages: true }, provider: cannedProvider([outline, content], { image: true }).provider });
    expect(again.slides.filter((s) => s.image?.dataUrl).length).toBe(Math.min(4, imgSlides.length));
  });

  it("không có generateImage → bỏ qua ảnh êm thấy (vẫn trả deck hợp lệ)", async () => {
    const { outline, content } = cannedDeck(8);
    const { provider } = cannedProvider([outline, content]);
    const deck = await generateSlideDeck({ ...base, options: { slideCount: 8, includeImages: true }, provider });
    expect(deck.slides.some((s) => s.image?.dataUrl)).toBe(false);
    expect(deck.slides.some((s) => s.image?.prompt)).toBe(true);
  });

  it("provider mock thuần (đầu ra tối thiểu không hợp lệ) → deck trích xuất từ bằng chứng, hợp lệ theo schema", async () => {
    const deck = await generateSlideDeck({ ...base, options: {}, provider: new MockAiProvider() });
    expect(deck.slides[0].layout).toBe("title");
    expect(deck.slides.at(-1)?.layout).toBe("closing");
    expect(deck.slides.length).toBeGreaterThanOrEqual(3);
    expect(slideDeckSchema.safeParse(deck).success).toBe(true);
    expect(deck.slides.some((s) => s.citations?.includes(1))).toBe(true);
  });

  it("không có nguồn → lỗi rõ ràng", async () => {
    await expect(generateSlideDeck({ contextText: " ", evidence: [], instructions: "", options: {}, provider: new MockAiProvider() })).rejects.toBeInstanceOf(
      SlideGenerationError,
    );
  });
});

describe("editSlideWithAi", () => {
  it("chỉ viết lại slide được chọn; slide khác, theme, evidence giữ nguyên; giữ ảnh khi prompt ảnh không đổi", async () => {
    const deck = sampleDeck();
    const target = deck.slides[5]; // image_text
    expect(target.layout).toBe("image_text");
    const withImg = { ...deck, slides: deck.slides.map((s) => (s.id === target.id ? { ...s, image: { ...s.image!, dataUrl: "data:image/png;base64,AAAA" } } : s)) };
    const { provider, calls } = cannedProvider([
      {
        layout: "image_text",
        title: "Mái nhà điện mặt trời (rút gọn)",
        bullets: ["Lắp tại chỗ", "Giảm tổn thất"],
        image: { prompt: target.image!.prompt },
        citations: [2, 42],
      },
    ]);
    const next = await editSlideWithAi({ content: withImg, slideId: target.id, instruction: "rút gọn còn 2 ý", provider });
    expect(calls[0].messages[0].content).toContain("rút gọn còn 2 ý");
    expect(calls[0].messages[0].content).not.toContain("AAAA"); // không đưa ảnh nhúng vào prompt
    expect(next.slides).toHaveLength(withImg.slides.length);
    next.slides.forEach((s, i) => {
      if (s.id !== target.id) expect(s).toEqual(withImg.slides[i]);
    });
    const edited = next.slides[5];
    expect(edited.id).toBe(target.id);
    expect(edited.title).toBe("Mái nhà điện mặt trời (rút gọn)");
    expect(edited.bullets).toHaveLength(2);
    expect(edited.citations).toEqual([2]);
    expect(edited.image?.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(next.theme).toEqual(withImg.theme);
    expect(next.evidence).toEqual(withImg.evidence);
  });

  it("ném lỗi khi slideId không tồn tại; mô tả ảnh đổi → bỏ ảnh cũ", async () => {
    const deck = sampleDeck();
    const { provider } = cannedProvider([{ layout: "image_text", title: "X", bullets: ["a"], image: { prompt: "ảnh mới" } }]);
    await expect(editSlideWithAi({ content: deck, slideId: "nope", instruction: "x", provider })).rejects.toThrow();
    const target = deck.slides[5];
    const withImg = { ...deck, slides: deck.slides.map((s) => (s.id === target.id ? { ...s, image: { ...s.image!, fileId: "file-1" } } : s)) };
    const next = await editSlideWithAi({ content: withImg, slideId: target.id, instruction: "đổi ảnh", provider });
    expect(next.slides[5].image).toEqual({ prompt: "ảnh mới", caption: undefined, fileId: undefined, dataUrl: undefined });
  });
});
