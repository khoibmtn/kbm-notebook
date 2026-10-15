import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfographicView } from "../../../src/components/studio/infographic/infographic-view";
import { MockAiProvider } from "../../../src/server/ai/mock";
import { exportInfographicSvg, renderInfographicHtml } from "../../../src/server/artifacts/infographic/export";
import { generateInfographic, numbersIn, ungroundedInText } from "../../../src/server/artifacts/infographic/generate";
import { layoutInfographic } from "../../../src/server/artifacts/infographic/layout";
import { infographicJsonSchema, infographicSchema, type InfographicContent } from "../../../src/server/artifacts/infographic/types";
import sample from "../../../src/app/(app)/dev/infographic/sample-infographic.json";
import { SlideGenerationError } from "../../../src/server/artifacts/slides/generate";
import { cannedProvider } from "./helpers";
import { sampleDeck } from "./fixtures";

const fixture = (over: Partial<InfographicContent> = {}): InfographicContent =>
  infographicSchema.parse({ ...JSON.parse(JSON.stringify(sample)), ...over });

const evidence = sampleDeck().evidence;
const contextText = [
  "[1] Báo cáo năng lượng\nĐiện mặt trời tăng 35% so với năm trước. Công suất lắp đặt đạt 17 GW, thuỷ điện 22 GW, nhiệt điện than 26 GW.",
  "[2] Phân tích chính sách\nCơ chế giá điện cần ổn định. Lưới truyền tải quá tải.",
].join("\n\n");
const base = { contextText, evidence, instructions: "", options: {} };

const goodRaw = {
  title: "Điện mặt trời tăng nhanh",
  subtitle: "Bức tranh năng lượng",
  palette: "ocean",
  blocks: [
    { type: "stat", value: "35%", label: "Tăng trưởng điện mặt trời", icon: "trending-up", citations: [1, 77] },
    { type: "stat", value: "17 GW", label: "Công suất lắp đặt", citations: [1] },
    { type: "chart", title: "Công suất theo nguồn (GW)", chart: { type: "bar", labels: ["Thuỷ điện", "Than", "Mặt trời"], series: [{ name: "GW", values: [22, 26, 17] }] }, citations: [1] },
    { type: "list", title: "Vấn đề", items: ["Lưới quá tải", "Giá chưa ổn định"], citations: [2] },
  ],
};

describe("schema & số liệu", () => {
  it("fixture hợp lệ; JSON schema cho mô hình không có evidence và liệt kê đủ 7 loại khối", () => {
    expect(fixture().blocks).toHaveLength(9);
    const props = (infographicJsonSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).not.toContain("evidence");
    const types = (props.blocks as { items: { properties: { type: { enum: string[] } } } }).items.properties.type.enum;
    expect(types.sort()).toEqual(["chart", "compare", "icon_text", "list", "process", "quote", "stat"]);
    expect(infographicSchema.safeParse({ ...fixture(), blocks: [{ id: "x", type: "stat" }] }).success).toBe(false);
  });

  it("numbersIn/ungroundedInText nhận diện số có trong nguồn dù khác định dạng, và từ chối số bịa", () => {
    const known = numbersIn("Doanh thu 1.500 tỷ, tăng 42,5% (xem [3]); năm 2023.");
    expect(ungroundedInText("42,5%", known)).toEqual([]);
    expect(ungroundedInText("1500 tỷ", known)).toEqual([]);
    expect(ungroundedInText("99%", known)).toEqual(["99"]);
    expect(ungroundedInText("3", known)).toEqual(["3"]); // chỉ mục trích dẫn [3] không phải số liệu
  });
});

describe("generateInfographic", () => {
  it("sinh khối từ JSON hợp lệ; bỏ citation ngoài phạm vi; gắn evidence và hướng", async () => {
    const { provider, calls } = cannedProvider([goodRaw]);
    const g = await generateInfographic({ ...base, options: { orientation: "landscape", detail: "detailed" }, provider });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toMatch(/KHÔNG BỊA số liệu/);
    expect(calls[0].messages[0].content).toMatch(/ngang/);
    expect(g.orientation).toBe("landscape");
    expect(g.palette).toBe("ocean");
    expect(g.blocks).toHaveLength(4);
    expect(g.blocks[0].citations).toEqual([1]);
    expect(g.evidence).toEqual(evidence);
    expect(new Set(g.blocks.map((b) => b.id)).size).toBe(4);
  });

  it("từ chối số liệu không có trong nguồn: thử lại 1 lần kèm lỗi, rồi thành công", async () => {
    const invented = { ...goodRaw, blocks: [{ type: "stat", value: "73%", label: "Tỷ lệ bịa", citations: [1] }, ...goodRaw.blocks] };
    const { provider, calls } = cannedProvider([invented, goodRaw]);
    const g = await generateInfographic({ ...base, provider });
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[0].content).toMatch(/không có trong nguồn/);
    expect(g.blocks.some((b) => b.type === "stat" && b.value === "73%")).toBe(false);
  });

  it("ném lỗi sau 2 lần nếu vẫn bịa số hoặc chart/stat thiếu trích dẫn", async () => {
    const invented = { ...goodRaw, blocks: [{ type: "chart", title: "Bịa", chart: { type: "bar", labels: ["a"], series: [{ name: "s", values: [987] }] }, citations: [1] }] };
    await expect(generateInfographic({ ...base, provider: cannedProvider([invented]).provider })).rejects.toBeInstanceOf(SlideGenerationError);
    const noCite = { ...goodRaw, blocks: [{ type: "stat", value: "35%", label: "x" }] };
    await expect(generateInfographic({ ...base, provider: cannedProvider([noCite]).provider })).rejects.toThrow(/citations/);
  });

  it("mock thuần → infographic trích xuất từ bằng chứng, hợp lệ theo schema", async () => {
    const g = await generateInfographic({ ...base, evidence: [{ ...evidence[0], text: "Điện mặt trời tăng 35% so với năm trước. Còn nhiều dư địa." }], provider: new MockAiProvider() });
    expect(infographicSchema.safeParse(g).success).toBe(true);
    expect(g.blocks.length).toBeGreaterThan(0);
    const stat = g.blocks.find((b) => b.type === "stat");
    expect(stat && stat.type === "stat" && stat.value).toBe("35%");
  });
});

