import { describe, expect, it } from "vitest";
import { HL_END, HL_START, SLUG_RE, slugify, splitHighlight } from "@/lib/community";
import { globalSearchQuery, slugSchema } from "@/lib/validators/community";
import { buildTsQuery, highlightTitle, makeSnippet, searchTerms } from "@/server/search/snippet";

describe("slugify", () => {
  it("bỏ dấu tiếng Việt, đ → d, chỉ còn a-z0-9 và gạch ngang", () => {
    expect(slugify("Sinh học tế bào 101")).toBe("sinh-hoc-te-bao-101");
    expect(slugify("  Đại học Sư phạm!!  ")).toBe("dai-hoc-su-pham");
    expect(slugify("---")).toBe("");
  });
  it("cắt tối đa 60 ký tự và slug hợp lệ theo SLUG_RE", () => {
    const s = slugify("a".repeat(100));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(SLUG_RE.test(slugify("Ôn thi Toán 12"))).toBe(true);
  });
  it("slugSchema từ chối ký tự lạ / quá ngắn", () => {
    expect(slugSchema.safeParse("ok-slug-1").success).toBe(true);
    expect(slugSchema.safeParse("Sai Dau").success).toBe(false);
    expect(slugSchema.safeParse("ab").success).toBe(false);
    expect(slugSchema.safeParse("-bad").success).toBe(false);
  });
});

describe("snippet & tsquery", () => {
  it("searchTerms tách chữ/số Unicode, bỏ trùng", () => {
    expect(searchTerms("Quang hợp, quang HỢP 3")).toEqual(expect.arrayContaining(["quang", "hợp", "3"]));
    expect(searchTerms("quang hợp quang").length).toBe(2);
  });
  it("buildTsQuery chỉ sinh tiền tố an toàn, không chèn cú pháp tsquery", () => {
    expect(buildTsQuery("ty thể")).toBe("thể:* & ty:*");
    expect(buildTsQuery("a' | b & !c:*")).not.toMatch(/['!|]\s*\w+:\*\s*\|/);
    expect(buildTsQuery("!!! ???")).toBeNull();
  });
  it("makeSnippet đánh dấu từ khớp, cắt quanh lần khớp đầu và loại ký tự đánh dấu có sẵn", () => {
    const text = `${"lorem ipsum ".repeat(30)}ty thể là bào quan ${"dolor ".repeat(40)}`;
    const s = makeSnippet(text, "ty thể")!;
    expect(s.startsWith("…")).toBe(true);
    expect(s).toContain(`${HL_START}ty${HL_END}`);
    expect(s).toContain(`${HL_START}thể${HL_END}`);
    expect(s.length).toBeLessThan(260);
    const injected = makeSnippet(`x ${HL_START}giả${HL_END} ty`, "ty")!;
    expect(injected).toBe(`x giả ${HL_START}ty${HL_END}`);
    expect(makeSnippet("", "x")).toBeNull();
    expect(makeSnippet("không có từ khoá", "zzz")).toBe("không có từ khoá");
  });
  it("highlightTitle + splitHighlight cho ra các đoạn khớp / không khớp, không có HTML", () => {
    const t = highlightTitle("Báo cáo <b>tế bào</b>", "tế bào");
    const parts = splitHighlight(t);
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["tế", "bào"]);
    expect(parts.map((p) => p.text).join("")).toBe("Báo cáo <b>tế bào</b>");
    expect(splitHighlight("chỉ chữ thường")).toEqual([{ text: "chỉ chữ thường", match: false }]);
  });
});

describe("globalSearchQuery", () => {
  it("phân tích types, giới hạn và bắt buộc q", () => {
    const ok = globalSearchQuery.parse({ q: " abc ", types: "notes,sources", limit: "5" });
    expect(ok).toMatchObject({ q: "abc", types: ["notes", "sources"], limit: 5 });
    expect(globalSearchQuery.safeParse({ q: "" }).success).toBe(false);
    expect(globalSearchQuery.safeParse({ q: "a", types: "bogus" }).success).toBe(false);
    expect(globalSearchQuery.parse({ q: "a" }).types).toEqual([]);
  });
});
