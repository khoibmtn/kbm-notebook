import type { SlideTheme } from "./types";

/** Bảng màu dùng chung cho slide + infographic. Mọi màu là hex 6 ký tự, có `#`. */
export type PaletteTokens = {
  /** Màu nhấn chính (thanh nhấn, nền section, cột biểu đồ). */
  primary: string;
  /** Màu nền tối cho slide mở đầu/kết thúc. */
  dark: string;
  /** Màu nhấn sáng hơn (trên nền tối, series phụ). */
  accent: string;
  /** Nền nhạt của thẻ/ô. */
  soft: string;
  /** Màu đường viền nhạt. */
  line: string;
  /** Màu tiêu đề trên nền sáng (đủ tương phản). */
  heading: string;
  /** Màu chữ thân bài. */
  ink: string;
  /** Màu chữ phụ. */
  muted: string;
  /** Dãy màu cho biểu đồ. */
  series: string[];
};

export const PALETTES: Record<SlideTheme["palette"], PaletteTokens> = {
  indigo: {
    primary: "#4f46e5",
    dark: "#1e1b4b",
    accent: "#a5b4fc",
    soft: "#eef2ff",
    line: "#c7d2fe",
    heading: "#312e81",
    ink: "#1e293b",
    muted: "#64748b",
    series: ["#4f46e5", "#06b6d4", "#f59e0b", "#ec4899", "#10b981", "#8b5cf6", "#ef4444", "#64748b"],
  },
  emerald: {
    primary: "#059669",
    dark: "#022c22",
    accent: "#6ee7b7",
    soft: "#ecfdf5",
    line: "#a7f3d0",
    heading: "#064e3b",
    ink: "#1e293b",
    muted: "#64748b",
    series: ["#059669", "#0ea5e9", "#f59e0b", "#e11d48", "#6366f1", "#14b8a6", "#a855f7", "#64748b"],
  },
  rose: {
    primary: "#e11d48",
    dark: "#4c0519",
    accent: "#fda4af",
    soft: "#fff1f2",
    line: "#fecdd3",
    heading: "#881337",
    ink: "#1e293b",
    muted: "#64748b",
    series: ["#e11d48", "#6366f1", "#f59e0b", "#0ea5e9", "#10b981", "#a855f7", "#f97316", "#64748b"],
  },
  amber: {
    primary: "#b45309",
    dark: "#451a03",
    accent: "#fcd34d",
    soft: "#fffbeb",
    line: "#fde68a",
    heading: "#78350f",
    ink: "#1e293b",
    muted: "#64748b",
    series: ["#d97706", "#0369a1", "#059669", "#be123c", "#6d28d9", "#0d9488", "#ea580c", "#64748b"],
  },
  slate: {
    primary: "#475569",
    dark: "#0f172a",
    accent: "#cbd5e1",
    soft: "#f1f5f9",
    line: "#cbd5e1",
    heading: "#0f172a",
    ink: "#1e293b",
    muted: "#64748b",
    series: ["#334155", "#0ea5e9", "#f59e0b", "#10b981", "#e11d48", "#8b5cf6", "#14b8a6", "#94a3b8"],
  },
  ocean: {
    primary: "#0284c7",
    dark: "#082f49",
    accent: "#7dd3fc",
    soft: "#f0f9ff",
    line: "#bae6fd",
    heading: "#0c4a6e",
    ink: "#1e293b",
    muted: "#64748b",
    series: ["#0284c7", "#f59e0b", "#10b981", "#e11d48", "#6366f1", "#14b8a6", "#f97316", "#64748b"],
  },
};

export type FontTokens = {
  /** Tên font trong PPTX. */
  face: string;
  /** font-family CSS (có dự phòng). */
  css: string;
  /** Hệ số ước lượng bề rộng ký tự trung bình (× cỡ chữ). */
  charWidth: number;
};

export const FONTS: Record<SlideTheme["font"], FontTokens> = {
  Inter: { face: "Inter", css: `Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif`, charWidth: 0.56 },
  Roboto: { face: "Roboto", css: `Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif`, charWidth: 0.54 },
  Georgia: { face: "Georgia", css: `Georgia, "Times New Roman", "DejaVu Serif", serif`, charWidth: 0.55 },
  Arial: { face: "Arial", css: `Arial, "Liberation Sans", Helvetica, sans-serif`, charWidth: 0.55 },
};

export function paletteOf(theme: Pick<SlideTheme, "palette">): PaletteTokens {
  return PALETTES[theme.palette] ?? PALETTES.indigo;
}

export function fontOf(theme: Pick<SlideTheme, "font">): FontTokens {
  return FONTS[theme.font] ?? FONTS.Inter;
}

/** Hex không `#` (cho pptxgenjs). */
export function noHash(hex: string): string {
  return hex.replace(/^#/, "").toUpperCase();
}

/** Màu chữ đọc được trên nền `bg` (đen/trắng theo độ sáng tương đối). */
export function readableOn(bg: string): string {
  const h = bg.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.45 ? "#0f172a" : "#ffffff";
}
