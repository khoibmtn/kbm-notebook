import { t as translate, type Locale } from "@/lib/i18n";
import { newId } from "./sources";
import type { Slide, SlideChart, SlideDeckContent, SlideLayout } from "./types";

/**
 * Phép biến đổi thuần (immutable) trên SlideDeckContent — dùng bởi editor và test.
 * Không phụ thuộc React hay server.
 */

export type DefaultLabels = { series: string; labelPrefix: string; column: string };

export function defaultLabels(locale: Locale = "vi"): DefaultLabels {
  return {
    series: translate("slides.default.series", undefined, locale),
    labelPrefix: translate("slides.default.label", undefined, locale),
    column: translate("slides.default.column", undefined, locale),
  };
}

export function defaultChart(d: DefaultLabels = defaultLabels()): SlideChart {
  return {
    type: "bar",
    labels: [1, 2, 3].map((i) => `${d.labelPrefix} ${i}`),
    series: [{ name: d.series, values: [0, 0, 0] }],
  };
}

export function defaultTable(d: DefaultLabels = defaultLabels()): NonNullable<Slide["table"]> {
  return { headers: [1, 2, 3].map((i) => `${d.column} ${i}`), rows: [["", "", ""]] };
}

/** Slide mới với khung dữ liệu rỗng đủ để layout hiển thị và sửa trực tiếp. */
export function newSlide(layout: SlideLayout, d: DefaultLabels = defaultLabels()): Slide {
  const base: Slide = { id: newId(), layout, title: "" };
  return ensureLayoutFields(base, layout, d);
}

/** Bảo đảm slide có các trường mà `layout` cần (không xoá dữ liệu cũ, để đổi layout qua lại không mất nội dung). */
export function ensureLayoutFields(slide: Slide, layout: SlideLayout, d: DefaultLabels = defaultLabels()): Slide {
  const s: Slide = { ...slide, layout };
  const flat = slide.bullets ?? slide.columns?.flatMap((c) => c.bullets) ?? [];
  switch (layout) {
    case "title_bullets":
    case "image_text":
      s.bullets = slide.bullets ?? flat;
      if (layout === "image_text") s.image = slide.image ?? { prompt: "" };
      break;
    case "closing":
      s.bullets = slide.bullets;
      break;
    case "two_column": {
      if (!slide.columns || slide.columns.length < 2) {
        const half = Math.ceil(flat.length / 2);
        s.columns = [
          { heading: "", bullets: flat.slice(0, half) },
          { heading: "", bullets: flat.slice(half) },
        ];
      }
      break;
    }
    case "chart":
      s.chart = slide.chart ?? defaultChart(d);
      break;
    case "table":
      s.table = slide.table ?? defaultTable(d);
      break;
    case "quote":
      s.quote = slide.quote ?? { text: "" };
      break;
    default:
      break;
  }
  return s;
}

export function changeLayout(slide: Slide, layout: SlideLayout, d?: DefaultLabels): Slide {
  return ensureLayoutFields(slide, layout, d);
}

// ---------------------------------------------------------------- đường dẫn trường

type PathSeg = string | number;

function parsePath(path: string): PathSeg[] {
  return path.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of parsePath(path)) {
    if (cur == null) return undefined;
    cur = (cur as Record<PathSeg, unknown>)[seg];
  }
  return cur;
}

/** Gán giá trị theo đường dẫn ("columns.1.heading", "table.rows.0.2"), sao chép dọc đường đi. */
export function setAt<T>(obj: T, path: string, value: unknown): T {
  const segs = parsePath(path);
  const rec = (cur: unknown, i: number): unknown => {
    if (i === segs.length) return value;
    const seg = segs[i];
    const next = typeof segs[i + 1] === "number" ? [] : {};
    if (Array.isArray(cur)) {
      const copy = [...cur];
      copy[seg as number] = rec(cur[seg as number] ?? next, i + 1);
      return copy;
    }
    const base = (cur ?? {}) as Record<string, unknown>;
    return { ...base, [seg]: rec(base[seg as string] ?? next, i + 1) };
  };
  return rec(obj, 0) as T;
}

// ---------------------------------------------------------------- thao tác trên bộ slide

export function updateSlide(content: SlideDeckContent, slideId: string, fn: (s: Slide) => Slide): SlideDeckContent {
  return { ...content, slides: content.slides.map((s) => (s.id === slideId ? fn(s) : s)) };
}

export function insertSlide(content: SlideDeckContent, index: number, slide: Slide): SlideDeckContent {
  const slides = [...content.slides];
  slides.splice(Math.max(0, Math.min(slides.length, index)), 0, slide);
  return { ...content, slides };
}

