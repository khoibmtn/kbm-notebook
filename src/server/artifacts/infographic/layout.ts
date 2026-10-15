import { t, type Locale } from "@/lib/i18n";
import { evidenceLine } from "../slides/sources";
import { fontOf, paletteOf, type PaletteTokens } from "../slides/themes";
import type { SlideChart } from "../slides/types";
import type { IconName } from "./icons";
import { INFOGRAPHIC_SIZE, type InfographicBlock, type InfographicContent } from "./types";

/**
 * Bộ dàn trang infographic: lưới khối → danh sách "nguyên thuỷ" có toạ độ tuyệt đối.
 * SVG xuất ra, HTML in và `InfographicView` (React) đều vẽ từ cùng một kết quả.
 */

export const INFOGRAPHIC_FONT = fontOf({ font: "Inter" });

export type TextPrim = {
  type: "text";
  key: string;
  x: number;
  y: number;
  w: number;
  /** Các dòng đã ngắt (dùng cho SVG, nơi chữ không tự xuống dòng). */
  lines: string[];
  /** Văn bản gốc (dùng cho HTML/React, trình duyệt tự ngắt dòng). */
  text: string;
  size: number;
  weight: 400 | 500 | 600 | 700 | 800;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  italic?: boolean;
  /** Đường dẫn trường trong InfographicContent để sửa trực tiếp, ví dụ "blocks.2.value". */
  field?: string;
};
export type RectPrim = { type: "rect"; key: string; x: number; y: number; w: number; h: number; fill: string; stroke?: string; radius?: number; opacity?: number };
export type CirclePrim = { type: "circle"; key: string; cx: number; cy: number; r: number; fill: string; opacity?: number };
export type LinePrim = { type: "line"; key: string; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number };
export type IconPrim = { type: "icon"; key: string; x: number; y: number; size: number; name: IconName; color: string };
export type ChartPrim = {
  type: "chart";
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  chart: SlideChart;
  colors: string[];
  textColor: string;
  gridColor: string;
  fontSize: number;
};
export type CitationsPrim = { type: "citations"; key: string; x: number; y: number; w: number; h: number; numbers: number[]; color: string; size: number; label: string };

export type Prim = TextPrim | RectPrim | CirclePrim | LinePrim | IconPrim | ChartPrim | CitationsPrim;

export type InfographicLayout = {
  /** Kích thước "ảo" của hệ toạ độ (đơn vị của mọi `Prim`). */
  width: number;
  height: number;
  /** Hệ số thu nhỏ để nội dung vừa canvas danh định (1080×1920 / 1920×1080); 1 = không thu nhỏ. */
  scale: number;
  /** Kích thước ảnh xuất ra = (width, height) × scale. */
  outWidth: number;
  outHeight: number;
  background: string;
  prims: Prim[];
};

// ------------------------------------------------------------------ đo & ngắt chữ

const CW = INFOGRAPHIC_FONT.charWidth;

export function wrapLines(text: string, size: number, maxW: number, bold = false): string[] {
  const cw = size * CW * (bold ? 1.05 : 1);
  const space = cw * 0.55;
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    let width = 0;
    const flush = () => {
      out.push(line);
      line = "";
      width = 0;
    };
    for (const word of words) {
      const chars = [...word];
      const ww = chars.length * cw;
      if (line && width + space + ww <= maxW) {
        line += " " + word;
        width += space + ww;
      } else {
        if (line) flush();
        if (ww > maxW) {
          // từ dài hơn khung: cắt theo ký tự
          const per = Math.max(1, Math.floor(maxW / cw));
          for (let i = 0; i < chars.length; i += per) {
            const part = chars.slice(i, i + per).join("");
            if (i + per < chars.length) out.push(part);
            else {
              line = part;
              width = part.length * cw;
            }
          }
        } else {
          line = word;
          width = ww;
        }
      }
    }
    if (line) flush();
  }
  return out;
}

