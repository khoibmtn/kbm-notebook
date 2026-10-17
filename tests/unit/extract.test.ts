import { describe, expect, it } from "vitest";
import { buildDocument, chunkDocument } from "@/server/knowledge/ingest/chunk";
import {
  extractFile,
  extractHtml,
  extractPastedText,
  htmlToSegments,
  markdownToSegments,
  NO_TEXT_LAYER_MESSAGE,
  sheetRowsToLines,
  slideXmlToText,
} from "@/server/knowledge/ingest/extract";
import { IngestError } from "@/server/knowledge/ingest/errors";
import { makeBlankPdf, makeDocx, makePdf, makePptx, makeXlsx } from "../helpers/docs";

describe("extractFile · PDF", () => {
  it("giữ số trang và văn bản từng trang", async () => {
    const buf = await makePdf([
      "Alpha page one: photosynthesis converts light into chemical energy.",
      "Bravo page two: mitochondria produce ATP through respiration.",
      "Charlie page three: ribosomes translate messenger RNA into proteins.",
    ]);
    const res = await extractFile(buf, "pdf");
    expect(res.pageCount).toBe(3);
    expect(res.unit).toBe("page");
    expect(res.segments.map((s) => s.page)).toEqual([1, 2, 3]);
    expect(res.segments[0].text).toContain("photosynthesis");
    expect(res.segments[1].text).toContain("mitochondria");
    expect(res.segments[2].text).toContain("ribosomes");
    // chunk của trang 2 mang page = 2
    const chunks = chunkDocument(buildDocument(res.segments));
    expect(chunks.find((c) => c.text.includes("mitochondria"))?.page).toBe(2);
  });

  it("PDF không có lớp văn bản → lỗi 'cần OCR' (vĩnh viễn)", async () => {
    const err = await extractFile(await makeBlankPdf(3), "pdf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).message).toBe(NO_TEXT_LAYER_MESSAGE);
    expect((err as IngestError).permanent).toBe(true);
  });

  it("tệp .pdf hỏng → IngestError", async () => {
    await expect(extractFile(Buffer.from("không phải pdf"), "pdf")).rejects.toBeInstanceOf(IngestError);
  });
});

describe("extractFile · DOCX", () => {
  it("tách mục theo heading, giữ văn bản tiếng Việt", async () => {
    const buf = await makeDocx([
      { text: "Lời mở đầu của tài liệu." },
      { heading: "Giới thiệu" },
      { text: "Đây là phần giới thiệu về đạo hàm." },
      { heading: "Kết luận" },
      { text: "Tóm lại, tích phân là phép toán ngược." },
    ]);
    const res = await extractFile(buf, "docx");
    expect(res.segments.map((s) => s.section)).toEqual([undefined, "Giới thiệu", "Kết luận"]);
    expect(res.segments[1].text).toContain("đạo hàm");
    expect(res.segments[2].text).toContain("tích phân");
  });
});

describe("extractFile · PPTX", () => {
  it("mỗi slide một segment với locator.slide và tiêu đề làm section", async () => {
    const buf = await makePptx([
      { title: "Slide one title", bullets: ["first bullet about cells", "second bullet"] },
      { title: "Slide two title", bullets: ["genetics and heredity"] },
      { title: "Slide three title", bullets: ["evolution by natural selection"] },
    ]);
    const res = await extractFile(buf, "pptx");
    expect(res.unit).toBe("slide");
    expect(res.pageCount).toBe(3);
    expect(res.segments.map((s) => s.slide)).toEqual([1, 2, 3]);
    expect(res.segments[1].text).toContain("genetics and heredity");
    expect(res.segments[1].text).toContain("Slide two title");
    expect(res.segments[2].text).toContain("natural selection");
  });

  it("slideXmlToText gom run, xuống dòng và giải mã entity", () => {
    const xml =
      '<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Tiêu &amp; đề</a:t></a:r></a:p></p:txBody></p:sp>' +
      "<p:sp><p:txBody><a:p><a:r><a:t>Dòng A</a:t></a:r><a:br/><a:r><a:t>Dòng B</a:t></a:r></a:p></p:txBody></p:sp></p:sld>";
    expect(slideXmlToText(xml)).toEqual({ title: "Tiêu & đề", text: "Tiêu & đề\nDòng A\nDòng B" });
  });
});

describe("extractFile · XLSX / CSV", () => {
  it("sheet → dòng 'Cột: giá trị' khi có hàng tiêu đề; sheet là locator", async () => {
    const buf = makeXlsx([
      { name: "Điểm", rows: [["Họ tên", "Điểm"], ["Nguyễn An", 9], ["Trần Bình", 7]] },
      { name: "Ghi chú", rows: [["Bảng thứ hai"], ["Không có tiêu đề"]] },
    ]);
    const res = await extractFile(buf, "xlsx");
    expect(res.unit).toBe("sheet");
    expect(res.pageCount).toBe(2);
    expect(res.segments[0]).toMatchObject({ page: 1, section: "Điểm" });
    expect(res.segments[0].text).toBe("Họ tên: Nguyễn An; Điểm: 9\nHọ tên: Trần Bình; Điểm: 7");
    expect(res.segments[1]).toMatchObject({ page: 2, section: "Ghi chú" });
  });

  it("CSV UTF-8 đọc đúng tiếng Việt", async () => {
    const res = await extractFile(Buffer.from("Tên,Môn\nLan,Toán học\nHùng,Vật lý\n", "utf8"), "csv");
    expect(res.segments[0].text).toBe("Tên: Lan; Môn: Toán học\nTên: Hùng; Môn: Vật lý");
  });

  it("sheetRowsToLines: không có header thì nối bằng ' | '", () => {
    expect(sheetRowsToLines([["1", "2"], ["3", "4"]])).toEqual(["1 | 2", "3 | 4"]);
  });
});

describe("extractFile · văn bản", () => {
  it("MD tách theo heading #..###, bỏ qua heading trong khối code", () => {
    const md = "Mở đầu\n\n# Chương 1\nNội dung 1\n\n```\n# không phải heading\n```\n\n## Mục 1.1\nNội dung 1.1\n";
    const segs = markdownToSegments(md);
    expect(segs.map((s) => s.section)).toEqual([undefined, "Chương 1", "Mục 1.1"]);
    expect(segs[1].text).toContain("# không phải heading");
  });

  it("TXT/JSON/UTF-8 BOM, và Windows-1258 dự phòng", async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Tiếng Việt có dấu", "utf8")]);
    expect((await extractFile(bom, "txt")).segments[0].text).toBe("Tiếng Việt có dấu");
    const json = await extractFile(Buffer.from('{"a":1,"b":["x"]}'), "json");
    expect(json.segments[0].text).toContain('"b": [');
    await expect(extractFile(Buffer.from("{hỏng"), "json")).rejects.toBeInstanceOf(IngestError);
  });

  it("nguồn rỗng → IngestError", async () => {
    await expect(extractFile(Buffer.from("   \n  "), "txt")).rejects.toBeInstanceOf(IngestError);
    expect(() => extractPastedText("  ")).toThrow(IngestError);
  });
});

