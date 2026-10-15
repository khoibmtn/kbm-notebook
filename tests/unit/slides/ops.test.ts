import { describe, expect, it } from "vitest";
import {
  addChartRow,
  addChartSeries,
  addTableColumn,
  changeLayout,
  deleteSlide,
  duplicateSlide,
  getAt,
  insertBullet,
  insertSlide,
  moveSlide,
  newSlide,
  removeBullet,
  removeChartRow,
  removeTableRow,
  setAt,
  toggleCitation,
} from "../../../src/server/artifacts/slides/ops";
import { slideSchema } from "../../../src/server/artifacts/slides/types";
import { sampleDeck } from "./fixtures";

describe("ops", () => {
  it("setAt/getAt bất biến, hỗ trợ đường dẫn lồng nhau", () => {
    const deck = sampleDeck();
    const s = deck.slides[4];
    const next = setAt(s, "columns.1.bullets.0", "Mới");
    expect(next.columns?.[1].bullets[0]).toBe("Mới");
    expect(s.columns?.[1].bullets[0]).not.toBe("Mới");
    expect(next.columns?.[0]).toBe(s.columns?.[0]); // nhánh không đổi giữ nguyên tham chiếu
    expect(getAt(next, "columns.1.heading")).toBe("Thách thức");
    expect(setAt({ id: "x" }, "a.b.0", 1)).toEqual({ id: "x", a: { b: [1] } });
  });

  it("thêm/xoá/di chuyển/nhân bản slide giữ id duy nhất, không xoá slide cuối", () => {
    const deck = sampleDeck();
    const added = insertSlide(deck, 1, newSlide("quote"));
    expect(added.slides).toHaveLength(12);
    expect(added.slides[1].layout).toBe("quote");
    expect(slideSchema.safeParse(added.slides[1]).success).toBe(true);
    const moved = moveSlide(deck, 0, 3);
    expect(moved.slides[3].id).toBe(deck.slides[0].id);
    const dup = duplicateSlide(deck, deck.slides[1].id)!;
    expect(dup.content.slides).toHaveLength(12);
    expect(dup.content.slides[2].id).toBe(dup.newId);
    expect(dup.newId).not.toBe(deck.slides[1].id);
    expect(dup.content.slides[2].bullets).toEqual(deck.slides[1].bullets);
    let one = deck;
    while (one.slides.length > 1) one = deleteSlide(one, one.slides[0].id);
    expect(deleteSlide(one, one.slides[0].id).slides).toHaveLength(1);
  });

  it("bullet: Enter tách tại con trỏ, Backspace xoá dòng", () => {
    const s = sampleDeck().slides[1];
    const split = insertBullet(s, "bullets", 0, { before: "Nhu cầu điện", after: "tăng nhanh theo tăng trưởng" });
    expect(split.bullets).toHaveLength(5);
    expect(split.bullets?.[0]).toBe("Nhu cầu điện");
    expect(split.bullets?.[1]).toBe("tăng nhanh theo tăng trưởng");
    expect(removeBullet(split, "bullets", 1).bullets).toHaveLength(4);
    expect(insertBullet(s, "bullets", 3).bullets?.[4]).toBe("");
  });

  it("đổi layout giữ dữ liệu và bổ sung trường còn thiếu", () => {
    const s = sampleDeck().slides[1]; // title_bullets, 4 bullets
    const two = changeLayout(s, "two_column");
    expect(two.columns).toHaveLength(2);
    expect(two.columns?.flatMap((c) => c.bullets)).toEqual(s.bullets);
    expect(changeLayout(two, "title_bullets").bullets).toEqual(s.bullets);
    expect(changeLayout(s, "chart").chart?.series[0].values).toHaveLength(3);
    expect(changeLayout(s, "table").table?.headers).toHaveLength(3);
    expect(changeLayout(s, "quote").quote).toEqual({ text: "" });
    expect(changeLayout(s, "image_text").image).toEqual({ prompt: "" });
    expect(changeLayout(changeLayout(s, "chart"), "title_bullets").chart).toBeDefined(); // không mất dữ liệu
  });

  it("biểu đồ/bảng: thêm xoá hàng cột giữ độ dài đồng nhất", () => {
    const c = sampleDeck().slides[3].chart!;
    const more = addChartSeries(addChartRow(c));
    expect(more.labels).toHaveLength(c.labels.length + 1);
    expect(more.series.every((s) => s.values.length === more.labels.length)).toBe(true);
    expect(removeChartRow(more, 0).labels).toHaveLength(c.labels.length);
    const t = sampleDeck().slides[7].table!;
    const wide = addTableColumn(t);
    expect(wide.rows.every((r) => r.length === wide.headers.length)).toBe(true);
    expect(removeTableRow(t, 0).rows).toHaveLength(t.rows.length - 1);
  });

  it("toggleCitation giữ danh sách sắp xếp, bỏ khoá khi rỗng", () => {
    const s = sampleDeck().slides[1];
    const a = toggleCitation(s, 3, true);
    expect(a.citations).toEqual([1, 3]);
    expect(toggleCitation(toggleCitation(a, 1, false), 3, false).citations).toBeUndefined();
  });
});
