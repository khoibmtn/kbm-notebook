import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import type { DataTableContent, FlashcardsContent, MindmapContent, QuizContent } from "@/lib/artifacts/content";
import { buildExport } from "@/server/artifacts/exporters";
import { dataTableToCsv, flashcardsToAnkiTsv, flashcardsToCsv, csvCell, quizToCsv } from "@/server/artifacts/exporters/csv";
import { markdownToDocx } from "@/server/artifacts/exporters/docx";
import { markdownToHtml, renderDocumentHtml } from "@/server/artifacts/exporters/html";
import { contentToMarkdown } from "@/server/artifacts/exporters/markdown";
import { renderMindmap } from "@/server/artifacts/exporters/mindmap-render";
import { docxToPdfLibreOffice, markdownToPdfChromium } from "@/server/artifacts/exporters/pdf";

const EVIDENCE = [
  { id: "c1", provider: "local" as const, sourceId: "s1", sourceTitle: "Giáo trình sinh học", locator: { page: 12 }, text: "…", score: 1 },
  { id: "c2", provider: "local" as const, sourceId: "s2", sourceTitle: "Bài giảng ty thể", locator: { slide: 3 }, text: "…", score: 0.5 },
];

const MARKDOWN = `# Báo cáo tế bào

Đoạn mở đầu có **chữ đậm**, *chữ nghiêng*, \`code\` và [liên kết](https://example.com) [1].

## Danh sách

- Mục một [1]
- Mục hai
  - Mục con [2]

1. Bước một
2. Bước hai

Danh sách số thứ hai:

1. Khác
2. Khác nữa

| Bào quan | Chức năng |
|---|---|
| Ty thể | Tạo ATP |
| Ribosome | Tổng hợp protein |

> Trích dẫn quan trọng

\`\`\`js
const x = 1 < 2;
\`\`\`
`;

async function docxText(buf: Buffer) {
  return (await mammoth.extractRawText({ buffer: buf })).value;
}

describe("markdown → DOCX", () => {
  it("tạo zip OOXML hợp lệ, mammoth đọc lại được tiêu đề, danh sách, bảng, định dạng", async () => {
    const buf = await markdownToDocx(MARKDOWN, { title: "Báo cáo tế bào" });
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toContain("word/document.xml");
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("w:numPr"); // danh sách thật, không phải gạch đầu dòng gõ tay

    const html = (await mammoth.convertToHtml({ buffer: buf })).value;
    expect(html).toContain("<h1>Báo cáo tế bào</h1>");
    expect(html).toContain("<h2>Danh sách</h2>");
    expect(html).toContain("<strong>chữ đậm</strong>");
    expect(html).toContain("<em>chữ nghiêng</em>");
    expect(html).toContain('<a href="https://example.com/">liên kết</a>');
    expect(html).toMatch(/<ul>[\s\S]*Mục một[\s\S]*<\/ul>/);
    expect(html).toMatch(/<ol>[\s\S]*Bước một[\s\S]*<\/ol>/);
    expect(html).toContain("<table>");
    expect(html).toContain("Tổng hợp protein");
    const text = await docxText(buf);
    expect(text).toContain("const x = 1 < 2;");
    expect(text).toContain("Trích dẫn quan trọng");
  });

  it("hai danh sách số liên tiếp đánh số lại từ 1 (mỗi danh sách một numbering riêng)", async () => {
    const buf = await markdownToDocx("1. A\n2. B\n\nĐoạn\n\n1. C\n2. D\n", { title: "t" });
    const xml = await (await JSZip.loadAsync(buf)).file("word/numbering.xml")!.async("string");
    const nums = xml.match(/<w:num /g) ?? [];
    expect(nums.length).toBeGreaterThanOrEqual(2);
  });

  it("HTML thô và liên kết javascript: không bao giờ thành nội dung hoạt động", async () => {
    const md = 'Xem [bấm vào](javascript:alert(1)) và <script>alert(1)</script>';
    const html = markdownToHtml(md);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
    const buf = await markdownToDocx(md, { title: "x" });
    const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
    expect(xml).not.toContain("javascript:");
  });
});

