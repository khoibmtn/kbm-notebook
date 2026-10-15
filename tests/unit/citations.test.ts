import { describe, expect, it } from "vitest";
import {
  buildSourcesUsed,
  containsNotFoundSentinel,
  findCitations,
  isInsufficientEvidence,
  NOT_FOUND_SENTINEL,
  parseCitationNumbers,
  postCheckAnswer,
  sanitizeCitations,
  stripCitations,
} from "@/server/ai/citations";
import type { Evidence } from "@/server/knowledge/providers/types";

function ev(n: number, over: Partial<Evidence> = {}): Evidence {
  return {
    id: `chunk-${n}`,
    provider: "local",
    sourceId: `src-${n}`,
    sourceTitle: `Nguồn ${n}`,
    locator: { page: n },
    text: `Nội dung đoạn ${n}`,
    score: 0.03,
    similarity: 0.6,
    ...over,
  };
}

describe("parseCitationNumbers", () => {
  it("đọc số đơn, danh sách và khoảng", () => {
    expect(parseCitationNumbers("1")).toEqual([1]);
    expect(parseCitationNumbers("1, 3")).toEqual([1, 3]);
    expect(parseCitationNumbers("2-4")).toEqual([2, 3, 4]);
    expect(parseCitationNumbers("2–4")).toEqual([2, 3, 4]);
    expect(parseCitationNumbers("1,2,5-7")).toEqual([1, 2, 5, 6, 7]);
  });
  it("khử trùng lặp và không mở rộng khoảng ngược/quá lớn", () => {
    expect(parseCitationNumbers("1, 1, 2")).toEqual([1, 2]);
    expect(parseCitationNumbers("5-3")).toEqual([5, 3]);
    expect(parseCitationNumbers("1-5000").length).toBe(2);
  });
});

describe("findCitations", () => {
  it("bỏ qua liên kết markdown, mã và ngoặc không phải số", () => {
    const text = "Xem [1](http://x.com), `[2]`, [ghi chú], [a1] và [3].\n```\n[4]\n```";
    expect(findCitations(text).map((t) => t.raw)).toEqual(["[3]"]);
  });
  it("nhận dạng [1, 3] và [2-4] với khoảng trắng", () => {
    const toks = findCitations("A [1, 3] B [ 2 - 4 ] C [1][2]");
    expect(toks.map((t) => t.numbers)).toEqual([[1, 3], [2, 3, 4], [1], [2]]);
  });
});

describe("sanitizeCitations", () => {
  it("loại [7] không có trong danh sách và [0]", () => {
    const r = sanitizeCitations("Ý một [1]. Ý hai [7]. Ý ba [0].", 3);
    expect(r.text).toBe("Ý một [1]. Ý hai. Ý ba.");
    expect(r.used).toEqual([1]);
    expect(r.removed).toEqual([0, 7]);
  });
  it("giữ phần hợp lệ của danh sách/khoảng", () => {
    const r = sanitizeCitations("A [1, 9] B [2-5] C [8, 9]", 3);
    expect(r.text).toBe("A [1] B [2, 3] C");
    expect(r.used).toEqual([1, 2, 3]);
    expect(r.removed).toEqual([4, 5, 8, 9]);
  });
  it("giữ nguyên văn bản hợp lệ, không đụng mã", () => {
    const text = "Đúng [1][2] và [1, 2]. `x[9]` giữ nguyên.\n```\nconst a = b[9];\n```";
    const r = sanitizeCitations(text, 2);
    expect(r.text).toBe(text);
    expect(r.used).toEqual([1, 2]);
    expect(r.removed).toEqual([]);
  });
  it("không có bằng chứng: loại hết", () => {
    const r = sanitizeCitations("Không có gì [1] [2]", 0);
    expect(r.text).toBe("Không có gì");
    expect(r.used).toEqual([]);
  });
});

describe("stripCitations", () => {
  it("xoá mọi [n] cho lịch sử hội thoại", () => {
    expect(stripCitations("Trả lời [1] có ý [2, 3]. Hết [4-5]")).toBe("Trả lời có ý. Hết");
  });
});

describe("isInsufficientEvidence", () => {
  it("rỗng → thiếu; similarity cao nhất < 0.25 → thiếu; ≥ 0.25 → đủ", () => {
    expect(isInsufficientEvidence([])).toBe(true);
    expect(isInsufficientEvidence([ev(1, { similarity: 0.1 }), ev(2, { similarity: 0.24 })])).toBe(true);
    expect(isInsufficientEvidence([ev(1, { similarity: 0.1 }), ev(2, { similarity: 0.25 })])).toBe(false);
  });
  it("không đoạn trích nào có similarity (chỉ web / kho ngoài) → không đủ cơ sở kết luận thiếu theo ngưỡng", () => {
    expect(isInsufficientEvidence([ev(1, { similarity: undefined })])).toBe(false);
    expect(isInsufficientEvidence([ev(1, { provider: "web", kind: "web", similarity: undefined })])).toBe(false);
  });
  it("M-4: chỉ tính trên đoạn trích có similarity — web / external_answer / đoạn thiếu similarity không làm tắt cảnh báo", () => {
    const weak = ev(1, { similarity: 0.05 });
    expect(isInsufficientEvidence([weak, ev(2, { provider: "web", kind: "web", similarity: undefined })])).toBe(true);
    expect(isInsufficientEvidence([weak, ev(2, { provider: "notebooklm-bridge", kind: "external_answer", similarity: undefined })])).toBe(true);
    expect(isInsufficientEvidence([weak, ev(3, { similarity: undefined })])).toBe(true); // đoạn chỉ khớp từ khoá ngoài top vector
    expect(isInsufficientEvidence([weak, ev(4, { similarity: 0.6 })])).toBe(false);
    // web/external có similarity (bất thường) cũng không được tính
    expect(isInsufficientEvidence([weak, ev(5, { kind: "web", similarity: 0.9 })])).toBe(true);
  });
});

