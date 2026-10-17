import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";

/** Bao dòng theo số ký tự (pdf-lib không tự xuống dòng). */
function wrap(text: string, width = 85): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > width) {
        out.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  return out;
}

/** PDF thật có lớp văn bản, mỗi phần tử `pages` là một trang (chỉ ký tự Latin — font chuẩn của PDF). */
export async function makePdf(pages: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = pdf.addPage([595, 842]);
    let y = 800;
    for (const line of wrap(text)) {
      if (line) page.drawText(line, { x: 50, y, size: 11, font });
      y -= 16;
      if (y < 50) break;
    }
  }
  return Buffer.from(await pdf.save());
}

/** PDF các trang trắng (giả lập bản scan, không có lớp văn bản). */
export async function makeBlankPdf(pageCount = 2): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}

export type DocxBlock = { heading?: string; text?: string };

export async function makeDocx(blocks: DocxBlock[]): Promise<Buffer> {
  const children = blocks.map((b) =>
    b.heading
      ? new Paragraph({ text: b.heading, heading: HeadingLevel.HEADING_1 })
      : new Paragraph({ children: [new TextRun(b.text ?? "")] }),
  );
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export async function makePptx(slides: { title: string; bullets: string[] }[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
    slide.addText(s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 1.4, w: 9, h: 4, fontSize: 18 });
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as Buffer);
}

export function makeXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

/** Cái File chuẩn Web để gọi route upload. */
export function makeFile(data: Buffer | string, name: string, type: string): File {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return new File([new Uint8Array(bytes)], name, { type });
}

const DIMENSION = /<dimension ref="[^"]+"\s*\/>/;

/** XLSX nhỏ nhưng khai báo vùng dữ liệu A1:XFD1048576 (sheet_to_json không bảo vệ sẽ lặp ~17 tỷ ô). */
export async function makeMaliciousXlsx(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(makeXlsx([{ name: "S", rows: [["a", "b"], ["1", "2"]] }]));
  const name = "xl/worksheets/sheet1.xml";
  const xml = await zip.file(name)!.async("string");
  if (!DIMENSION.test(xml)) throw new Error("Không tìm thấy <dimension> trong sheet1.xml");
  zip.file(name, xml.replace(DIMENSION, '<dimension ref="A1:XFD1048576"/>'));
  return zip.generateAsync({ type: "nodebuffer" });
}

/** PPTX có slide chứa hàng trăm nghìn thẻ <p:sp><a:p> mở mà không đóng (regex lazy cũ là O(n²)). */
export async function makeMaliciousPptx(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await makePptx([{ title: "T", bullets: ["x"] }]));
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0"?><p:sld>${"<p:sp><a:p>".repeat(400_000)}</p:sld>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
