/** Dung lượng tệp dạng đọc được: 1.2 MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Ảnh hiển thị inline được (loại trừ SVG vì có thể chứa script). */
export function isInlineImage(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(mime);
}

/** hh:mm theo giờ cục bộ. */
export function formatClock(iso: string, locale = "vi-VN"): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Nhãn ngày cho dải phân cách: "Hôm nay" / "Hôm qua" / ngày đầy đủ (do bên gọi truyền chuỗi đã dịch). */
export function dayLabel(
  iso: string,
  labels: { today: string; yesterday: string },
  locale = "vi-VN",
  now: Date = new Date(),
): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((start(now) - start(d)) / 86_400_000);
  if (diffDays === 0) return labels.today;
  if (diffDays === 1) return labels.yesterday;
  return d.toLocaleDateString(locale, { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}
