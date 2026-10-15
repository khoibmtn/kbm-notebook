import { describe, expect, it } from "vitest";
import { CitationRemapper, extractMarkdownCitations, splitCitationMarkers } from "@/lib/artifacts/citations";
import type { ArtifactEvidence } from "@/lib/artifacts/content";

const ev = (n: number): ArtifactEvidence => ({
  id: `chunk-${n}`,
  provider: "local",
  sourceId: `src-${n}`,
  sourceTitle: `Nguồn ${n}`,
  locator: { page: n },
  text: `Nội dung ${n}`,
  score: 1 / n,
});
const EVIDENCE = [1, 2, 3, 4, 5].map(ev);

describe("CitationRemapper.markdown", () => {
  it("đánh số lại gọn theo thứ tự xuất hiện đầu tiên và chỉ giữ bằng chứng đã dùng", () => {
    const r = new CitationRemapper(EVIDENCE);
    expect(r.markdown("A [4]. B [2]. C [4].")).toBe("A [1]. B [2]. C [1].");
    expect(r.used.map((e) => e.id)).toEqual(["chunk-4", "chunk-2"]);
  });

  it("loại số không tồn tại (0, quá lớn) và dọn khoảng trắng đứng trước", () => {
    const r = new CitationRemapper(EVIDENCE);
    expect(r.markdown("Có căn cứ [1]. Bịa [9]. Bịa [0], tiếp.")).toBe("Có căn cứ [1]. Bịa. Bịa, tiếp.");
    expect(r.used).toHaveLength(1);
  });

  it("chuẩn hoá danh sách và khoảng: [1, 2] [2-4] [3;5] → các chip riêng, bỏ trùng", () => {
    const r = new CitationRemapper(EVIDENCE);
    expect(r.markdown("x [1, 2] y [2-4] z [3;5]")).toBe("x [1][2] y [2][3][4] z [3][5]");
    expect(r.used.map((e) => e.id)).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"]);
  });

  it("không đụng tới khối code, code inline và liên kết [1](url)", () => {
    const r = new CitationRemapper(EVIDENCE);
    const md = "Dùng `a[3]` hoặc xem [1](https://example.com).\n```js\nconst x = arr[2];\n```\nThật [5].";
    const out = r.markdown(md);
    expect(out).toContain("`a[3]`");
    expect(out).toContain("[1](https://example.com)");
    expect(out).toContain("arr[2]");
    expect(out).toContain("Thật [1].");
    expect(r.used.map((e) => e.id)).toEqual(["chunk-5"]);
  });

  it("citation dính liền chữ vẫn được nhận (câu[1].)", () => {
    const r = new CitationRemapper(EVIDENCE);
    expect(r.markdown("Ý chính[2].")).toBe("Ý chính[1].");
  });
});

describe("CitationRemapper.list", () => {
  it("ánh xạ danh sách, bỏ trùng và số sai; rỗng → undefined", () => {
    const r = new CitationRemapper(EVIDENCE);
    expect(r.list([3, 3, 99, 1])).toEqual([1, 2]);
    expect(r.list([99])).toBeUndefined();
    expect(r.list(undefined)).toBeUndefined();
    expect(r.list([3])).toEqual([1]);
    expect(r.used.map((e) => e.id)).toEqual(["chunk-3", "chunk-1"]);
  });
});

describe("tiện ích", () => {
  it("extractMarkdownCitations trả đúng thứ tự, bỏ qua code", () => {
    expect(extractMarkdownCitations("a [2] b [1, 3]\n```\n[9]\n```\n`[8]`")).toEqual([2, 1, 3]);
  });

  it("splitCitationMarkers tách chip khỏi văn bản", () => {
    expect(splitCitationMarkers("Xin chào [1][2] thế giới")).toEqual([
      { type: "text", value: "Xin chào " },
      { type: "cite", n: 1 },
      { type: "cite", n: 2 },
      { type: "text", value: " thế giới" },
    ]);
  });
});
