import { describe, expect, it } from "vitest";
import { buildDocument, chunkDocument, chunkSegments, normalizeText } from "@/server/knowledge/ingest/chunk";

/** Văn bản gồm n câu, mỗi câu ~60 ký tự, đánh số để kiểm tra thứ tự. */
function sentences(n: number, prefix = "Câu"): string {
  return Array.from({ length: n }, (_, i) => `${prefix} số ${i + 1} nói về chủ đề học tập và nghiên cứu khoa học.`).join(" ");
}

describe("normalizeText", () => {
  it("bỏ NUL/ký tự điều khiển, gộp dòng trống, chuẩn hoá xuống dòng", () => {
    expect(normalizeText("a\u0000b\r\n\r\n\r\n\r\nc  \n d e")).toBe("ab\n\nc\n d e");
  });
});

describe("buildDocument", () => {
  it("ghép segment, bỏ segment rỗng và ghi lại spans chính xác", () => {
    const doc = buildDocument([{ text: "Trang một", page: 1 }, { text: "  ", page: 2 }, { text: "Trang ba", page: 3 }]);
    expect(doc.spans).toHaveLength(2);
    for (const s of doc.spans) expect(doc.text.slice(s.start, s.end)).toBe(s.page === 1 ? "Trang một" : "Trang ba");
  });
});

describe("chunkDocument", () => {
  it("văn bản ngắn → đúng 1 chunk, offset khớp", () => {
    const { doc, chunks } = chunkSegments([{ text: "Xin chào. Đây là một đoạn ngắn." }]);
    expect(chunks).toHaveLength(1);
    expect(doc.text.slice(chunks[0].startChar, chunks[0].endChar)).toBe(chunks[0].text);
  });

  it("start_char/end_char luôn trỏ đúng văn bản gốc; kích thước ≤ mục tiêu", () => {
    const { doc, chunks } = chunkSegments([{ text: sentences(200) }], { targetTokens: 200, overlapTokens: 30 });
    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((c, i) => {
      expect(c.idx).toBe(i);
      expect(doc.text.slice(c.startChar, c.endChar)).toBe(c.text);
      expect(c.text.length).toBeLessThanOrEqual(200 * 4);
      expect(c.tokenCount).toBe(Math.ceil(c.text.length / 4));
    });
  });

  it("mặc định ≈ 800 token và có chồng lấn ≈ 120 token giữa hai chunk liền kề", () => {
    const { chunks } = chunkSegments([{ text: sentences(400) }]);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 0; i < chunks.length - 1; i++) {
      const a = chunks[i];
      const b = chunks[i + 1];
      expect(a.tokenCount).toBeLessThanOrEqual(800);
      expect(a.tokenCount).toBeGreaterThan(600);
      expect(b.startChar).toBeLessThan(a.endChar); // chồng lấn
      const overlapTokens = Math.ceil((a.endChar - b.startChar) / 4);
      expect(overlapTokens).toBeLessThanOrEqual(120);
      expect(overlapTokens).toBeGreaterThan(30);
      expect(b.startChar).toBeGreaterThan(a.startChar); // luôn tiến
    }
  });

  it("không cắt giữa câu: mọi chunk bắt đầu đầu câu và kết thúc ở dấu chấm", () => {
    const { chunks } = chunkSegments([{ text: sentences(120) }], { targetTokens: 150, overlapTokens: 25 });
    for (const c of chunks) {
      expect(c.text.startsWith("Câu số ")).toBe(true);
      expect(c.text.endsWith("khoa học.")).toBe(true);
    }
  });

  it("phủ kín văn bản: mọi câu xuất hiện ít nhất một lần", () => {
    const { chunks } = chunkSegments([{ text: sentences(150) }], { targetTokens: 120, overlapTokens: 20 });
    const joined = chunks.map((c) => c.text).join("\n");
    for (let i = 1; i <= 150; i++) expect(joined).toContain(`Câu số ${i} nói`);
  });

  it("giữ số trang và không bao giờ vượt qua ranh giới trang", () => {
    const pages = [1, 2, 3].map((p) => ({ text: sentences(60, `Trang${p}`), page: p }));
    const { doc, chunks } = chunkSegments(pages, { targetTokens: 200, overlapTokens: 30 });
    const seen = new Set<number>();
    for (const c of chunks) {
      expect(c.page).toBeDefined();
      seen.add(c.page!);
      const span = doc.spans.find((s) => s.page === c.page)!;
      expect(c.startChar).toBeGreaterThanOrEqual(span.start);
      expect(c.endChar).toBeLessThanOrEqual(span.end);
      expect(c.text.startsWith(`Trang${c.page}`)).toBe(true);
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it("trang ngắn → mỗi trang một chunk riêng, giữ đúng slide/section", () => {
    const { chunks } = chunkSegments([
      { text: "Nội dung slide 1", slide: 1, section: "Mở đầu" },
      { text: "Nội dung slide 2", slide: 2, section: "Kết quả" },
    ]);
    expect(chunks.map((c) => [c.slide, c.section])).toEqual([
      [1, "Mở đầu"],
      [2, "Kết quả"],
    ]);
  });

  it("gộp các mục ngắn không có trang vào cùng chunk nhưng không gộp khi có trang", () => {
    const merged = chunkSegments([
      { text: "Mục A ngắn.", section: "A" },
      { text: "Mục B ngắn.", section: "B" },
    ]);
    expect(merged.chunks).toHaveLength(1);
    expect(merged.chunks[0].section).toBe("A");
    expect(merged.chunks[0].text).toContain("Mục B");
  });

  it("câu quá dài không có dấu câu vẫn được cắt cứng tại khoảng trắng", () => {
    const words = Array.from({ length: 2000 }, (_, i) => `từ${i}`).join(" ");
    const { doc, chunks } = chunkSegments([{ text: words }], { targetTokens: 100, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(400);
      expect(doc.text.slice(c.startChar, c.endChar)).toBe(c.text);
      expect(/^từ\d+/.test(c.text)).toBe(true); // không cắt giữa từ
      expect(/từ\d+$/.test(c.text)).toBe(true);
    }
  });

  it("tài liệu rỗng → không có chunk", () => {
    expect(chunkDocument(buildDocument([{ text: "   " }]))).toEqual([]);
  });

  it("giữ nguyên tiếng Việt có dấu và xuống dòng bên trong chunk", () => {
    const text = "Dòng một có dấu: đạo hàm.\nDòng hai: tích phân.\nDòng ba: ma trận.";
    const { chunks } = chunkSegments([{ text }]);
    expect(chunks[0].text).toBe(text);
  });
});