type TextOpts = {
  key: string;
  x: number;
  y: number;
  w: number;
  size: number;
  weight?: TextPrim["weight"];
  color: string;
  align?: TextPrim["align"];
  lineHeight?: number;
  italic?: boolean;
  field?: string;
};

function text(s: string, o: TextOpts): { prim: TextPrim; h: number } {
  const lineHeight = o.lineHeight ?? 1.3;
  const weight = o.weight ?? 400;
  const lines = wrapLines(s, o.size, o.w, weight >= 600);
  const prim: TextPrim = {
    type: "text",
    key: o.key,
    x: o.x,
    y: o.y,
    w: o.w,
    lines,
    text: s,
    size: o.size,
    weight,
    color: o.color,
    align: o.align ?? "left",
    lineHeight,
    italic: o.italic,
    field: o.field,
  };
  return { prim, h: Math.ceil(lines.length * o.size * lineHeight) };
}

export function shiftPrim(p: Prim, dx: number, dy: number): Prim {
  switch (p.type) {
    case "circle":
      return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    case "line":
      return { ...p, x1: p.x1 + dx, x2: p.x2 + dx, y1: p.y1 + dy, y2: p.y2 + dy };
    default:
      return { ...p, x: p.x + dx, y: p.y + dy };
  }
}

// ------------------------------------------------------------------ khối

const PAD = 28;

type BlockCtx = { p: PaletteTokens; i: number; field: (rest: string) => string; locale: Locale };
type Built = { prims: Prim[]; h: number; dark?: boolean };

function numberBadge(key: string, cx: number, cy: number, r: number, n: number, fill: string, size: number): Prim[] {
  const lines = [String(n)];
  return [
    { type: "circle", key: `${key}-c`, cx, cy, r, fill },
    {
      type: "text",
      key: `${key}-n`,
      x: cx - r,
      y: cy - size * 0.65,
      w: r * 2,
      lines,
      text: String(n),
      size,
      weight: 700,
      color: "#ffffff",
      align: "center",
      lineHeight: 1.3,
    },
  ];
}

function bulletList(
  key: string,
  items: string[],
  fieldBase: string,
  x: number,
  y: number,
  w: number,
  size: number,
  color: string,
  dot: string,
  ordered = false,
): { prims: Prim[]; h: number } {
  const prims: Prim[] = [];
  const indent = ordered ? 46 : 28;
  let cy = y;
  items.forEach((it, i) => {
    const tx = text(it, { key: `${key}-t${i}`, x: x + indent, y: cy, w: w - indent, size, color, field: `${fieldBase}.${i}`, lineHeight: 1.3 });
    if (ordered) prims.push(...numberBadge(`${key}-m${i}`, x + 16, cy + size * 0.65, 16, i + 1, dot, 18));
    else prims.push({ type: "circle", key: `${key}-m${i}`, cx: x + 8, cy: cy + size * 0.65, r: 5, fill: dot });
    prims.push(tx.prim);
    cy += tx.h + 14;
  });
  return { prims, h: Math.max(0, cy - y - 14) };
}