describe("dàn trang & xuất", () => {
  it("SVG hợp lệ XML, tự chứa, kích thước danh định (dọc ≥1080×1920, ngang 1920 rộng), có đủ khối và văn bản", () => {
    for (const orientation of ["portrait", "landscape"] as const) {
      const c = fixture({ orientation });
      const svg = exportInfographicSvg(c);
      const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
      const doc = dom.window.document;
      expect(doc.documentElement.nodeName).toBe("svg");
      expect(doc.querySelector("parsererror")).toBeNull();
      const w = Number(doc.documentElement.getAttribute("width"));
      const h = Number(doc.documentElement.getAttribute("height"));
      if (orientation === "portrait") {
        expect(w).toBe(1080);
        expect(h).toBeGreaterThanOrEqual(1920);
      } else {
        expect(w).toBe(1920);
        expect(h).toBeGreaterThanOrEqual(1080);
      }
      const text = doc.documentElement.textContent ?? "";
      expect(text).toContain("Năng lượng tái tạo");
      expect(text).toContain("35%");
      expect(text).toContain("Khảo sát và quy hoạch");
      expect(text).toContain("Nguồn:");
      expect(doc.querySelectorAll("rect").length).toBeGreaterThanOrEqual(c.blocks.length);
      expect(doc.querySelectorAll("path,circle").length).toBeGreaterThan(10); // biểu tượng + biểu đồ
      expect(svg).not.toMatch(/href=|url\(http|<script|<image/);
      expect(svg).toContain("font-family=");
    }
  });

  it("thoát ký tự đặc biệt trong SVG/HTML", () => {
    const c = fixture({ title: 'A & B <script>"x"</script>' });
    const svg = exportInfographicSvg(c);
    expect(new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.querySelector("parsererror")).toBeNull();
    expect(svg).not.toContain("<script>");
    expect(renderInfographicHtml(c)).not.toContain("<script>");
  });

  it("đổi bảng màu đổi màu nhấn; HTML in có @page đúng kích thước", () => {
    expect(exportInfographicSvg(fixture({ palette: "rose" }))).toContain("#e11d48");
    const html = renderInfographicHtml(fixture());
    expect(html).toMatch(/@page\{size:1080px \d+px;margin:0\}/);
    const layout = layoutInfographic(fixture());
    expect(html).toContain(`height:${layout.outHeight}px`);
  });

  it("InfographicView (React) và SVG dùng cùng bộ khoá phần tử", () => {
    const c = fixture();
    const layout = layoutInfographic(c);
    const markup = renderToStaticMarkup(createElement(InfographicView, { content: c, readOnly: true }));
    const doc = new JSDOM(markup).window.document;
    const keys = [...doc.querySelectorAll("[data-key]")].map((e) => e.getAttribute("data-key"));
    expect(keys).toEqual(layout.prims.map((p) => p.key));
  });

  it("mọi khối đều có thẻ nền; hàng được lấp đầy chiều ngang (không để ô trống)", () => {
    const c = fixture({ orientation: "landscape" });
    const layout = layoutInfographic(c);
    const cards = layout.prims.filter((p) => p.type === "rect" && p.key.endsWith("-card"));
    expect(cards).toHaveLength(c.blocks.length);
    const byRow = new Map<number, { x: number; w: number }[]>();
    for (const card of cards) {
      if (card.type !== "rect") continue;
      byRow.set(card.y, [...(byRow.get(card.y) ?? []), { x: card.x, w: card.w }]);
    }
    for (const row of byRow.values()) {
      const right = Math.max(...row.map((r) => r.x + r.w));
      expect(Math.abs(right - (layout.width - 64))).toBeLessThanOrEqual(2);
    }
  });
});
