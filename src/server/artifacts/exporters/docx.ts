import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import { marked, type Token, type Tokens } from "marked";

const FONT = "Calibri";
const MONO = "Consolas";
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

type RunStyle = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean };

/** Chuyển token inline của marked thành các run/hyperlink của docx. */
function inlineRuns(tokens: Token[] | undefined, style: RunStyle = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case "text": {
        const tt = tok as Tokens.Text;
        if (tt.tokens?.length) out.push(...inlineRuns(tt.tokens, style));
        else out.push(run(tt.text, style));
        break;
      }
      case "escape":
        out.push(run((tok as Tokens.Escape).text, style));
        break;
      case "strong":
        out.push(...inlineRuns((tok as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineRuns((tok as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "del":
        out.push(...inlineRuns((tok as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case "codespan":
        out.push(run((tok as Tokens.Codespan).text, { ...style, code: true }));
        break;
      case "br":
        out.push(new TextRun({ break: 1 }));
        break;
      case "link": {
        const l = tok as Tokens.Link;
        const href = safeHref(l.href);
        if (href) out.push(new ExternalHyperlink({ link: href, children: linkRuns(l.tokens, style) }));
        else out.push(...inlineRuns(l.tokens, style));
        break;
      }
      case "image":
        out.push(run((tok as Tokens.Image).text || "", style));
        break;
      case "checkbox":
        out.push(run((tok as Tokens.Checkbox).checked ? "☑ " : "☐ ", style));
        break;
      default: {
        // html inline và token lạ: giữ nguyên dạng văn bản (không bao giờ chèn HTML).
        const raw = (tok as { raw?: string; text?: string }).text ?? (tok as { raw?: string }).raw ?? "";
        if (raw) out.push(run(raw, style));
      }
    }
  }
  return out;
}

function linkRuns(tokens: Token[] | undefined, style: RunStyle): TextRun[] {
  const text = (tokens ?? []).map((t) => (t as { text?: string }).text ?? "").join("");
  return [new TextRun({ text, style: "Hyperlink", font: FONT, bold: style.bold, italics: style.italics })];
}

function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function run(text: string, style: RunStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? MONO : FONT,
    ...(style.code ? { shading: { type: ShadingType.CLEAR, fill: "F1F3F5", color: "auto" } } : {}),
  });
}

type Ctx = { orderedRefs: string[]; };

type BlockOut = Paragraph | Table;

function blocks(tokens: Token[], ctx: Ctx, level = 0): BlockOut[] {
  const out: BlockOut[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case "heading": {
        const h = tok as Tokens.Heading;
        out.push(new Paragraph({ heading: HEADINGS[Math.min(h.depth, 6) - 1], children: inlineRuns(h.tokens), spacing: { before: 240, after: 120 } }));
        break;
      }
      case "paragraph": {
        out.push(new Paragraph({ children: inlineRuns((tok as Tokens.Paragraph).tokens), spacing: { after: 120 } }));
        break;
      }
      case "text": {
        const tt = tok as Tokens.Text;
        out.push(new Paragraph({ children: tt.tokens?.length ? inlineRuns(tt.tokens) : [run(tt.text, {})], spacing: { after: 120 } }));
        break;
      }
      case "list": {
        out.push(...listBlocks(tok as Tokens.List, ctx, level));
        break;
      }
      case "blockquote": {
        out.push(...quoteBlocks((tok as Tokens.Blockquote).tokens));
        break;
      }
      case "code": {
        const c = tok as Tokens.Code;
        const lines = c.text.split("\n");
        lines.forEach((line, i) =>
          out.push(
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: MONO, size: 20 })],
              shading: { type: ShadingType.CLEAR, fill: "F1F3F5", color: "auto" },
              spacing: { after: i === lines.length - 1 ? 160 : 0 },
            }),
          ),
        );
        break;
      }
      case "table": {
        out.push(tableBlock(tok as Tokens.Table), new Paragraph({ children: [], spacing: { after: 120 } }));
        break;
      }
      case "hr":
        out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "C5CCD3", space: 1 } }, spacing: { after: 160 } }));
        break;
      case "html": {
        const raw = (tok as Tokens.HTML).text.trim();
        if (raw) out.push(new Paragraph({ children: [run(raw, {})] }));
        break;
      }
      default:
        break; // space, def...
    }
  }
  return out;
}

