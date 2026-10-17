import { fontOf, paletteOf, type PaletteTokens } from "./themes";
import type { Slide, SlideChart, SlideLayout, SlideTheme } from "./types";

/**
 * NGUỒN SỰ THẬT DUY NHẤT cho hình học slide (không gian 1280×720 px).
 * `layoutSlide()` trả về danh sách phần tử đã có toạ độ, cỡ chữ, màu; ba nơi tiêu thụ:
 *  - `SlideView` (React/CSS) — editor, thumbnail, trình chiếu;
 *  - `renderSlideDeckHtml` (HTML in/PDF);
 *  - `exportSlideDeckPptx` (PowerPoint, inch = px / 96).
 * Mọi quyết định bố cục (cỡ chữ tự co, chiều cao hàng bảng…) nằm ở đây để ba đầu ra khớp nhau.
 */

export const SLIDE_W = 1280;
export const SLIDE_H = 720;
export const PX_PER_INCH = 96;

export type Box = { x: number; y: number; w: number; h: number };

export type TextStyle = {
  size: number;
  weight: 400 | 500 | 600 | 700;
  color: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  lineHeight: number;
  italic?: boolean;
  uppercase?: boolean;
  /** px */
  letterSpacing?: number;
};

export type ShapeElement = {
  type: "shape";
  key: string;
  shape: "rect" | "ellipse";
  box: Box;
  fill: string;
  /** 0–1 */
  opacity: number;
  /** px, chỉ cho rect */
  radius?: number;
};

export type TextElement = {
  type: "text";
  key: string;
  box: Box;
  text: string;
  style: TextStyle;
  /** Đường dẫn trường trong Slide, ví dụ "title", "columns.0.heading". Không có = chỉ đọc. */
  field?: string;
  /** Khoá i18n của gợi ý khi rỗng (chỉ ở chế độ sửa). */
  placeholder?: string;
};

export type BulletsElement = {
  type: "bullets";
  key: string;
  box: Box;
  items: string[];
  style: TextStyle;
  /** Đường dẫn mảng bullets, ví dụ "bullets" hoặc "columns.1.bullets". */
  field: string;
  /** Khoảng cách giữa các đoạn (px). */
  gap: number;
  /** Thụt lề treo của ký hiệu đầu dòng (px). */
  indent: number;
  placeholder?: string;
};

export type ImageElement = {
  type: "image";
  key: string;
  box: Box;
  image?: Slide["image"];
  radius: number;
  /** Màu nền khi chưa có ảnh. */
  fill: string;
};

export type ChartElement = {
  type: "chart";
  key: string;
  box: Box;
  chart: SlideChart;
  colors: string[];
  textColor: string;
  gridColor: string;
  fontSize: number;
};

export type TableElement = {
  type: "table";
  key: string;
  box: Box;
  headers: string[];
  rows: string[][];
  /** Chiều rộng cột (px), tổng = box.w. */
  colW: number[];
  /** Chiều cao hàng (px): phần tử đầu là hàng tiêu đề. */
  rowH: number[];
  fontSize: number;
  headerFill: string;
  headerColor: string;
  textColor: string;
  zebraFill: string;
  borderColor: string;
};

export type SlideNumberElement = { type: "slideNumber"; key: string; box: Box; style: TextStyle };
export type CitationsElement = { type: "citations"; key: string; box: Box; numbers: number[]; style: TextStyle };

export type SlideElement =
  | ShapeElement
  | TextElement
  | BulletsElement
  | ImageElement
  | ChartElement
  | TableElement
  | SlideNumberElement
  | CitationsElement;

export type SlideRender = { background: string; dark: boolean; elements: SlideElement[] };

export type LayoutOptions = {
  index?: number;
  total?: number;
  /** Chế độ sửa: giữ cả phần tử rỗng (kèm gợi ý) để người dùng điền. */
  edit?: boolean;
};

// ------------------------------------------------------------------ đo chữ

/** Số dòng sau khi ngắt từ tham lam, ước lượng theo bề rộng ký tự trung bình. */
export function countLines(text: string, size: number, maxW: number, charWidth: number, bold = false): number {
  const cw = size * charWidth * (bold ? 1.05 : 1);
  const space = cw * 0.55;
  let lines = 0;
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let cur = 0;
    let l = 1;
    for (const w of words) {
      let ww = [...w].length * cw;
      if (cur === 0) {
        while (ww > maxW) {
          l += 1;
          ww -= maxW;
        }
        cur = ww;
      } else if (cur + space + ww <= maxW) {
        cur += space + ww;
      } else {
        l += 1;
        cur = 0;
        while (ww > maxW) {
          l += 1;
          ww -= maxW;
        }
        cur = ww;
      }
    }
    lines += l;
  }
  return lines;
}

