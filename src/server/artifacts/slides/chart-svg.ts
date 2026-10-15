import type { SlideChart } from "./types";

/**
 * Vẽ biểu đồ cột/đường/tròn thành chuỗi SVG tự chứa (dùng cho SlideView, HTML in, SVG infographic).
 * PPTX dùng biểu đồ gốc (`addChart`) nên không đi qua đây.
 */

export type ChartSvgOptions = {
  w: number;
  h: number;
  colors: string[];
  textColor: string;
  gridColor: string;
  fontSize: number;
  fontFamily: string;
};

export function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
export function fmtNum(n: number): string {
  return Number.isFinite(n) ? nf.format(n) : "0";
}

function niceScale(min: number, max: number, ticks = 4): { lo: number; hi: number; step: number } {
  if (max === min) max = min + 1;
  const range = max - min;
  const rough = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

function truncate(label: string, maxChars: number): string {
  const chars = [...label];
  if (chars.length <= maxChars) return label;
  return chars.slice(0, Math.max(1, maxChars - 1)).join("") + "…";
}

function text(x: number, y: number, s: string, o: { size: number; fill: string; anchor?: string; weight?: number; baseline?: string }): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size}" fill="${o.fill}" text-anchor="${o.anchor ?? "start"}"${
    o.weight ? ` font-weight="${o.weight}"` : ""
  }${o.baseline ? ` dominant-baseline="${o.baseline}"` : ""}>${escXml(s)}</text>`;
}

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function chartSvg(chart: SlideChart, o: ChartSvgOptions): string {
  const { w, h, fontSize: fs } = o;
  const color = (i: number) => o.colors[i % o.colors.length];
  const parts: string[] = [];
  const empty = chart.labels.length === 0 || chart.series.length === 0;

  if (!empty && chart.type === "pie") {
    const values = chart.labels.map((_, i) => Math.max(0, chart.series[0].values[i] ?? 0));
    const total = values.reduce((a, b) => a + b, 0);
    const legendW = Math.min(w * 0.42, 360);
    const r = Math.min(h / 2 - 12, (w - legendW) / 2 - 12);
    const cx = (w - legendW) / 2;
    const cy = h / 2;
    if (total > 0 && r > 10) {
      let a0 = -Math.PI / 2;
      values.forEach((v, i) => {
        if (v <= 0) return;
        const frac = v / total;
        const a1 = a0 + frac * Math.PI * 2;
        if (frac >= 0.9999) {
          parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(i)}"/>`);
        } else {
          const [x0, y0] = polar(cx, cy, r, a0);
          const [x1, y1] = polar(cx, cy, r, a1);
          parts.push(
            `<path d="M${cx.toFixed(1)} ${cy.toFixed(1)} L${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${color(i)}" stroke="#ffffff" stroke-width="2"/>`,
          );
        }
        if (frac >= 0.06) {
          const [lx, ly] = polar(cx, cy, r * 0.65, (a0 + a1) / 2);
          parts.push(text(lx, ly, `${Math.round(frac * 100)}%`, { size: fs, fill: "#ffffff", anchor: "middle", weight: 700, baseline: "middle" }));
        }
        a0 = a1;
      });
    }
    const rowH = Math.min(fs * 2, (h - 24) / Math.max(1, chart.labels.length));
    const lx = w - legendW + 8;
    const ly0 = h / 2 - (rowH * chart.labels.length) / 2;
    chart.labels.forEach((lab, i) => {
      const y = ly0 + i * rowH + rowH / 2;
      parts.push(`<rect x="${lx}" y="${(y - fs * 0.35).toFixed(1)}" width="${fs * 0.7}" height="${fs * 0.7}" rx="2" fill="${color(i)}"/>`);
      const pct = total > 0 ? ` · ${Math.round(((values[i] ?? 0) / total) * 100)}%` : "";
      parts.push(text(lx + fs, y, truncate(lab, Math.floor((legendW - fs * 2) / (fs * 0.56)) - pct.length) + pct, { size: fs, fill: o.textColor, baseline: "middle" }));
    });
  } else if (!empty) {
    const multi = chart.series.length > 1;
    const legendH = multi ? fs * 2 : 0;
    const padL = 12 + 7 * fs * 0.6;
    const padR = 16;
    const padT = 14 + legendH + fs;
    const padB = fs * 2.4;
    const pw = w - padL - padR;
    const ph = h - padT - padB;
    const all = chart.series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    const { lo, hi, step } = niceScale(Math.min(0, ...all, 0), Math.max(0, ...all, 0), 4);
    const y = (v: number) => padT + ph - ((v - lo) / (hi - lo)) * ph;
    for (let v = lo; v <= hi + step / 2; v += step) {
      const yy = y(v);
      parts.push(`<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${w - padR}" y2="${yy.toFixed(1)}" stroke="${o.gridColor}" stroke-width="1"/>`);
      parts.push(text(padL - 8, yy, fmtNum(Math.round(v * 100) / 100), { size: fs - 2, fill: o.textColor, anchor: "end", baseline: "middle" }));
    }
    const n = chart.labels.length;
    const band = pw / n;
    const maxChars = Math.max(3, Math.floor(band / ((fs - 2) * 0.56)));
    chart.labels.forEach((lab, i) => {
      parts.push(text(padL + band * i + band / 2, padT + ph + fs * 1.5, truncate(lab, maxChars), { size: fs - 2, fill: o.textColor, anchor: "middle" }));
    });
    const zeroY = y(0);
    if (chart.type === "bar") {
      const sc = chart.series.length;
      const groupW = band * 0.72;
      const barW = groupW / sc;
      chart.series.forEach((s, si) => {
        chart.labels.forEach((_, i) => {
          const v = s.values[i] ?? 0;
          const x = padL + band * i + (band - groupW) / 2 + barW * si;
          const yy = y(v);
          parts.push(
            `<rect x="${x.toFixed(1)}" y="${Math.min(yy, zeroY).toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${Math.max(1, Math.abs(zeroY - yy)).toFixed(1)}" rx="3" fill="${color(si)}"/>`,
          );
          if (n * sc <= 14) {
            parts.push(text(x + (barW - 2) / 2, (v >= 0 ? yy : yy + (fs - 2)) - (v >= 0 ? 6 : -2), fmtNum(v), { size: fs - 2, fill: o.textColor, anchor: "middle", weight: 600 }));
          }
        });
      });
    } else {
      chart.series.forEach((s, si) => {
        const pts = chart.labels.map((_, i) => [padL + band * i + band / 2, y(s.values[i] ?? 0)] as const);
        parts.push(`<polyline points="${pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")}" fill="none" stroke="${color(si)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
        pts.forEach(([px, py], i) => {
          parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="#ffffff" stroke="${color(si)}" stroke-width="2.5"/>`);
          if (n <= 12 && !multi) parts.push(text(px, py - 10, fmtNum(s.values[i] ?? 0), { size: fs - 2, fill: o.textColor, anchor: "middle", weight: 600 }));
        });
      });
    }
    if (multi) {
      let lx = padL;
      chart.series.forEach((s, si) => {
        parts.push(`<rect x="${lx}" y="${14}" width="${fs * 0.7}" height="${fs * 0.7}" rx="2" fill="${color(si)}"/>`);
        const label = truncate(s.name, 24);
        parts.push(text(lx + fs, 14 + fs * 0.35, label, { size: fs - 1, fill: o.textColor, baseline: "middle" }));
        lx += fs + label.length * (fs - 1) * 0.56 + fs * 1.4;
      });
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${escXml(o.fontFamily)}" role="img">${parts.join("")}</svg>`;
}