function buildBlock(b: InfographicBlock, w: number, c: BlockCtx): Built {
  const { p } = c;
  const prims: Prim[] = [];
  const iw = w - PAD * 2;
  let y = PAD;
  const k = (s: string) => `b${c.i}-${s}`;
  const add = (r: { prim: TextPrim; h: number }, gap = 0) => {
    prims.push(r.prim);
    y += r.h + gap;
  };

  switch (b.type) {
    case "stat": {
      if (b.icon) {
        prims.push({ type: "circle", key: k("icon-bg"), cx: PAD + 28, cy: y + 28, r: 28, fill: p.soft });
        prims.push({ type: "icon", key: k("icon"), x: PAD + 12, y: y + 12, size: 32, name: b.icon, color: p.primary });
        y += 72;
      }
      let size = 84;
      while (size > 40 && [...b.value].length * size * 0.6 > iw) size -= 4;
      add(text(b.value, { key: k("value"), x: PAD, y, w: iw, size, weight: 800, color: p.primary, field: c.field("value"), lineHeight: 1.1 }), 8);
      add(text(b.label, { key: k("label"), x: PAD, y, w: iw, size: 28, weight: 700, color: p.heading, field: c.field("label"), lineHeight: 1.25 }), 8);
      if (b.caption) add(text(b.caption, { key: k("caption"), x: PAD, y, w: iw, size: 22, color: p.muted, field: c.field("caption") }), 0);
      break;
    }
    case "list": {
      add(text(b.title, { key: k("title"), x: PAD, y, w: iw, size: 32, weight: 700, color: p.heading, field: c.field("title"), lineHeight: 1.2 }), 18);
      const l = bulletList(k("items"), b.items, c.field("items"), PAD, y, iw, 25, p.ink, p.primary, b.ordered);
      prims.push(...l.prims);
      y += l.h;
      break;
    }
    case "process": {
      add(text(b.title, { key: k("title"), x: PAD, y, w: iw, size: 32, weight: 700, color: p.heading, field: c.field("title"), lineHeight: 1.2 }), 22);
      const n = b.steps.length;
      if (w >= 900 && n <= 5) {
        // Ngang: mỗi bước một cột, các vòng số nối bằng đường kẻ.
        const sw = iw / n;
        let maxH = 0;
        b.steps.forEach((s, i) => {
          const sx = PAD + i * sw;
          let sy = y + 44 + 16;
          const t1 = text(s.title, { key: k(`s${i}-title`), x: sx, y: sy, w: sw - 24, size: 27, weight: 700, color: p.ink, field: c.field(`steps.${i}.title`), lineHeight: 1.25 });
          prims.push(t1.prim);
          sy += t1.h + 4;
          if (s.description) {
            const t2 = text(s.description, { key: k(`s${i}-desc`), x: sx, y: sy, w: sw - 24, size: 23, color: p.muted, field: c.field(`steps.${i}.description`) });
            prims.push(t2.prim);
            sy += t2.h;
          }
          maxH = Math.max(maxH, sy - y);
          if (i < n - 1) prims.push({ type: "line", key: k(`s${i}-line`), x1: sx + 52, y1: y + 22, x2: sx + sw - 8, y2: y + 22, stroke: p.line, width: 4 });
          prims.push(...numberBadge(k(`s${i}`), sx + 22, y + 22, 22, i + 1, p.primary, 22));
        });
        y += maxH;
        break;
      }
      const tx = PAD + 64;
      b.steps.forEach((s, i) => {
        const top = y;
        const t1 = text(s.title, { key: k(`s${i}-title`), x: tx, y, w: iw - 64, size: 27, weight: 700, color: p.ink, field: c.field(`steps.${i}.title`), lineHeight: 1.25 });
        prims.push(t1.prim);
        y += t1.h + 4;
        if (s.description) {
          const t2 = text(s.description, { key: k(`s${i}-desc`), x: tx, y, w: iw - 64, size: 23, color: p.muted, field: c.field(`steps.${i}.description`) });
          prims.push(t2.prim);
          y += t2.h;
        }
        const stepH = Math.max(y - top, 44);
        prims.push(...numberBadge(k(`s${i}`), PAD + 22, top + 22, 22, i + 1, p.primary, 22));
        if (i < b.steps.length - 1) {
          prims.push({ type: "line", key: k(`s${i}-line`), x1: PAD + 22, y1: top + 48, x2: PAD + 22, y2: top + stepH + 22 - 4, stroke: p.line, width: 4 });
        }
        y = top + stepH + 22;
      });
      y -= 22;
      break;
    }
    case "compare": {
      add(text(b.title, { key: k("title"), x: PAD, y, w: iw, size: 32, weight: 700, color: p.heading, field: c.field("title"), lineHeight: 1.2 }), 20);
      const gap = 20;
      const pw = (iw - gap) / 2;
      const sides = [
        { s: b.left, key: "left", color: p.primary },
        { s: b.right, key: "right", color: p.heading },
      ] as const;
      const panels = sides.map(({ s, key, color }, si) => {
        const px = PAD + si * (pw + gap);
        const inner: Prim[] = [];
        let iy = 20;
        const h1 = text(s.heading, { key: k(`${key}-heading`), x: px + 20, y: y + iy, w: pw - 40, size: 27, weight: 700, color, field: c.field(`${key}.heading`), lineHeight: 1.2 });
        inner.push(h1.prim);
        iy += h1.h + 14;
        const l = bulletList(k(`${key}-items`), s.items, c.field(`${key}.items`), px + 20, y + iy, pw - 40, 23, p.ink, color);
        inner.push(...l.prims);
        iy += l.h + 20;
        return { inner, h: iy, px };
      });
      const ph = Math.max(...panels.map((x) => x.h));
      panels.forEach((pn, si) => {
        prims.push({ type: "rect", key: k(`${sides[si].key}-panel`), x: pn.px, y, w: pw, h: ph, fill: p.soft, radius: 16 });
        prims.push(...pn.inner);
      });
      y += ph;
      break;
    }
    case "icon_text": {
      prims.push({ type: "circle", key: k("icon-bg"), cx: PAD + 32, cy: y + 32, r: 32, fill: p.soft });
      prims.push({ type: "icon", key: k("icon"), x: PAD + 14, y: y + 14, size: 36, name: b.icon, color: p.primary });
      const tx = PAD + 84;
      const top = y;
      const t1 = text(b.title, { key: k("title"), x: tx, y, w: w - tx - PAD, size: 28, weight: 700, color: p.heading, field: c.field("title"), lineHeight: 1.2 });
      prims.push(t1.prim);
      y += t1.h + 8;
      const t2 = text(b.text, { key: k("text"), x: tx, y, w: w - tx - PAD, size: 24, color: p.ink, field: c.field("text") });
      prims.push(t2.prim);
      y += t2.h;
      y = Math.max(y, top + 64);
      break;
    }
    case "chart": {
      add(text(b.title, { key: k("title"), x: PAD, y, w: iw, size: 32, weight: 700, color: p.heading, field: c.field("title"), lineHeight: 1.2 }), 16);
      const ch = 340;
      prims.push({ type: "chart", key: k("chart"), x: PAD, y, w: iw, h: ch, chart: b.chart, colors: p.series, textColor: p.ink, gridColor: p.line, fontSize: 18 });
      y += ch;
      break;
    }
    case "quote": {
      prims.push({ type: "text", key: k("mark"), x: PAD, y: y - 6, w: 120, lines: ["“"], text: "“", size: 120, weight: 800, color: p.accent, align: "left", lineHeight: 1 });
      y += 70;
      let size = 40;
      while (size > 26 && wrapLines(b.text, size, iw).length * size * 1.3 > 360) size -= 2;
      add(text(b.text, { key: k("text"), x: PAD, y, w: iw, size, weight: 500, italic: true, color: "#ffffff", field: c.field("text"), lineHeight: 1.3 }), 16);
      if (b.attribution) add(text(`— ${b.attribution}`, { key: k("attribution"), x: PAD, y, w: iw, size: 24, weight: 600, color: p.accent, field: c.field("attribution") }), 0);
      return finishBlock(b, prims, y, w, p, c, true);
    }
  }
  return finishBlock(b, prims, y, w, p, c, false);
}

