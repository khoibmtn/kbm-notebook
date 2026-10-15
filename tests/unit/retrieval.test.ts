import { describe, expect, it } from "vitest";
import { buildContext, describeLocator } from "@/server/ai/context";
import { toWebSearchQuery } from "@/server/knowledge/providers/local";
import type { Evidence } from "@/server/knowledge/providers/types";
import { rrfMerge, RRF_K } from "@/server/knowledge/rrf";
import { parseViewerHighlight, sourceViewerHref } from "@/lib/sources";

describe("rrfMerge", () => {
  const key = (x: string) => x;

  it("điểm = Σ 1/(k+rank); phần tử có mặt ở cả hai danh sách lên đầu", () => {
    const merged = rrfMerge([["a", "b", "c"], ["c", "d", "a"]], key);
    expect(merged.map((m) => m.item)).toEqual(["a", "c", "b", "d"]);
    const a = merged.find((m) => m.item === "a")!;
    expect(a.score).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 3), 10);
    expect(a.ranks).toEqual([1, 3]);
    const b = merged.find((m) => m.item === "b")!;
    expect(b.ranks).toEqual([2, null]);
  });

  it("hạng 1 của một danh sách đơn thắng hạng 2; hòa điểm giữ thứ tự xuất hiện", () => {
    const merged = rrfMerge([["x"], ["y"]], key);
    expect(merged.map((m) => m.item)).toEqual(["x", "y"]);
    expect(merged[0].score).toBe(merged[1].score);
  });

  it("danh sách rỗng", () => {
    expect(rrfMerge<string>([[], []], key)).toEqual([]);
  });
});

describe("toWebSearchQuery", () => {
  it("bỏ từ dừng/ký tự đặc biệt, nối bằng 'or' (tránh AND làm câu hỏi dài không khớp)", () => {
    expect(toWebSearchQuery("Thủ đô của Pháp là gì?")).toBe("thủ or đô or pháp");
    expect(toWebSearchQuery("what is the (capital) of France")).toBe("capital or france");
    expect(toWebSearchQuery("???")).toBe("");
  });
});

function ev(id: string, text: string, over: Partial<Evidence> = {}): Evidence {
  return {
    id,
    provider: "local",
    sourceId: "s1",
    sourceTitle: "Giáo trình",
    locator: { page: 3, startChar: 0, endChar: text.length },
    text,
    score: 0.03,
    ...over,
  };
}

describe("buildContext", () => {
  it("đánh số [1..n], kèm tên nguồn + trang", () => {
    const { evidence, contextText } = buildContext([ev("a", "Nội dung A"), ev("b", "Nội dung B", { locator: { slide: 2 } })]);
    expect(evidence.map((e) => e.id)).toEqual(["a", "b"]);
    expect(contextText).toContain('[1] Nguồn: "Giáo trình" (trang 3)\nNội dung A');
    expect(contextText).toContain('[2] Nguồn: "Giáo trình" (slide 2)\nNội dung B');
  });

  it("cắt theo ngân sách token: bỏ bằng chứng không vừa, cắt cụt đoạn cuối nếu còn đủ chỗ", () => {
    const big = "Đây là một câu khá dài để chiếm dụng ngân sách token. ".repeat(100); // ~5.4k ký tự ≈ 1.3k token
    const r1 = buildContext([ev("a", big), ev("b", big), ev("c", big)], { tokenBudget: 2000 });
    expect(r1.evidence.map((e) => e.id)).toEqual(["a", "b"]);
    expect(r1.evidence[0].text).toBe(big); // đoạn đầu giữ nguyên
    expect(r1.evidence[1].text.length).toBeLessThan(big.length);
    expect(r1.evidence[1].text.endsWith("…")).toBe(true);
    expect(Math.ceil(r1.contextText.length / 4)).toBeLessThanOrEqual(2000);

    const r2 = buildContext([ev("a", big), ev("b", big)], { tokenBudget: 1400 });
    expect(r2.evidence.map((e) => e.id)).toEqual(["a"]);
  });

  it("danh sách rỗng hoặc ngân sách quá nhỏ → rỗng", () => {
    expect(buildContext([])).toEqual({ evidence: [], contextText: "" });
    expect(buildContext([ev("a", "x".repeat(4000))], { tokenBudget: 10 }).evidence).toEqual([]);
  });

  it("describeLocator", () => {
    expect(describeLocator({ page: 5, section: "Mở đầu" })).toBe('trang 5, mục "Mở đầu"');
    expect(describeLocator({ url: "https://a.b" })).toBe("https://a.b");
    expect(describeLocator({})).toBe("");
  });
});

describe("sourceViewerHref / parseViewerHighlight", () => {
  it("tạo link có chunk + vị trí dự phòng và parse ngược lại", () => {
    const href = sourceViewerHref("nb1", {
      id: "c1",
      provider: "local",
      sourceId: "s1",
      locator: { page: 4, startChar: 120, endChar: 480 },
    })!;
    expect(href).toBe("/n/nb1/sources/s1?chunk=c1&page=4&start=120&end=480");
    const q = new URL(href, "http://x").searchParams;
    expect(parseViewerHighlight(q)).toEqual({ chunk: "c1", page: 4, start: 120, end: 480 });
  });

  it("slide dùng làm page; bằng chứng web/không có nguồn → null", () => {
    expect(sourceViewerHref("nb", { id: "c", sourceId: "s", locator: { slide: 7 } })).toContain("page=7");
    expect(sourceViewerHref("nb", { id: "w", provider: "web", sourceId: null, locator: {} })).toBeNull();
    expect(sourceViewerHref("nb", { id: "w", provider: "notebooklm-bridge", sourceId: "s", locator: {} })).toBeNull();
  });

  it("bỏ qua tham số rác", () => {
    expect(parseViewerHighlight(new URLSearchParams("page=abc&start=-1&end="))).toEqual({
      chunk: undefined,
      page: undefined,
      start: undefined,
      end: undefined,
    });
  });
});
