import { type Locale } from "@/lib/i18n";
import { chartSvg, escXml } from "../slides/chart-svg";
import { ICON_NODES, type IconName } from "./icons";
import { INFOGRAPHIC_FONT, layoutInfographic, type InfographicLayout, type Prim, type TextPrim } from "./layout";
import type { InfographicContent } from "./types";

/** SVG con của một biểu tượng lucide (24×24) đặt tại (x,y) với kích thước `size`. */
export function iconSvgInner(name: IconName): string {
  const nodes = ICON_NODES[name] ?? ICON_NODES.info;
  return nodes
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escXml(String(v))}"`).join(" ")}/>`)
    .join("");
}

function iconSvg(x: number, y: number, size: number, name: IconName, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSvgInner(name)}</g>`;
}

function textX(p: TextPrim): { x: number; anchor: string } {
  if (p.align === "center") return { x: p.x + p.w / 2, anchor: "middle" };
  if (p.align === "right") return { x: p.x + p.w, anchor: "end" };
  return { x: p.x, anchor: "start" };
}

function svgText(p: TextPrim): string {
  const { x, anchor } = textX(p);
  const lh = p.size * p.lineHeight;
  const tspans = p.lines
    .map((line, i) => `<tspan x="${x.toFixed(1)}" y="${(p.y + i * lh + (lh - p.size) / 2 + p.size * 0.8).toFixed(1)}">${escXml(line)}</tspan>`)
    .join("");
  return `<text font-size="${p.size}" font-weight="${p.weight}" fill="${p.color}" text-anchor="${anchor}"${p.italic ? ' font-style="italic"' : ""}>${tspans}</text>`;
}

function chartMarkup(p: Extract<Prim, { type: "chart" }>): string {
  return chartSvg(p.chart, { w: p.w, h: p.h, colors: p.colors, textColor: p.textColor, gridColor: p.gridColor, fontSize: p.fontSize, fontFamily: INFOGRAPHIC_FONT.css });
}

function svgPrim(p: Prim): string {
  switch (p.type) {
    case "rect":
      return `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h.toFixed(1)}"${p.radius ? ` rx="${p.radius}"` : ""} fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="2"` : ""}${p.opacity != null ? ` opacity="${p.opacity}"` : ""}/>`;
    case "circle":
      return `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${p.r}" fill="${p.fill}"${p.opacity != null ? ` opacity="${p.opacity}"` : ""}/>`;
    case "line":
      return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.stroke}" stroke-width="${p.width}" stroke-linecap="round"/>`;
    case "text":
      return svgText(p);
    case "icon":
      return iconSvg(p.x, p.y, p.size, p.name, p.color);
    case "chart":
      return `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">${chartMarkup(p)}</g>`;
    case "citations":
      return `<text x="${p.x.toFixed(1)}" y="${(p.y + p.size + 2).toFixed(1)}" font-size="${p.size}" font-weight="500" fill="${p.color}">${escXml(`${p.label} ${p.numbers.map((n) => `[${n}]`).join(" ")}`)}</text>`;
  }
}

/** SVG tự chứa (không tham chiếu ngoài); phông dự phòng theo chuỗi font-family, không nhúng tệp phông. */
export function exportInfographicSvg(content: InfographicContent, opts: { locale?: Locale; layout?: InfographicLayout } = {}): string {
  const l = opts.layout ?? layoutInfographic(content, { locale: opts.locale });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.outWidth}" height="${l.outHeight}" viewBox="0 0 ${l.width} ${l.height}" font-family="${escXml(INFOGRAPHIC_FONT.css)}" role="img" aria-label="${escXml(content.title)}">
<title>${escXml(content.title)}</title>
<rect width="${l.width}" height="${l.height}" fill="${l.background}"/>
${l.prims.map(svgPrim).join("\n")}
</svg>
`;
}

// ------------------------------------------------------------------ HTML

function htmlPrim(p: Prim): string {
  switch (p.type) {
    case "rect":
      return `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;background:${p.fill};${p.stroke ? `border:2px solid ${p.stroke};box-sizing:border-box;` : ""}${p.radius ? `border-radius:${p.radius}px;` : ""}${p.opacity != null ? `opacity:${p.opacity};` : ""}"></div>`;
    case "circle":
      return `<div style="position:absolute;left:${p.cx - p.r}px;top:${p.cy - p.r}px;width:${p.r * 2}px;height:${p.r * 2}px;border-radius:50%;background:${p.fill};${p.opacity != null ? `opacity:${p.opacity};` : ""}"></div>`;
    case "line":
      return `<svg style="position:absolute;left:0;top:0;overflow:visible" width="1" height="1"><line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.stroke}" stroke-width="${p.width}" stroke-linecap="round"/></svg>`;
    case "text":
      return `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;font-size:${p.size}px;font-weight:${p.weight};color:${p.color};text-align:${p.align};line-height:${p.lineHeight};white-space:nowrap${p.italic ? ";font-style:italic" : ""}">${p.lines.map(escXml).join("<br>")}</div>`;
    case "icon":
      return `<svg style="position:absolute;left:${p.x}px;top:${p.y}px" width="${p.size}" height="${p.size}" viewBox="0 0 24 24" fill="none" stroke="${p.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSvgInner(p.name)}</svg>`;
    case "chart":
      return `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px">${chartMarkup(p)}</div>`;
    case "citations":
      return `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;font-size:${p.size}px;font-weight:500;color:${p.color}">${escXml(`${p.label} ${p.numbers.map((n) => `[${n}]`).join(" ")}`)}</div>`;
  }
}

/** HTML độc lập 1 trang đúng kích thước canvas (dùng để chụp PNG/in PDF bằng Chromium). */
export function renderInfographicHtml(content: InfographicContent, opts: { locale?: Locale } = {}): string {
  const l = layoutInfographic(content, { locale: opts.locale });
  return `<!doctype html>
<html lang="${opts.locale ?? "vi"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${l.outWidth}">
<title>${escXml(content.title)}</title>
<style>
@page{size:${l.outWidth}px ${l.outHeight}px;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#e2e8f0;font-family:${INFOGRAPHIC_FONT.css};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.frame{position:relative;width:${l.outWidth}px;height:${l.outHeight}px;overflow:hidden;margin:0 auto;background:${l.background}}
.canvas{position:absolute;left:0;top:0;width:${l.width}px;height:${l.height}px;transform:scale(${l.scale});transform-origin:0 0;background:${l.background}}
.canvas svg{display:block}
@media print{html,body{background:none}}
</style>
</head>
<body>
<div class="frame"><div class="canvas" data-orientation="${content.orientation}">
${l.prims.map(htmlPrim).join("\n")}
</div></div>
</body>
</html>
`;
}