function finishBlock(b: InfographicBlock, prims: Prim[], y: number, w: number, p: PaletteTokens, c: BlockCtx, dark: boolean): Built {
  let h = y;
  const nums = (b.citations ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length > 0) {
    h += 18;
    prims.push({ type: "citations", key: `b${c.i}-cites`, x: PAD, y: h, w: w - PAD * 2, h: 26, numbers: nums, color: dark ? p.accent : p.muted, size: 18, label: t("slides.citations.label", undefined, c.locale) });
    h += 26;
  }
  return { prims, h: h + PAD, dark };
}

// ------------------------------------------------------------------ lưới

function defaultSpan(b: InfographicBlock, cols: number): number {
  if (b.span) return Math.min(cols, b.span);
  switch (b.type) {
    case "process":
      return cols;
    case "compare":
    case "chart":
    case "quote":
      return Math.min(cols, 2);
    default:
      return 1;
  }
}

export type LayoutOptions = { locale?: Locale };

/**
 * Dàn trang vào canvas danh định (dọc 1080×1920 / ngang 1920×1080). Nếu nội dung dài hơn canvas,
 * thử các hệ số thu nhỏ 0.9 → 0.7 (dàn trang lại trên canvas "ảo" rộng hơn; chữ nhỏ hơn nhưng vẫn đọc được) cho tới khi vừa;
 * hết cách thì canvas dài thêm (chiều cao > danh định).
 */