describe("HTML", () => {
  const html = `<!doctype html><html><head><title>Bài viết thử</title><style>.x{color:red}</style></head><body>
    <nav>Menu điều hướng không cần</nav>
    <article><h1>Tiêu đề chính</h1><p>Đoạn một nói về quang hợp &amp; hô hấp của cây xanh. Cây xanh hấp thụ ánh sáng mặt trời để tạo ra năng lượng cho cả hệ sinh thái.</p>
    <h2>Phần hai</h2><p>Đoạn hai dài hơn một chút để Readability nhận ra đây là nội dung chính của trang. Nó cần đủ số lượng ký tự và dấu phẩy, ví dụ như thế này, thế kia, và thế nọ.</p>
    <table><tr><td>Ô A</td><td>Ô B</td></tr></table></article><script>alert(1)</script></body></html>`;

  it("Readability + jsdom: lấy nội dung chính, bỏ script/style, giữ heading làm section", () => {
    const res = extractHtml(html, "https://example.com/bai-viet");
    expect(res.title).toBe("Bài viết thử");
    const all = res.segments.map((s) => s.text).join("\n");
    expect(all).toContain("quang hợp & hô hấp");
    expect(all).not.toContain("alert(1)");
    expect(all).not.toContain("color:red");
    expect(res.segments.some((s) => s.section === "Phần hai")).toBe(true);
  });

  it("htmlToSegments: bảng dùng ' | ', danh sách có gạch đầu dòng", () => {
    const segs = htmlToSegments("<h1>T</h1><ul><li>a</li><li>b</li></ul><table><tr><td>x</td><td>y</td></tr></table>");
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("T\n- a\n- b\nx | y");
  });
});