export function fitTextSize(
  text: string,
  box: Box,
  max: number,
  min: number,
  lineHeight: number,
  charWidth: number,
  bold = false,
): number {
  for (let s = max; s >= min; s -= 1) {
    if (countLines(text, s, box.w, charWidth, bold) * s * lineHeight <= box.h) return s;
  }
  return min;
}

export function fitBulletsSize(
  items: string[],
  box: Box,
  indent: number,
  max: number,
  min: number,
  lineHeight: number,
  gapRatio: number,
  charWidth: number,
): number {
  const w = box.w - indent;
  for (let s = max; s >= min; s -= 1) {
    let h = 0;
    items.forEach((it, i) => {
      h += countLines(it, s, w, charWidth) * s * lineHeight + (i > 0 ? s * gapRatio : 0);
    });
    if (h <= box.h) return s;
  }
  return min;
}

// ------------------------------------------------------------------ helpers dựng phần tử

const FOOTER_Y = 672;
const MARGIN_X = 80;
const CONTENT_W = SLIDE_W - MARGIN_X * 2;

function style(partial: Partial<TextStyle> & Pick<TextStyle, "size" | "color">): TextStyle {
  return { weight: 400, align: "left", valign: "top", lineHeight: 1.25, ...partial };
}

function isDarkLayout(layout: SlideLayout): boolean {
  return layout === "title" || layout === "closing";
}

export function slideBackground(layout: SlideLayout, p: PaletteTokens): string {
  if (isDarkLayout(layout)) return p.dark;
  if (layout === "section") return p.primary;
  if (layout === "quote") return p.soft;
  return "#ffffff";
}

function footer(slide: Slide, p: PaletteTokens, opts: LayoutOptions, dark: boolean): SlideElement[] {
  const out: SlideElement[] = [];
  const onDark = dark || slide.layout === "section";
  const muted = onDark ? p.accent : p.muted;
  if (!onDark && slide.layout !== "quote") {
    out.push({ type: "shape", key: "footer-rule", shape: "rect", box: { x: MARGIN_X, y: FOOTER_Y - 10, w: CONTENT_W, h: 1 }, fill: p.line, opacity: 1 });
  }
  const nums = (slide.citations ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length > 0) {
    out.push({
      type: "citations",
      key: "citations",
      box: { x: MARGIN_X, y: FOOTER_Y, w: 860, h: 28 },
      numbers: nums,
      style: style({ size: 13, color: muted, valign: "middle", weight: 500 }),
    });
  }
  if (slide.layout !== "title" && opts.index != null) {
    out.push({
      type: "slideNumber",
      key: "slide-number",
      box: { x: SLIDE_W - MARGIN_X - 120, y: FOOTER_Y, w: 120, h: 28 },
      style: style({ size: 14, color: muted, align: "right", valign: "middle", weight: 500 }),
    });
  }
  return out;
}

type HeaderResult = { elements: SlideElement[]; bodyTop: number };

/** Tiêu đề + phụ đề cho các layout nội dung (nền sáng). */
function contentHeader(slide: Slide, p: PaletteTokens, cw: number, edit: boolean): HeaderResult {
  const els: SlideElement[] = [];
  els.push({ type: "shape", key: "accent-bar", shape: "rect", box: { x: MARGIN_X, y: 48, w: 56, h: 6 }, fill: p.primary, opacity: 1, radius: 3 });
  const titleBox: Box = { x: MARGIN_X, y: 66, w: CONTENT_W, h: 96 };
  const titleSize = fitTextSize(slide.title, titleBox, 40, 26, 1.15, cw, true);
  els.push({
    type: "text",
    key: "title",
    box: titleBox,
    text: slide.title,
    style: style({ size: titleSize, weight: 700, color: p.heading, lineHeight: 1.15, valign: "top" }),
    field: "title",
    placeholder: "slides.placeholder.title",
  });
  let bodyTop = 192;
  if (slide.subtitle || edit) {
    els.push({
      type: "text",
      key: "subtitle",
      box: { x: MARGIN_X, y: 160, w: CONTENT_W, h: 30 },
      text: slide.subtitle ?? "",
      style: style({ size: 20, color: p.muted, lineHeight: 1.25 }),
      field: "subtitle",
      placeholder: "slides.placeholder.subtitle",
    });
    bodyTop = slide.subtitle ? 214 : 192;
  }
  return { elements: els, bodyTop };
}