describe("artifact → markdown", () => {
  it("báo cáo thêm tiêu đề (nếu thiếu) và mục Nguồn có số trang/slide", () => {
    const md = contentToMarkdown("report", "Tên báo cáo", { markdown: "Nội dung [1][2]", evidence: EVIDENCE });
    expect(md.startsWith("# Tên báo cáo")).toBe(true);
    expect(md).toContain("## Nguồn");
    expect(md).toContain("1. Giáo trình sinh học (trang 12)");
    expect(md).toContain("2. Bài giảng ty thể (slide 3)");
    // không thêm tiêu đề lần hai nếu nội dung đã mở đầu bằng #
    expect(contentToMarkdown("report", "X", { markdown: "# Đã có\n\nA", evidence: [] }).match(/^# /gm)).toHaveLength(1);
  });

  it("quiz → markdown/DOCX có đáp án và giải thích", async () => {
    const quiz: QuizContent = {
      questions: [
        { id: "q1", type: "mcq", stem: "Bào quan nào tạo ATP?", options: [{ key: "A", text: "Ty thể" }, { key: "B", text: "Nhân" }], answer: "A", explanation: "Hô hấp tế bào", citations: [1], difficulty: "easy" },
        { id: "q2", type: "tf", stem: "Quang hợp ở ty thể.", answer: "false", explanation: "Ở lục lạp", difficulty: "medium" },
      ],
      evidence: EVIDENCE,
    };
    const md = contentToMarkdown("quiz", "Kiểm tra", quiz);
    expect(md).toContain("Đáp án:* A");
    expect(md).toContain("Đáp án:* Sai");
    const text = await docxText((await buildExport({ type: "quiz", title: "Kiểm tra", content: quiz }, "docx")).buffer);
    expect(text).toContain("Bào quan nào tạo ATP?");
    expect(text).toContain("Hô hấp tế bào");
  });

  it("mindmap → đề cương lồng nhau", () => {
    const mm: MindmapContent = {
      root: { id: "r", label: "Tế bào", children: [{ id: "a", label: "Bào quan", note: "ghi chú", citations: [1], children: [{ id: "b", label: "Ty thể", children: [] }] }] },
      evidence: EVIDENCE,
    };
    const md = contentToMarkdown("mindmap", "x", mm);
    expect(md).toContain("# Tế bào");
    expect(md).toContain("- Bào quan — ghi chú [1]");
    expect(md).toContain("  - Ty thể");
  });
});

describe("CSV / Anki / JSON", () => {
  const table: DataTableContent = {
    columns: [{ key: "ten", label: "Tên" }, { key: "mo_ta", label: "Mô tả" }],
    rows: [
      { cells: { ten: "Ty thể", mo_ta: 'Có "dấu nháy", dấu phẩy\nvà xuống dòng' } },
      { cells: { ten: "=HYPERLINK(\"http://x\")", mo_ta: "+cmd" } },
    ],
    evidence: [],
  };

  it("CSV: BOM, escape RFC 4180, chống công thức (CSV injection)", () => {
    const csv = dataTableToCsv(table);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Có ""dấu nháy"", dấu phẩy\nvà xuống dòng"');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
    expect(csvCell("bình thường")).toBe("bình thường");
    // Đọc lại bằng bộ tách đơn giản có hỗ trợ nháy kép
    const rows = csv.replace("﻿", "").trim().split("\r\n");
    expect(rows[0]).toBe("Tên,Mô tả");
  });

  it("quiz CSV có cột A–E, đáp án, độ khó, trích dẫn", () => {
    const csv = quizToCsv({
      questions: [{ id: "q", type: "mcq", stem: "Hỏi?", options: [{ key: "A", text: "a1" }, { key: "B", text: "b1" }], answer: "B", explanation: "vì", citations: [1, 2], difficulty: "hard" }],
      evidence: [],
    });
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("STT,Loại,Câu hỏi,A,B,C,D,E,Đáp án,Giải thích,Độ khó,Trích dẫn");
    expect(lines[1]).toBe("1,mcq,Hỏi?,a1,b1,,,,B,vì,hard,[1][2]");
  });

  it("flashcards: CSV và Anki TSV `front\\tback\\ttags` (HTML escape, tab/xuống dòng an toàn)", () => {
    const cards: FlashcardsContent = {
      cards: [
        { id: "1", front: "Ty thể\ttab?", back: "Dòng 1\nDòng 2 <b>", hint: "gợi ý", tags: ["sinh học", "tế bào"] },
        { id: "2", front: "Ribosome?", back: "Protein" },
      ],
      evidence: [],
    };
    expect(flashcardsToCsv(cards)).toContain("Ty thể\ttab?");
    const tsv = flashcardsToAnkiTsv(cards);
    const lines = tsv.split("\n");
    expect(lines.slice(0, 3)).toEqual(["#separator:tab", "#html:true", "#tags column:3"]);
    const first = lines[3].split("\t");
    expect(first).toHaveLength(3);
    expect(first[0]).toBe("Ty thể tab?");
    expect(first[1]).toBe("Dòng 1<br>Dòng 2 &lt;b&gt;<br><i>gợi ý</i>");
    expect(first[2]).toBe("sinh_học tế_bào");
    expect(lines[4].split("\t")).toEqual(["Ribosome?", "Protein", ""]);
  });

  it("JSON: bọc type/title/version/content", async () => {
    const out = await buildExport({ type: "flashcards", title: "Thẻ", content: { cards: [], evidence: [] }, versionNo: 4 }, "json");
    const parsed = JSON.parse(out.buffer.toString("utf8")) as { type: string; version: number; content: unknown };
    expect(parsed).toMatchObject({ type: "flashcards", version: 4, content: { cards: [], evidence: [] } });
    expect(out.fileName).toBe("Thẻ.json");
    expect(out.mime).toBe("application/json");
  });

  it("định dạng không áp dụng cho loại → 400 unsupported_format", async () => {
    await expect(buildExport({ type: "quiz", title: "x", content: {} }, "svg")).rejects.toMatchObject({ status: 400, code: "unsupported_format" });
    await expect(buildExport({ type: "report", title: "x", content: {} }, "csv")).rejects.toMatchObject({ status: 400 });
    await expect(buildExport({ type: "slide_deck", title: "x", content: {} }, "pptx")).rejects.toMatchObject({ status: 501, code: "not_implemented" });
  });
});

describe("PDF / PNG / SVG (Chromium, LibreOffice)", () => {
  it("PDF bằng Chromium: %PDF, có chữ tiếng Việt trong HTML nguồn", async () => {
    const html = renderDocumentHtml("# Tiêu đề\n\nQuang hợp xảy ra ở lục lạp.", "t");
    expect(html).toContain("Quang hợp xảy ra ở lục lạp.");
    const pdf = await markdownToPdfChromium("# Tiêu đề\n\nQuang hợp xảy ra ở lục lạp.", "t");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2_000);
  }, 60_000);

  it("sơ đồ tư duy: markmap trong Chromium → SVG độc lập + PNG thật", async () => {
    const mm: MindmapContent = {
      root: {
        id: "r",
        label: "Tế bào",
        children: [
          { id: "a", label: "Bào quan", children: [{ id: "a1", label: "Ty thể <script>x</script>", children: [] }, { id: "a2", label: "Ribosome", children: [] }] },
          { id: "b", label: "Màng tế bào", note: "bán thấm", children: [] },
        ],
      },
      evidence: [],
    };
    const svg = await buildExport({ type: "mindmap", title: "Sơ đồ", content: mm }, "svg");
    const text = svg.buffer.toString("utf8");
    expect(text).toContain("<svg");
    expect(text).toContain("Ty thể");
    expect(text).toContain("viewBox");
    expect(text).not.toContain("<script>x</script>");
    expect(svg.mime).toBe("image/svg+xml");

    const png = await buildExport({ type: "mindmap", title: "Sơ đồ", content: mm }, "png");
    expect([...png.buffer.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = await renderMindmap(mm.root, { png: true });
    expect(r.width).toBeGreaterThan(200);
    expect(r.png!.length).toBeGreaterThan(3_000);
  }, 90_000);

  it("dự phòng LibreOffice: DOCX → PDF hợp lệ", async () => {
    const docx = await markdownToDocx(MARKDOWN, { title: "t" });
    const pdf = await docxToPdfLibreOffice(docx, "kiểm tra");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 150_000);
});
