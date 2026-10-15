import { MockAiProvider } from "../../../src/server/ai/mock";
import type { AiProvider, TextRequest } from "../../../src/server/ai/provider";
import type { SlideLayout } from "../../../src/server/artifacts/slides/types";

export type Canned = { provider: AiProvider; calls: TextRequest[] };

/** Provider giả trả lần lượt các JSON dựng sẵn (qua cơ chế `__mockJson` của MockAiProvider). */
export function cannedProvider(responses: unknown[], opts: { image?: boolean; id?: "gemini" | "mock" } = {}): Canned {
  const mock = new MockAiProvider();
  const calls: TextRequest[] = [];
  const queue = [...responses];
  const provider: AiProvider = {
    id: opts.id ?? "gemini",
    generateText: async (req) => {
      calls.push(req);
      return mock.generateText({ ...req, __mockJson: queue.length > 1 ? queue.shift() : queue[0] });
    },
    streamText: (req) => mock.streamText(req),
    embed: (texts, o) => mock.embed(texts, o),
    ...(opts.image
      ? {
          generateImage: async () => ({
            // PNG 1×1 hợp lệ
            bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
            mime: "image/png",
          }),
        }
      : {}),
  };
  return { provider, calls };
}

const LAYOUT_CYCLE: SlideLayout[] = ["title_bullets", "chart", "two_column", "table", "image_text", "quote"];

/** Dàn ý + nội dung giả (n slide) hợp lệ theo schema sinh. */
export function cannedDeck(n: number, evidenceCount = 3) {
  const layouts: SlideLayout[] = Array.from({ length: n }, (_, i) => (i === 0 ? "title" : i === n - 1 ? "closing" : LAYOUT_CYCLE[(i - 1) % LAYOUT_CYCLE.length]));
  const outline = {
    deckTitle: "Bộ slide thử",
    palette: "emerald",
    sections: [{ title: "Phần 1", summary: "Tóm tắt" }],
    slides: layouts.map((layout, i) => ({ layout, title: `Slide ${i + 1} tiêu đề`, purpose: "Truyền đạt ý chính", citations: [1] })),
  };
  const slides = layouts.map((layout, i) => {
    const base = { layout, title: `Slide ${i + 1} tiêu đề`, notes: "Câu một. Câu hai. Câu ba.", citations: [1, 2, 99, 1, evidenceCount + 5] };
    switch (layout) {
      case "title":
        return { ...base, subtitle: "Phụ đề" };
      case "closing":
        return { ...base, bullets: ["Kết luận một", "Kết luận hai"] };
      case "title_bullets":
        return { ...base, bullets: ["Ý một", "Ý hai", "Ý ba", "Ý bốn", "Ý năm", "Ý sáu", "Ý bảy thừa"] };
      case "chart":
        return { ...base, chart: { type: "bar", labels: ["A", "B", "C"], series: [{ name: "Giá trị", values: [10, 20, 30] }] } };
      case "two_column":
        return { ...base, columns: [{ heading: "Trái", bullets: ["a", "b"] }, { heading: "Phải", bullets: ["c", "d"] }] };
      case "table":
        return { ...base, table: { headers: ["Cột 1", "Cột 2"], rows: [["x", "y"], ["z"]] } };
      case "image_text":
        return { ...base, bullets: ["Ý một", "Ý hai"], image: { prompt: "A flat illustration of a solar panel", caption: "Ảnh" } };
      default:
        return { ...base, quote: { text: "Câu trích nguyên văn", attribution: "Nguồn" } };
    }
  });
  return { outline, content: { theme: { palette: "emerald", font: "Inter" }, slides } };
}