export function layoutInfographic(content: InfographicContent, opts: LayoutOptions = {}): InfographicLayout {
  const nominal = INFOGRAPHIC_SIZE[content.orientation];
  let last: InfographicLayout | null = null;
  for (const k of [1, 0.9, 0.8, 0.7]) {
    const virtualW = Math.round(nominal.width / k);
    const virtualH = Math.round(nominal.height / k);
    const l = layoutAt(content, opts, virtualW, virtualH, k);
    last = l;
    if (l.height <= virtualH) break;
  }
  return last as InfographicLayout;
}

function layoutAt(content: InfographicContent, opts: LayoutOptions, W: number, H: number, k: number): InfographicLayout {
  const locale = opts.locale ?? "vi";
  const p = paletteOf({ palette: content.palette });
  const portrait = content.orientation === "portrait";
  const margin = portrait ? 56 : 64;
  const gap = portrait ? 24 : 28;
  const cols = portrait ? 2 : 3;
  const colW = (W - margin * 2 - gap * (cols - 1)) / cols;
  const prims: Prim[] = [];

  // --- header
  const headerW = W - margin * 2 - (portrait ? 0 : 280);
  let size = portrait ? 68 : 72;
  while (size > 36 && wrapLines(content.title, size, headerW, true).length > 3) size -= 4;
  const topPad = portrait ? 72 : 56;
  const title = text(content.title, { key: "title", x: margin, y: topPad, w: headerW, size, weight: 800, color: "#ffffff", field: "title", lineHeight: 1.12 });
  let hy = topPad + title.h;
  const header: Prim[] = [title.prim];
  if (content.subtitle) {
    hy += 18;
    const sub = text(content.subtitle, { key: "subtitle", x: margin, y: hy, w: headerW, size: portrait ? 30 : 28, color: p.accent, field: "subtitle", lineHeight: 1.3 });
    header.push(sub.prim);
    hy += sub.h;
  }
  const headerH = hy + (portrait ? 64 : 52);
  prims.push(
    { type: "rect", key: "header-bg", x: 0, y: 0, w: W, h: headerH, fill: p.dark },
    { type: "circle", key: "header-deco-1", cx: W - 90, cy: headerH * 0.15, r: portrait ? 190 : 230, fill: p.primary, opacity: 0.5 },
    { type: "circle", key: "header-deco-2", cx: W - 300, cy: headerH + 20, r: portrait ? 120 : 140, fill: p.accent, opacity: 0.16 },
    { type: "rect", key: "header-bar", x: margin, y: topPad - 28, w: 88, h: 8, fill: p.accent, radius: 4 },
    ...header,
  );

  // --- khối: xây ở chiều rộng cột, đóng gói theo hàng (có "lấp chỗ trống" nhìn trước 4 khối)
  type Item = { b: InfographicBlock; i: number; span: number };
  const remaining: Item[] = content.blocks.map((b, i) => ({ b, i, span: defaultSpan(b, cols) }));
  type Row = { items: Item[]; spans: number[] };
  const rows: Row[] = [];
  while (remaining.length > 0) {
    const first = remaining.shift() as Item;
    const row: Row = { items: [first], spans: [first.span] };
    let free = cols - first.span;
    while (free > 0) {
      const idx = remaining.slice(0, 4).findIndex((r) => r.span <= free);
      if (idx < 0) break;
      const [it] = remaining.splice(idx, 1);
      row.items.push(it);
      row.spans.push(it.span);
      free -= it.span;
    }
    // Hàng chưa đầy: khối cuối giãn ra để không để trống ô.
    if (free > 0) row.spans[row.spans.length - 1] += free;
    rows.push(row);
  }

  const built = rows.map((row) =>
    row.items.map((it, ri) => {
      const w = colW * row.spans[ri] + gap * (row.spans[ri] - 1);
      return { it, w, ...buildBlock(it.b, w, { p, i: it.i, field: (rest) => `blocks.${it.i}.${rest}`, locale }) };
    }),
  );
  const rowH = built.map((r) => Math.max(...r.map((x) => x.h)));

  // --- chân trang: danh sách nguồn đã trích dẫn
  const cited = citedInfographic(content);
  const footerPrims: Prim[] = [];
  let footerH = 0;
  if (cited.length > 0) {
    const label = t("slides.sources.title", undefined, locale);
    footerH += 8;
    const head = text(label, { key: "sources-title", x: margin, y: 0, w: W - margin * 2, size: 22, weight: 700, color: p.heading });
    footerPrims.push(head.prim);
    footerH += head.h + 8;
    cited.forEach((n, i) => {
      const line = text(evidenceLine(n, content.evidence[n - 1], locale), { key: `source-${i}`, x: margin, y: footerH, w: W - margin * 2, size: 18, color: p.muted, lineHeight: 1.3 });
      footerPrims.push(line.prim);
      footerH += line.h + 4;
    });
    footerH += 8;
  }

  const bodyTop = headerH + (portrait ? 40 : 36);
  const bottomPad = margin;
  const naturalBody = rowH.reduce((a, b) => a + b, 0) + gap * Math.max(0, rows.length - 1);
  const available = H - bodyTop - footerH - bottomPad;
  // Còn dư chỗ: giãn các hàng (tối đa +35%); thiếu chỗ: canvas dài thêm.
  let stretch = 0;
  if (naturalBody < available && rows.length > 0) stretch = Math.min((available - naturalBody) / rows.length, Math.max(...rowH) * 0.35);
  let cy = bodyTop;
  built.forEach((row, ri) => {
    const h = rowH[ri] + stretch;
    let cx = margin;
    row.forEach((cell) => {
      const dark = cell.dark === true;
      prims.push({
        type: "rect",
        key: `b${cell.it.i}-card`,
        x: cx,
        y: cy,
        w: cell.w,
        h,
        fill: dark ? p.primary : "#ffffff",
        stroke: dark ? undefined : p.line,
        radius: 24,
      });
      // Nội dung căn giữa theo chiều dọc khi thẻ bị giãn (cạnh khối cao hơn).
      const dy = Math.max(0, (h - cell.h) / 2);
      for (const prim of cell.prims) prims.push(shiftPrim(prim, cx, cy + dy));
      cx += cell.w + gap;
    });
    cy += h + gap;
  });
  const bodyEnd = rows.length > 0 ? cy - gap : bodyTop;
  const footerTop = bodyEnd + 28;
  for (const fp of footerPrims) prims.push(shiftPrim(fp, 0, footerTop));
  const height = Math.max(H, Math.ceil(footerTop + footerH + bottomPad));

  return { width: W, height, scale: k, outWidth: Math.round(W * k), outHeight: Math.round(height * k), background: p.soft, prims };
}

function citedInfographic(content: InfographicContent): number[] {
  const set = new Set<number>();
  for (const b of content.blocks) for (const n of b.citations ?? []) if (Number.isInteger(n) && n >= 1 && n <= content.evidence.length) set.add(n);
  return [...set].sort((a, b) => a - b);
}
