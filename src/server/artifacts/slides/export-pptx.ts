import "server-only";
import PptxGenJS from "pptxgenjs";
import { t, type Locale } from "@/lib/i18n";
import { parseDataUrl, probeImage } from "./image-util";
import { inch, layoutSlide, pt, type SlideElement, type TextStyle } from "./layouts";
import { buildSourceSlides } from "./sources";
import { fontOf, noHash } from "./themes";
import type { Slide, SlideDeckContent, SlideTheme } from "./types";

export type ExportPptxOptions = {
  /** Đọc byte ảnh theo `image.fileId` (framework lấy từ storage). */
  resolveImage?: (fileId: string) => Promise<Buffer | null>;
  locale?: Locale;
  title?: string;
};

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

function textOpts(s: TextStyle, face: string, box: { x: number; y: number; w: number; h: number }) {
  return {
    x: inch(box.x),
    y: inch(box.y),
    w: inch(box.w),
    h: inch(box.h),
    fontFace: face,
    fontSize: pt(s.size),
    bold: s.weight >= 600,
    italic: Boolean(s.italic),
    color: noHash(s.color),
    align: s.align,
    valign: s.valign,
    margin: 0,
    fit: "none" as const,
    wrap: true,
    lang: "vi-VN",
    // CSS line-height tính theo cỡ chữ; "đơn" của PowerPoint ≈ 1.2× cỡ chữ.
    lineSpacingMultiple: Math.round((s.lineHeight / 1.2) * 100) / 100,
    ...(s.letterSpacing ? { charSpacing: Math.round(s.letterSpacing * 0.75 * 10) / 10 } : {}),
  };
}

async function loadImage(
  image: Slide["image"] | undefined,
  resolve?: ExportPptxOptions["resolveImage"],
): Promise<{ data: string; width: number; height: number } | null> {
  if (!image) return null;
  let bytes: Buffer | null = null;
  let mime: string | null = null;
  if (image.fileId && resolve) {
    bytes = await resolve(image.fileId);
  }
  if (!bytes && image.dataUrl) {
    const parsed = parseDataUrl(image.dataUrl);
    if (parsed) {
      bytes = parsed.bytes;
      mime = parsed.mime;
    }
  }
  if (!bytes || bytes.length === 0) return null;
  const info = probeImage(bytes);
  mime = info?.mime ?? mime ?? "image/png";
  return { data: `${mime};base64,${bytes.toString("base64")}`, width: info?.width ?? 0, height: info?.height ?? 0 };
}

