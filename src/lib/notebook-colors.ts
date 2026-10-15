/** 8 màu pastel định sẵn cho thẻ/header notebook (docs/05). */
export const NOTEBOOK_COVER_COLORS = [
  "#dbeafe", // blue
  "#dcfce7", // green
  "#fef3c7", // amber
  "#fee2e2", // red
  "#ede9fe", // violet
  "#fce7f3", // pink
  "#cffafe", // cyan
  "#e5e7eb", // gray
] as const;

export const NOTEBOOK_EMOJIS = ["📓", "📚", "🧪", "🧠", "💡", "📊", "🎓", "🔬", "🌱", "🚀", "⚖️", "🩺"] as const;

export const DEFAULT_COVER_COLOR = NOTEBOOK_COVER_COLORS[0];
export const DEFAULT_EMOJI = NOTEBOOK_EMOJIS[0];