function quoteBlocks(tokens: Token[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const tok of tokens) {
    const inline = tok.type === "paragraph" || tok.type === "text" ? ((tok as Tokens.Paragraph).tokens ?? []) : null;
    if (inline) {
      out.push(
        new Paragraph({
          children: inlineRuns(inline, { italics: true }),
          indent: { left: 540 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: "9AA5B1", space: 8 } },
          spacing: { after: 120 },
        }),
      );
    }
  }
  return out;
}

function listBlocks(list: Tokens.List, ctx: Ctx, level: number): BlockOut[] {
  const out: BlockOut[] = [];
  let reference: string | undefined;
  if (list.ordered) {
    reference = `ol-${ctx.orderedRefs.length}`;
    ctx.orderedRefs.push(reference);
  }
  const lvl = Math.min(level, 4);
  for (const item of list.items) {
    const inline: Token[] = [];
    const nested: Token[] = [];
    for (const tok of item.tokens) {
      if (tok.type === "list") nested.push(tok);
      else if (tok.type === "text" || tok.type === "paragraph") inline.push(...(((tok as Tokens.Text).tokens as Token[] | undefined) ?? [tok]));
      else if (tok.type === "checkbox") inline.push(tok);
      else nested.push(tok);
    }
    out.push(
      new Paragraph({
        children: inlineRuns(inline),
        ...(reference ? { numbering: { reference, level: lvl } } : { bullet: { level: lvl } }),
        spacing: { after: 60 },
      }),
    );
    if (nested.length) {
      for (const n of nested) {
        if (n.type === "list") out.push(...listBlocks(n as Tokens.List, ctx, level + 1));
        else out.push(...blocks([n], ctx, level + 1));
      }
    }
  }
  return out;
}

function tableBlock(tbl: Tokens.Table): Table {
  const cols = tbl.header.length || 1;
  const border = { style: BorderStyle.SINGLE, size: 4, color: "C5CCD3" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (c: Tokens.TableCell, header: boolean, align: "left" | "right" | "center" | null) =>
    new TableCell({
      children: [
        new Paragraph({
          children: inlineRuns(c.tokens, header ? { bold: true } : {}),
          alignment: align === "center" ? AlignmentType.CENTER : align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
        }),
      ],
      borders,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      ...(header ? { shading: { type: ShadingType.CLEAR, fill: "EEF1F5", color: "auto" } } : {}),
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: cols }, () => Math.floor(9000 / cols)),
    rows: [
      new TableRow({ tableHeader: true, children: tbl.header.map((c, i) => cell(c, true, tbl.align[i] ?? null)) }),
      ...tbl.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, false, tbl.align[i] ?? null)) })),
    ],
  });
}

/** Markdown → DOCX (tiêu đề, đoạn, danh sách bullet/số, bảng, in đậm/nghiêng, code, trích dẫn, liên kết). */
export async function markdownToDocx(markdown: string, meta: { title: string; creator?: string }): Promise<Buffer> {
  const tokens = marked.lexer(markdown, { gfm: true });
  const ctx: Ctx = { orderedRefs: [] };
  const children = blocks(tokens, ctx);
  const doc = new Document({
    creator: meta.creator ?? "KBM Notebook",
    title: meta.title,
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 36, bold: true, color: "1F2A44" } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 30, bold: true, color: "1F2A44" } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 26, bold: true, color: "1F2A44" } },
      ],
      characterStyles: [{ id: "Hyperlink", name: "Hyperlink", run: { color: "1D4ED8", underline: { type: "single" } } }],
    },
    numbering: {
      config: ctx.orderedRefs.map((reference) => ({
        reference,
        levels: Array.from({ length: 5 }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 540 + level * 360, hanging: 360 } } },
        })),
      })),
    },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
  return Packer.toBuffer(doc);
}
