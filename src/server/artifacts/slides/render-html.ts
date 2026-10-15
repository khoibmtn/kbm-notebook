import { t, type Locale } from "@/lib/i18n";
import { chartSvg, escXml } from "./chart-svg";
import {
  SLIDE_H,
  SLIDE_W,
  layoutSlide,
  type Box,
  type SlideElement,
  type TextStyle,
} from "./layouts";
import { buildSourceSlides } from "./sources";
import { fontOf } from "./themes";
import type { Slide, SlideDeckContent, SlideTheme } from "./types";

export type RenderHtmlOptions = {
  /** Chuyển `image.fileId` thành URL tải được (Chromium phải truy cập được khi in PDF). */
  resolveImageUrl?: (fileId: string) => string;
  /** Thêm slide "Nguồn" khi có trích dẫn (mặc định true, khớp với PPTX). */
  includeSources?: boolean;
  locale?: Locale;
  title?: string;
};

const esc = escXml;

function boxCss(b: Box): string {
  return `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
}

const JUSTIFY = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

function textCss(s: TextStyle): string {
  return [
    `justify-content:${JUSTIFY[s.valign]}`,
    `font-size:${s.size}px`,
    `font-weight:${s.weight}`,
    `color:${s.color}`,
    `line-height:${s.lineHeight}`,
    `text-align:${s.align}`,
    s.italic ? "font-style:italic" : "",
    s.uppercase ? "text-transform:uppercase" : "",
    s.letterSpacing ? `letter-spacing:${s.letterSpacing}px` : "",
  ]
    .filter(Boolean)
    .join(";");
}

export function imageSrc(image: Slide["image"] | undefined, resolve?: (id: string) => string): string | null {
  if (!image) return null;
  if (image.fileId && resolve) return resolve(image.fileId);
  if (image.dataUrl) return image.dataUrl;
  return null;
}

function elementHtml(el: SlideElement, theme: SlideTheme, index: number, opts: RenderHtmlOptions): string {
  const locale = opts.locale ?? "vi";
  const key = `data-key="${esc(el.key)}"`;
  switch (el.type) {
    case "shape": {
      const radius = el.shape === "ellipse" ? "border-radius:50%" : el.radius ? `border-radius:${el.radius}px` : "";
      return `<div class="el" ${key} style="${boxCss(el.box)};background:${el.fill};opacity:${el.opacity};${radius}"></div>`;
    }
    case "text":
      return `<div class="el tx" ${key} style="${boxCss(el.box)};${textCss(el.style)}"><div>${esc(el.text)}</div></div>`;
    case "bullets": {
      const items = el.items
        .filter((i) => i.trim())
        .map(
          (it, i) =>
            `<li style="${i > 0 ? `margin-top:${el.gap}px;` : ""}padding-left:${el.indent}px"><span class="bd" style="width:${el.indent}px">•</span>${esc(it)}</li>`,
        )
        .join("");
      return `<div class="el tx" ${key} style="${boxCss(el.box)};${textCss(el.style)}"><ul>${items}</ul></div>`;
    }
    case "image": {
      const src = imageSrc(el.image, opts.resolveImageUrl);
      const inner = src ? `<img src="${esc(src)}" alt="${esc(el.image?.caption ?? el.image?.prompt ?? "")}">` : "";
      return `<div class="el im" ${key} style="${boxCss(el.box)};background:${el.fill};border-radius:${el.radius}px">${inner}</div>`;
    }
    case "chart": {
      const svg = chartSvg(el.chart, {
        w: el.box.w,
        h: el.box.h,
        colors: el.colors,
        textColor: el.textColor,
        gridColor: el.gridColor,
        fontSize: el.fontSize,
        fontFamily: fontOf(theme).css,
      });
      return `<div class="el" ${key} style="${boxCss(el.box)}">${svg}</div>`;
    }
    case "table": {
      const cols = el.colW.map((w) => `<col style="width:${w}px">`).join("");
      const cell = (txt: string, bold: boolean, bg: string | null, color: string, h: number, last: boolean) =>
        `<td style="height:${h}px;font-size:${el.fontSize}px;font-weight:${bold ? 700 : 400};color:${color};${bg ? `background:${bg};` : ""}${last ? "" : `border-right:1px solid ${el.borderColor};`}border-bottom:1px solid ${el.borderColor}">${esc(txt)}</td>`;
      const head = `<tr>${el.headers.map((h, c) => cell(h, true, el.headerFill, el.headerColor, el.rowH[0], c === el.headers.length - 1)).join("")}</tr>`;
      const body = el.rows
        .map(
          (r, ri) =>
            `<tr>${el.headers.map((_, c) => cell(r[c] ?? "", false, ri % 2 === 1 ? el.zebraFill : null, el.textColor, el.rowH[ri + 1], c === el.headers.length - 1)).join("")}</tr>`,
        )
        .join("");
      return `<div class="el" ${key} style="${boxCss(el.box)}"><table><colgroup>${cols}</colgroup>${head}${body}</table></div>`;
    }
    case "slideNumber":
      return `<div class="el tx" ${key} style="${boxCss(el.box)};${textCss(el.style)}"><div>${index + 1}</div></div>`;
    case "citations": {
      const label = t("slides.citations.label", undefined, locale);
      return `<div class="el tx" ${key} style="${boxCss(el.box)};${textCss(el.style)}"><div>${esc(label)} ${el.numbers.map((n) => `[${n}]`).join(" ")}</div></div>`;
    }
  }
}

export function slideHtml(slide: Slide, theme: SlideTheme, index: number, total: number, opts: RenderHtmlOptions = {}): string {
  const r = layoutSlide(slide, theme, { index, total });
  const body = r.elements.map((e) => elementHtml(e, theme, index, opts)).join("");
  return `<section class="page" data-slide-id="${esc(slide.id)}" data-layout="${slide.layout}" style="background:${r.background}">${body}</section>`;
}

export const SLIDE_PRINT_CSS = `@page{size:${SLIDE_W}px ${SLIDE_H}px;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;margin:24px auto;box-shadow:0 8px 30px rgba(15,23,42,.18);break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.el{position:absolute;overflow:hidden}
.tx{display:flex;flex-direction:column;overflow:visible}
.tx>div{white-space:pre-wrap;overflow-wrap:break-word;width:100%}
.tx ul{list-style:none;margin:0;padding:0;width:100%}
.tx li{position:relative;overflow-wrap:break-word;white-space:pre-wrap}
.tx .bd{position:absolute;left:0;top:0}
.im img{width:100%;height:100%;object-fit:cover;display:block}
.el table{border-collapse:collapse;table-layout:fixed;width:100%}
.el td{padding:0 14px;vertical-align:middle;overflow-wrap:break-word}
.el svg{display:block;width:100%;height:100%}
@media print{body{background:none}.page{margin:0;box-shadow:none}}`;

/** HTML độc lập, mỗi slide một trang 1280×720 (in PDF bằng Chromium). */
export function renderSlideDeckHtml(content: SlideDeckContent, opts: RenderHtmlOptions = {}): string {
  const slides = [...content.slides];
  if (opts.includeSources !== false) slides.push(...buildSourceSlides(content, opts.locale));
  const pages = slides.map((s, i) => slideHtml(s, content.theme, i, slides.length, opts)).join("\n");
  const title = opts.title ?? content.slides[0]?.title ?? "Slides";
  return `<!doctype html>
<html lang="${opts.locale ?? "vi"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${SLIDE_W}">
<title>${esc(title)}</title>
<style>
body{font-family:${fontOf(content.theme).css}}
${SLIDE_PRINT_CSS}
</style>
</head>
<body>
${pages}
</body>
</html>
`;
}