describe("containsNotFoundSentinel", () => {
  it("nhận câu mẫu, không phân biệt hoa thường / khoảng trắng", () => {
    expect(containsNotFoundSentinel(`${NOT_FOUND_SENTINEL}.`)).toBe(true);
    expect(containsNotFoundSentinel("KHÔNG TÌM THẤY thông tin này  trong các nguồn đã chọn!")).toBe(true);
    expect(containsNotFoundSentinel("Có thông tin trong nguồn [1].")).toBe(false);
  });
});

describe("buildSourcesUsed", () => {
  it("khử trùng theo nguồn, gom số và vị trí", () => {
    const evidence = [
      ev(1, { sourceId: "A", sourceTitle: "Giáo trình", locator: { page: 3 } }),
      ev(2, { sourceId: "A", sourceTitle: "Giáo trình", locator: { page: 5 } }),
      ev(3, { sourceId: "B", sourceTitle: "Bài giảng", locator: { slide: 2 } }),
      ev(4, { provider: "web", sourceId: null, sourceTitle: "Wikipedia", locator: { url: "https://vi.wikipedia.org/x" } }),
    ];
    const used = buildSourcesUsed(evidence, [1, 2, 4]);
    expect(used).toHaveLength(2);
    expect(used[0]).toMatchObject({ sourceId: "A", provider: "local", title: "Giáo trình", numbers: [1, 2], locators: ["trang 3", "trang 5"] });
    expect(used[1]).toMatchObject({ sourceId: null, provider: "web", url: "https://vi.wikipedia.org/x", numbers: [4], locators: [] });
  });
});

describe("postCheckAnswer", () => {
  const evidence = [ev(1), ev(2)];
  it("loại [9], tính sourcesUsed từ [n] thực sự dùng", () => {
    const r = postCheckAnswer("Kết quả A [1]. Kết quả B [9].", evidence);
    expect(r.content).toBe("Kết quả A [1]. Kết quả B.");
    expect(r.usedNumbers).toEqual([1]);
    expect(r.removedNumbers).toEqual([9]);
    expect(r.sourcesUsed.map((s) => s.sourceId)).toEqual(["src-1"]);
    expect(r.insufficientEvidence).toBe(false);
    expect(r.citations).toBe(evidence);
  });
  it("gắn insufficientEvidence khi mô hình tự nói không tìm thấy", () => {
    const r = postCheckAnswer(`${NOT_FOUND_SENTINEL}.`, evidence);
    expect(r.insufficientEvidence).toBe(true);
    expect(r.sourcesUsed).toEqual([]);
  });
  it("không có bằng chứng → insufficientEvidence và loại mọi [n]", () => {
    const r = postCheckAnswer("Trả lời bịa [1].", []);
    expect(r.insufficientEvidence).toBe(true);
    expect(r.insufficientReason).toBe("no_evidence");
    expect(r.content).toBe("Trả lời bịa.");
  });
  it("M-4: có bằng chứng nhưng câu trả lời không có [n] hợp lệ nào → insufficientEvidence, lý do no_citations", () => {
    const strong = [ev(1, { similarity: 0.8 }), ev(2, { similarity: 0.7 })];
    const noCite = postCheckAnswer("Theo kiến thức riêng của tôi thì điều này đúng.", strong);
    expect(noCite).toMatchObject({ insufficientEvidence: true, insufficientReason: "no_citations", usedNumbers: [] });
    const onlyInvalid = postCheckAnswer("Điều này đúng [9].", strong);
    expect(onlyInvalid).toMatchObject({ insufficientEvidence: true, insufficientReason: "no_citations" });
    const cited = postCheckAnswer("Điều này đúng [1].", strong);
    expect(cited).toMatchObject({ insufficientEvidence: false, insufficientReason: null });
  });
  it("lý do: not_found / low_similarity / no_evidence; trả lời web không trích dẫn vẫn bị cảnh báo", () => {
    expect(postCheckAnswer(`${NOT_FOUND_SENTINEL}.`, [ev(1, { similarity: 0.9 })]).insufficientReason).toBe("not_found");
    expect(postCheckAnswer("Trả lời [1].", [ev(1, { similarity: 0.1 })]).insufficientReason).toBe("low_similarity");
    const web = [ev(1, { provider: "web", kind: "web", similarity: undefined })];
    expect(postCheckAnswer("Trả lời từ web mà không dẫn nguồn.", web).insufficientReason).toBe("no_citations");
    expect(postCheckAnswer("Trả lời từ web [1].", web).insufficientEvidence).toBe(false);
  });
});
