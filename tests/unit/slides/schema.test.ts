import { describe, expect, it } from "vitest";
import {
  autoSlideCountTarget,
  hasNumericData,
  normalizeModelSlide,
  sanitizeCitations,
} from "../../../src/server/artifacts/slides/generate";
import { slideDeckJsonSchema, slideDeckSchema } from "../../../src/server/artifacts/slides/types";
import { sampleDeck } from "./fixtures";

describe("slideDeckSchema", () => {
  it("chấp nhận deck hợp lệ (fixture) và giữ nguyên cấu trúc", () => {
    const deck = sampleDeck();
    expect(deck.slides).toHaveLength(11);
    expect(deck.slides.map((s) => s.layout)).toContain("chart");
    expect(deck.evidence).toHaveLength(3);
  });

  it("từ chối layout lạ, palette lạ, citation không nguyên dương, thiếu evidence", () => {
    const deck = sampleDeck();
    expect(slideDeckSchema.safeParse({ ...deck, slides: [{ ...deck.slides[0], layout: "hero" }] }).success).toBe(false);
    expect(slideDeckSchema.safeParse({ ...deck, theme: { palette: "pink", font: "Inter" } }).success).toBe(false);
    expect(slideDeckSchema.safeParse({ ...deck, slides: [{ ...deck.slides[0], citations: [0] }] }).success).toBe(false);
    expect(slideDeckSchema.safeParse({ theme: deck.theme, slides: deck.slides }).success).toBe(false);
  });

  it("JSON schema cho mô hình không có trường evidence và liệt kê đủ 9 layout", () => {
    const props = (slideDeckJsonSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props).sort()).toEqual(["slides", "theme"]);
    const layouts = (props.slides as { items: { properties: { layout: { enum: string[] } } } }).items.properties.layout.enum;
    expect(layouts).toHaveLength(9);
  });
});

describe("trích dẫn", () => {
  it("sanitizeCitations bỏ số ngoài khoảng, trùng, không nguyên", () => {
    expect(sanitizeCitations([3, 1, 1, 0, -2, 99, 2.5, "2", null], 3)).toEqual([1, 2, 3]);
    expect(sanitizeCitations(undefined, 3)).toEqual([]);
  });

  it("normalizeModelSlide loại số không có trong evidence, cắt bullet > 6, chuẩn hoá hàng bảng", () => {
    const bullets = normalizeModelSlide(
      { layout: "title_bullets", title: "T", bullets: ["- a", "• b", "c", "d", "e", "f", "g", "h"], citations: [1, 2, 7] },
      2,
    );
    expect(bullets.errors).toEqual([]);
    expect(bullets.slide?.citations).toEqual([1, 2]);
    expect(bullets.slide?.bullets).toEqual(["a", "b", "c", "d", "e", "f"]);

    const table = normalizeModelSlide({ layout: "table", title: "T", table: { headers: ["A", "B"], rows: [["1"], ["1", "2", "3"]] } }, 0);
    expect(table.slide?.table?.rows).toEqual([["1", ""], ["1", "2"]]);
  });

  it("normalizeModelSlide báo lỗi cứng khi thiếu dữ liệu mà layout cần", () => {
    expect(normalizeModelSlide({ layout: "chart", title: "T" }, 0).errors[0]).toMatch(/chart/);
    expect(
      normalizeModelSlide({ layout: "chart", title: "T", chart: { type: "bar", labels: ["a", "b"], series: [{ name: "s", values: [1] }] } }, 0).errors[0],
    ).toMatch(/values/);
    expect(normalizeModelSlide({ layout: "image_text", title: "T", bullets: ["x"] }, 0).errors[0]).toMatch(/image\.prompt/);
    expect(normalizeModelSlide({ layout: "quote", title: "T" }, 0).errors[0]).toMatch(/quote/);
    expect(normalizeModelSlide({ layout: "two_column", title: "T", columns: [{ heading: "a", bullets: ["x"] }] }, 0).errors[0]).toMatch(/2/);
  });
});

describe("gợi ý số slide & số liệu", () => {
  it("'auto' nằm trong 10–25 theo độ dài ngữ cảnh, không bị chặn ở 15", () => {
    expect(autoSlideCountTarget("x".repeat(100))).toBe(10);
    expect(autoSlideCountTarget("x".repeat(60_000))).toBeGreaterThan(15);
    expect(autoSlideCountTarget("x".repeat(500_000))).toBe(25);
  });

  it("hasNumericData nhận diện văn bản có nhiều số liệu", () => {
    expect(hasNumericData("[1] Doanh thu 2021 là 120 tỷ, 2022 là 150 tỷ, 2023 là 180 tỷ, tăng 20%.")).toBe(true);
    expect(hasNumericData("[1] Đây là đoạn văn bản thuần không có số liệu nào đáng kể.")).toBe(false);
  });
});