async function addElement(
  pptx: PptxGenJS,
  slide: PptxSlide,
  el: SlideElement,
  theme: SlideTheme,
  opts: ExportPptxOptions,
): Promise<void> {
  const face = fontOf(theme).face;
  const locale = opts.locale ?? "vi";
  switch (el.type) {
    case "shape": {
      const shapeType =
        el.shape === "ellipse" ? pptx.ShapeType.ellipse : el.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
      slide.addShape(shapeType, {
        x: inch(el.box.x),
        y: inch(el.box.y),
        w: inch(el.box.w),
        h: inch(el.box.h),
        fill: { color: noHash(el.fill), transparency: Math.round((1 - el.opacity) * 100) },
        line: { type: "none" },
        ...(el.shape === "rect" && el.radius ? { rectRadius: inch(el.radius) } : {}),
      });
      return;
    }
    case "text": {
      const txt = el.style.uppercase ? el.text.toUpperCase() : el.text;
      slide.addText(txt, textOpts(el.style, face, el.box));
      return;
    }
    case "bullets": {
      const items = el.items.filter((i) => i.trim());
      const runs = items.map((text, i) => ({
        text,
        options: {
          bullet: { indent: pt(el.indent) },
          breakLine: true,
          paraSpaceAfter: i < items.length - 1 ? pt(el.gap) : 0,
        },
      }));
      slide.addText(runs, textOpts(el.style, face, el.box));
      return;
    }
    case "image": {
      const img = await loadImage(el.image, opts.resolveImage);
      const x = inch(el.box.x);
      const y = inch(el.box.y);
      const w = inch(el.box.w);
      const h = inch(el.box.h);
      if (!img) {
        slide.addShape(el.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
          x,
          y,
          w,
          h,
          fill: { color: noHash(el.fill) },
          line: { type: "none" },
          ...(el.radius ? { rectRadius: inch(el.radius) } : {}),
        });
        return;
      }
      const altText = el.image?.caption || el.image?.prompt || "";
      if (img.width > 0 && img.height > 0) {
        // Ảnh được đặt theo kích thước thật (chỉ tỉ lệ quan trọng) rồi cắt "cover" vào khung.
        slide.addImage({ data: img.data, x, y, w: img.width / 96, h: img.height / 96, sizing: { type: "cover", w, h }, altText });
      } else {
        slide.addImage({ data: img.data, x, y, w, h, altText });
      }
      return;
    }
    case "chart": {
      const c = el.chart;
      if (c.labels.length === 0 || c.series.length === 0) return;
      const pad = (vals: number[]) => c.labels.map((_, i) => (Number.isFinite(vals[i]) ? vals[i] : 0));
      const type = c.type === "line" ? pptx.ChartType.line : c.type === "pie" ? pptx.ChartType.pie : pptx.ChartType.bar;
      const series = c.type === "pie" ? [c.series[0]] : c.series;
      const data = series.map((s) => ({ name: s.name || " ", labels: c.labels, values: pad(s.values) }));
      const fs = el.fontSize - 2;
      slide.addChart(type, data, {
        x: inch(el.box.x),
        y: inch(el.box.y),
        w: inch(el.box.w),
        h: inch(el.box.h),
        chartColors: (c.type === "pie" ? c.labels.map((_, i) => el.colors[i % el.colors.length]) : series.map((_, i) => el.colors[i % el.colors.length])).map(noHash),
        barDir: "col",
        barGrouping: "clustered",
        showLegend: c.type === "pie" || series.length > 1,
        legendPos: c.type === "pie" ? "r" : "t",
        legendFontFace: face,
        legendFontSize: pt(el.fontSize),
        legendColor: noHash(el.textColor),
        catAxisLabelFontFace: face,
        catAxisLabelFontSize: pt(fs),
        catAxisLabelColor: noHash(el.textColor),
        valAxisLabelFontFace: face,
        valAxisLabelFontSize: pt(fs),
        valAxisLabelColor: noHash(el.textColor),
        valGridLine: { color: noHash(el.gridColor), size: 0.75 },
        catGridLine: { style: "none" },
        showValue: c.type === "bar" ? c.labels.length * series.length <= 14 : c.type === "line" ? series.length === 1 && c.labels.length <= 12 : false,
        showPercent: c.type === "pie",
        dataLabelFontFace: face,
        dataLabelFontSize: pt(fs),
        dataLabelColor: c.type === "pie" ? "FFFFFF" : noHash(el.textColor),
        dataLabelFontBold: true,
        ...(c.type === "line" ? { lineSize: 3, lineDataSymbolSize: 8 } : {}),
        ...(c.type === "pie" ? { dataLabelPosition: "ctr" as const } : { dataLabelPosition: c.type === "bar" ? ("outEnd" as const) : ("t" as const) }),
      });
      return;
    }
    case "table": {
      const border = { type: "solid" as const, color: noHash(el.borderColor), pt: 0.75 };
      const cell = (text: string, header: boolean, zebra: boolean) => ({
        text,
        options: {
          fontFace: face,
          fontSize: pt(el.fontSize),
          bold: header,
          color: noHash(header ? el.headerColor : el.textColor),
          fill: { color: noHash(header ? el.headerFill : zebra ? el.zebraFill : "#ffffff") },
          valign: "middle" as const,
          align: "left" as const,
          border,
          // Với bảng, pptxgenjs tính margin theo inch.
          margin: [0, inch(14), 0, inch(14)] as [number, number, number, number],
        },
      });
      const rows = [
        el.headers.map((h) => cell(h, true, false)),
        ...el.rows.map((r, ri) => el.headers.map((_, c) => cell(r[c] ?? "", false, ri % 2 === 1))),
      ];
      slide.addTable(rows, {
        x: inch(el.box.x),
        y: inch(el.box.y),
        w: inch(el.box.w),
        colW: el.colW.map(inch),
        rowH: el.rowH.map(inch),
        autoPage: false,
      });
      return;
    }
    case "slideNumber": {
      slide.slideNumber = {
        x: inch(el.box.x),
        y: inch(el.box.y),
        w: inch(el.box.w),
        h: inch(el.box.h),
        fontFace: face,
        fontSize: pt(el.style.size),
        color: noHash(el.style.color),
        align: "right",
        valign: "middle",
        margin: 0,
      };
      return;
    }
    case "citations": {
      const label = t("slides.citations.label", undefined, locale);
      slide.addText(`${label} ${el.numbers.map((n) => `[${n}]`).join(" ")}`, textOpts(el.style, face, el.box));
      return;
    }
  }
}

/**
 * Xuất PPTX với đối tượng gốc: hộp chữ, bullet thật, biểu đồ/bảng native, ghi chú diễn giả, số trang.
 * Mỗi slide của `content.slides` là một slide; nếu có trích dẫn, thêm slide "Nguồn" ở cuối.
 */
export async function exportSlideDeckPptx(content: SlideDeckContent, opts: ExportPptxOptions = {}): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in = 1280 × 720 px @96dpi
  pptx.title = opts.title ?? content.slides[0]?.title ?? "Slides";
  pptx.company = "KBM Notebook";

  const slides = [...content.slides, ...buildSourceSlides(content, opts.locale)];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const render = layoutSlide(s, content.theme, { index: i, total: slides.length });
    const ps = pptx.addSlide();
    ps.background = { color: noHash(render.background) };
    for (const el of render.elements) await addElement(pptx, ps, el, content.theme, opts);
    if (s.notes?.trim()) ps.addNotes(s.notes.trim());
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof ArrayBuffer) return Buffer.from(out);
  if (out instanceof Uint8Array) return Buffer.from(out);
  throw new Error("pptxgenjs không trả về dữ liệu nhị phân");
}