/** Chiều cao thực tế của danh sách bullet ở cỡ chữ `size` (để co khung thẻ cho vừa nội dung). */
function bulletsHeight(el: BulletsElement, cw: number): number {
  const w = el.box.w - el.indent;
  let h = 0;
  el.items.forEach((it, i) => {
    h += countLines(it, el.style.size, w, cw) * el.style.size * el.style.lineHeight + (i > 0 ? el.gap : 0);
  });
  return h;
}

function bulletsElement(
  key: string,
  field: string,
  items: string[],
  box: Box,
  color: string,
  cw: number,
  edit: boolean,
  max = 32,
  min = 16,
): BulletsElement {
  const indent = 32;
  const lineHeight = 1.3;
  const gapRatio = 0.7;
  const size = fitBulletsSize(items, box, indent, max, min, lineHeight, gapRatio, cw);
  return {
    type: "bullets",
    key,
    box,
    items,
    style: style({ size, color, lineHeight }),
    field,
    gap: Math.round(size * gapRatio),
    indent,
    placeholder: edit ? "slides.placeholder.bullet" : undefined,
  };
}

function columnWeights(headers: string[], rows: string[][], count: number): number[] {
  const w: number[] = [];
  for (let c = 0; c < count; c++) {
    let m = headers[c]?.length ?? 0;
    for (const r of rows) m = Math.max(m, r[c]?.length ?? 0);
    w.push(Math.max(8, Math.min(34, m)));
  }
  return w;
}

function tableElement(slide: Slide, box: Box, p: PaletteTokens, cw: number): TableElement | null {
  const t = slide.table;
  if (!t || t.headers.length === 0) return null;
  const cols = t.headers.length;
  const weights = columnWeights(t.headers, t.rows, cols);
  const sum = weights.reduce((a, b) => a + b, 0);
  const colW = weights.map((x) => Math.floor((x / sum) * box.w));
  colW[cols - 1] += box.w - colW.reduce((a, b) => a + b, 0);
  const padX = 14;
  const padY = 10;
  const lh = 1.25;
  let fontSize = 24;
  let rowH: number[] = [];
  for (; fontSize >= 12; fontSize--) {
    rowH = [t.headers, ...t.rows].map((row, ri) => {
      let lines = 1;
      for (let c = 0; c < cols; c++) lines = Math.max(lines, countLines(row[c] ?? "", fontSize, colW[c] - padX * 2, cw, ri === 0));
      return Math.ceil(lines * fontSize * lh + padY * 2);
    });
    if (rowH.reduce((a, b) => a + b, 0) <= box.h) break;
  }
  // Giãn đều các hàng nếu còn dư chỗ (tối đa +24px mỗi hàng) để bảng không quá dồn.
  const used = rowH.reduce((a, b) => a + b, 0);
  const extra = Math.min(24, Math.floor((box.h - used) / rowH.length));
  if (extra > 0) rowH = rowH.map((h) => h + extra);
  return {
    type: "table",
    key: "table",
    box,
    headers: t.headers,
    rows: t.rows,
    colW,
    rowH,
    fontSize,
    headerFill: p.primary,
    headerColor: "#ffffff",
    textColor: p.ink,
    zebraFill: p.soft,
    borderColor: p.line,
  };
}

// ------------------------------------------------------------------ layout chính

