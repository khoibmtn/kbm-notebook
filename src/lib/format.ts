import type { Locale } from "@/lib/i18n";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 giờ trước" / "3 hours ago". */
export function formatRelative(date: Date | string, locale: Locale = "vi", now = Date.now()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffSec = Math.round((d.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diffSec) >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(0, "second");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