export function duplicateSlide(content: SlideDeckContent, slideId: string): { content: SlideDeckContent; newId: string } | null {
  const i = content.slides.findIndex((s) => s.id === slideId);
  if (i < 0) return null;
  const copy: Slide = { ...(JSON.parse(JSON.stringify(content.slides[i])) as Slide), id: newId() };
  return { content: insertSlide(content, i + 1, copy), newId: copy.id };
}

export function deleteSlide(content: SlideDeckContent, slideId: string): SlideDeckContent {
  if (content.slides.length <= 1) return content;
  return { ...content, slides: content.slides.filter((s) => s.id !== slideId) };
}

export function moveSlide(content: SlideDeckContent, from: number, to: number): SlideDeckContent {
  if (from === to || from < 0 || to < 0 || from >= content.slides.length || to >= content.slides.length) return content;
  const slides = [...content.slides];
  const [m] = slides.splice(from, 1);
  slides.splice(to, 0, m);
  return { ...content, slides };
}

// ---------------------------------------------------------------- bullets

export function setBullets(slide: Slide, field: string, items: string[]): Slide {
  return setAt(slide, field, items);
}

/** Chèn một bullet trống sau vị trí `index` (tách chữ tại con trỏ nếu có `before/after`). */
export function insertBullet(slide: Slide, field: string, index: number, split?: { before: string; after: string }): Slide {
  const items = [...((getAt(slide, field) as string[] | undefined) ?? [])];
  if (split) {
    items[index] = split.before;
    items.splice(index + 1, 0, split.after);
  } else {
    items.splice(index + 1, 0, "");
  }
  return setBullets(slide, field, items);
}

export function removeBullet(slide: Slide, field: string, index: number): Slide {
  const items = [...((getAt(slide, field) as string[] | undefined) ?? [])];
  items.splice(index, 1);
  return setBullets(slide, field, items);
}

// ---------------------------------------------------------------- biểu đồ & bảng

export function setChartCell(chart: SlideChart, series: number, label: number, value: number): SlideChart {
  return { ...chart, series: chart.series.map((s, si) => (si === series ? { ...s, values: s.values.map((v, i) => (i === label ? value : v)) } : s)) };
}

export function addChartRow(chart: SlideChart, d: DefaultLabels = defaultLabels()): SlideChart {
  return {
    ...chart,
    labels: [...chart.labels, `${d.labelPrefix} ${chart.labels.length + 1}`],
    series: chart.series.map((s) => ({ ...s, values: [...s.values, 0] })),
  };
}

export function removeChartRow(chart: SlideChart, index: number): SlideChart {
  if (chart.labels.length <= 1) return chart;
  return {
    ...chart,
    labels: chart.labels.filter((_, i) => i !== index),
    series: chart.series.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== index) })),
  };
}

export function addChartSeries(chart: SlideChart, d: DefaultLabels = defaultLabels()): SlideChart {
  return { ...chart, series: [...chart.series, { name: `${d.series} ${chart.series.length + 1}`, values: chart.labels.map(() => 0) }] };
}

export function removeChartSeries(chart: SlideChart, index: number): SlideChart {
  if (chart.series.length <= 1) return chart;
  return { ...chart, series: chart.series.filter((_, i) => i !== index) };
}

type Table = NonNullable<Slide["table"]>;

export function addTableRow(table: Table): Table {
  return { ...table, rows: [...table.rows, table.headers.map(() => "")] };
}
export function removeTableRow(table: Table, index: number): Table {
  if (table.rows.length <= 1) return table;
  return { ...table, rows: table.rows.filter((_, i) => i !== index) };
}
export function addTableColumn(table: Table, d: DefaultLabels = defaultLabels()): Table {
  return {
    headers: [...table.headers, `${d.column} ${table.headers.length + 1}`],
    rows: table.rows.map((r) => [...r, ""]),
  };
}
export function removeTableColumn(table: Table, index: number): Table {
  if (table.headers.length <= 1) return table;
  return { headers: table.headers.filter((_, i) => i !== index), rows: table.rows.map((r) => r.filter((_, i) => i !== index)) };
}

export function addColumn(slide: Slide): Slide {
  const cols = slide.columns ?? [];
  if (cols.length >= 3) return slide;
  return { ...slide, columns: [...cols, { heading: "", bullets: [] }] };
}
export function removeColumn(slide: Slide, index: number): Slide {
  const cols = slide.columns ?? [];
  if (cols.length <= 1) return slide;
  return { ...slide, columns: cols.filter((_, i) => i !== index) };
}

// ---------------------------------------------------------------- trích dẫn

export function toggleCitation(slide: Slide, n: number, on: boolean): Slide {
  const set = new Set(slide.citations ?? []);
  if (on) set.add(n);
  else set.delete(n);
  const next = [...set].sort((a, b) => a - b);
  return { ...slide, citations: next.length ? next : undefined };
}