export function layoutSlide(slide: Slide, theme: SlideTheme, opts: LayoutOptions = {}): SlideRender {
  const p = paletteOf(theme);
  const cw = fontOf(theme).charWidth;
  const edit = opts.edit === true;
  const dark = isDarkLayout(slide.layout);
  const background = slideBackground(slide.layout, p);
  const els: SlideElement[] = [];

  switch (slide.layout) {
    case "title": {
      els.push(
        { type: "shape", key: "deco-1", shape: "ellipse", box: { x: 800, y: -170, w: 700, h: 700 }, fill: p.primary, opacity: 0.55 },
        { type: "shape", key: "deco-2", shape: "ellipse", box: { x: 1000, y: 400, w: 420, h: 420 }, fill: p.accent, opacity: 0.16 },
        { type: "shape", key: "accent-bar", shape: "rect", box: { x: 96, y: 216, w: 88, h: 8 }, fill: p.accent, opacity: 1, radius: 4 },
      );
      const titleBox: Box = { x: 96, y: 248, w: 780, h: 230 };
      els.push({
        type: "text",
        key: "title",
        box: titleBox,
        text: slide.title,
        style: style({ size: fitTextSize(slide.title, titleBox, 64, 34, 1.1, cw, true), weight: 700, color: "#ffffff", lineHeight: 1.1 }),
        field: "title",
        placeholder: "slides.placeholder.title",
      });
      if (slide.subtitle || edit) {
        const subBox: Box = { x: 96, y: 500, w: 760, h: 120 };
        els.push({
          type: "text",
          key: "subtitle",
          box: subBox,
          text: slide.subtitle ?? "",
          style: style({ size: fitTextSize(slide.subtitle ?? "", subBox, 28, 18, 1.35, cw), color: p.accent, lineHeight: 1.35 }),
          field: "subtitle",
          placeholder: "slides.placeholder.subtitle",
        });
      }
      break;
    }
    case "section": {
      els.push(
        { type: "shape", key: "deco-1", shape: "ellipse", box: { x: -180, y: 360, w: 560, h: 560 }, fill: "#ffffff", opacity: 0.08 },
        { type: "shape", key: "deco-2", shape: "ellipse", box: { x: 880, y: -220, w: 640, h: 640 }, fill: p.dark, opacity: 0.28 },
      );
      const titleBox: Box = { x: 96, y: 200, w: 1000, h: 250 };
      els.push({
        type: "text",
        key: "title",
        box: titleBox,
        text: slide.title,
        style: style({ size: fitTextSize(slide.title, titleBox, 58, 34, 1.1, cw, true), weight: 700, color: "#ffffff", lineHeight: 1.1, valign: "bottom" }),
        field: "title",
        placeholder: "slides.placeholder.title",
      });
      els.push({ type: "shape", key: "accent-bar", shape: "rect", box: { x: 96, y: 474, w: 88, h: 8 }, fill: "#ffffff", opacity: 0.9, radius: 4 });
      if (slide.subtitle || edit) {
        const subBox: Box = { x: 96, y: 504, w: 900, h: 110 };
        els.push({
          type: "text",
          key: "subtitle",
          box: subBox,
          text: slide.subtitle ?? "",
          style: style({ size: fitTextSize(slide.subtitle ?? "", subBox, 26, 18, 1.35, cw), color: "#ffffff", lineHeight: 1.35 }),
          field: "subtitle",
          placeholder: "slides.placeholder.subtitle",
        });
      }
      break;
    }
    case "closing": {
      els.push(
        { type: "shape", key: "deco-1", shape: "ellipse", box: { x: -200, y: 420, w: 640, h: 640 }, fill: p.primary, opacity: 0.45 },
        { type: "shape", key: "deco-2", shape: "ellipse", box: { x: 1000, y: -160, w: 440, h: 440 }, fill: p.accent, opacity: 0.14 },
      );
      const hasBullets = (slide.bullets?.length ?? 0) > 0 || (edit && slide.bullets !== undefined);
      if (hasBullets) {
        const titleBox: Box = { x: 96, y: 72, w: 1088, h: 110 };
        els.push({
          type: "text",
          key: "title",
          box: titleBox,
          text: slide.title,
          style: style({ size: fitTextSize(slide.title, titleBox, 48, 30, 1.15, cw, true), weight: 700, color: "#ffffff", lineHeight: 1.15, valign: "middle" }),
          field: "title",
          placeholder: "slides.placeholder.title",
        });
        els.push({ type: "shape", key: "accent-bar", shape: "rect", box: { x: 96, y: 196, w: 88, h: 8 }, fill: p.accent, opacity: 1, radius: 4 });
        let top = 236;
        if (slide.subtitle || edit) {
          els.push({
            type: "text",
            key: "subtitle",
            box: { x: 96, y: 224, w: 1088, h: 34 },
            text: slide.subtitle ?? "",
            style: style({ size: 22, color: p.accent }),
            field: "subtitle",
            placeholder: "slides.placeholder.subtitle",
          });
          top = 282;
        }
        els.push(bulletsElement("bullets", "bullets", slide.bullets ?? [], { x: 96, y: top, w: 1088, h: 640 - top }, "#ffffff", cw, edit, 26, 16));
      } else {
        const titleBox: Box = { x: 96, y: 190, w: 1088, h: 200 };
        els.push({
          type: "text",
          key: "title",
          box: titleBox,
          text: slide.title,
          style: style({ size: fitTextSize(slide.title, titleBox, 60, 34, 1.1, cw, true), weight: 700, color: "#ffffff", lineHeight: 1.1, align: "center", valign: "bottom" }),
          field: "title",
          placeholder: "slides.placeholder.title",
        });
        els.push({ type: "shape", key: "accent-bar", shape: "rect", box: { x: 596, y: 414, w: 88, h: 8 }, fill: p.accent, opacity: 1, radius: 4 });
        if (slide.subtitle || edit) {
          const subBox: Box = { x: 200, y: 446, w: 880, h: 130 };
          els.push({
            type: "text",
            key: "subtitle",
            box: subBox,
            text: slide.subtitle ?? "",
            style: style({ size: fitTextSize(slide.subtitle ?? "", subBox, 28, 18, 1.35, cw), color: p.accent, lineHeight: 1.35, align: "center" }),
            field: "subtitle",
            placeholder: "slides.placeholder.subtitle",
          });
        }
      }
      break;
    }
    case "quote": {
      els.push({
        type: "text",
        key: "quote-mark",
        box: { x: 80, y: 96, w: 200, h: 200 },
        text: "“",
        style: style({ size: 220, weight: 700, color: p.line, lineHeight: 1 }),
      });
      els.push({
        type: "text",
        key: "title",
        box: { x: MARGIN_X, y: 52, w: CONTENT_W, h: 36 },
        text: slide.title,
        style: style({ size: 20, weight: 700, color: p.primary, uppercase: true, letterSpacing: 2, lineHeight: 1.2 }),
        field: "title",
        placeholder: "slides.placeholder.title",
      });
      const qText = slide.quote?.text ?? "";
      const qBox: Box = { x: 160, y: 190, w: 960, h: 320 };
      els.push({
        type: "text",
        key: "quote-text",
        box: qBox,
        text: qText,
        style: style({ size: fitTextSize(qText, qBox, 44, 24, 1.3, cw), weight: 500, color: p.heading, lineHeight: 1.3, valign: "middle", italic: true }),
        field: "quote.text",
        placeholder: "slides.placeholder.quote",
      });
      if (slide.quote?.attribution || edit) {
        els.push({
          type: "text",
          key: "quote-attribution",
          box: { x: 160, y: 530, w: 960, h: 44 },
          text: slide.quote?.attribution ?? "",
          style: style({ size: 24, weight: 600, color: p.muted, lineHeight: 1.2 }),
          field: "quote.attribution",
          placeholder: "slides.placeholder.attribution",
        });
      }
      break;
    }
    default: {
      const header = contentHeader(slide, p, cw, edit);
      els.push(...header.elements);
      const top = header.bodyTop;
      const bodyH = 646 - top;
      switch (slide.layout) {
        case "title_bullets": {
          els.push(bulletsElement("bullets", "bullets", slide.bullets ?? [], { x: MARGIN_X, y: top + 8, w: CONTENT_W, h: bodyH - 8 }, p.ink, cw, edit));
          break;
        }
        case "two_column": {
          const cols = slide.columns && slide.columns.length > 0 ? slide.columns.slice(0, 3) : edit ? [{ heading: "", bullets: [] }, { heading: "", bullets: [] }] : [];
          const n = cols.length;
          if (n === 0) break;
          const gap = 32;
          const colW = (CONTENT_W - gap * (n - 1)) / n;
          const bulletEls = cols.map((col, i) => {
            const x = Math.round(MARGIN_X + i * (colW + gap));
            const w = Math.round(colW);
            return bulletsElement(`col${i}-bullets`, `columns.${i}.bullets`, col.bullets, { x: x + 28, y: top + 98, w: w - 56, h: bodyH - 120 }, p.ink, cw, edit, 28, 15);
          });
          // Cùng một cỡ chữ cho mọi cột (lấy cỡ nhỏ nhất) và thẻ co theo nội dung, tối thiểu 300px.
          const colSize = Math.min(...bulletEls.map((b) => b.style.size));
          bulletEls.forEach((b) => {
            b.style = { ...b.style, size: colSize };
            b.gap = Math.round(colSize * 0.7);
          });
          const needed = Math.max(...bulletEls.map((b) => bulletsHeight(b, cw)));
          const cardH = Math.max(300, Math.min(bodyH, Math.round(needed + 98 + 40)));
          cols.forEach((col, i) => {
            const x = Math.round(MARGIN_X + i * (colW + gap));
            const w = Math.round(colW);
            els.push({ type: "shape", key: `col${i}-card`, shape: "rect", box: { x, y: top, w, h: cardH }, fill: p.soft, opacity: 1, radius: 16 });
            const hBox: Box = { x: x + 28, y: top + 22, w: w - 56, h: 44 };
            els.push({
              type: "text",
              key: `col${i}-heading`,
              box: hBox,
              text: col.heading,
              style: style({ size: fitTextSize(col.heading, hBox, 26, 18, 1.15, cw, true), weight: 700, color: p.heading, lineHeight: 1.15, valign: "middle" }),
              field: `columns.${i}.heading`,
              placeholder: "slides.placeholder.heading",
            });
            els.push({ type: "shape", key: `col${i}-rule`, shape: "rect", box: { x: x + 28, y: top + 74, w: 48, h: 4 }, fill: p.primary, opacity: 1, radius: 2 });
            const b = bulletEls[i];
            els.push({ ...b, box: { ...b.box, h: cardH - 120 } });
          });
          break;
        }
        case "image_text": {
          const captionH = slide.image?.caption || edit ? 40 : 0;
          els.push(bulletsElement("bullets", "bullets", slide.bullets ?? [], { x: MARGIN_X, y: top + 8, w: 580, h: bodyH - 8 }, p.ink, cw, edit, 28, 16));
          els.push({
            type: "image",
            key: "image",
            box: { x: 700, y: top, w: 500, h: bodyH - captionH },
            image: slide.image,
            radius: 16,
            fill: p.soft,
          });
          if (captionH) {
            els.push({
              type: "text",
              key: "image-caption",
              box: { x: 700, y: top + bodyH - captionH + 6, w: 500, h: captionH - 6 },
              text: slide.image?.caption ?? "",
              style: style({ size: 14, color: p.muted, italic: true, lineHeight: 1.25 }),
              field: "image.caption",
              placeholder: "slides.placeholder.caption",
            });
          }
          break;
        }
        case "chart": {
          const hasSide = (slide.bullets?.length ?? 0) > 0 || (edit && slide.bullets !== undefined);
          const chartW = hasSide ? 740 : CONTENT_W;
          if (slide.chart) {
            els.push({
              type: "chart",
              key: "chart",
              box: { x: MARGIN_X, y: top, w: chartW, h: bodyH },
              chart: slide.chart,
              colors: p.series,
              textColor: p.ink,
              gridColor: p.line,
              fontSize: 18,
            });
          }
          if (hasSide) {
            const x = MARGIN_X + chartW + 30;
            const w = SLIDE_W - MARGIN_X - x;
            els.push({ type: "shape", key: "side-card", shape: "rect", box: { x, y: top, w, h: bodyH }, fill: p.soft, opacity: 1, radius: 16 });
            els.push(bulletsElement("bullets", "bullets", slide.bullets ?? [], { x: x + 24, y: top + 24, w: w - 48, h: bodyH - 48 }, p.ink, cw, edit, 26, 15));
          }
          break;
        }
        case "table": {
          const tbl = tableElement(slide, { x: MARGIN_X, y: top + 4, w: CONTENT_W, h: bodyH - 4 }, p, cw);
          if (tbl) els.push(tbl);
          break;
        }
        default:
          break;
      }
    }
  }

  els.push(...footer(slide, p, opts, dark));

  // Ở chế độ xuất, bỏ mọi phần tử chữ rỗng (không để lại hộp trống trong PPTX/PDF).
  const elements = edit
    ? els
    : els.filter((e) => {
        if (e.type === "text") return e.text.trim().length > 0;
        if (e.type === "bullets") return e.items.some((i) => i.trim().length > 0);
        return true;
      });
  return { background, dark, elements };
}

/** px → inch (PPTX). */
export const inch = (px: number): number => px / PX_PER_INCH;
/** px → pt (cỡ chữ PPTX; 96dpi → 0.75). */
export const pt = (px: number): number => Math.round(px * 0.75 * 10) / 10;

/** Các khoá phần tử có hình học của một slide — dùng để kiểm tra ba đầu ra khớp nhau. */
export function geometryKeys(slide: Slide, theme: SlideTheme): string[] {
  return layoutSlide(slide, theme, { index: 0, total: 1 }).elements.map((e) => e.key);
}
