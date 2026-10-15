import "server-only";

/**
 * IP của client để giới hạn tần suất truy cập chưa xác thực. Phía sau reverse proxy, proxy phải ĐẶT (ghi đè)
 * `X-Forwarded-For` / `X-Real-IP`; nếu không có header nào, mọi khách chung một nhóm "unknown" (an toàn nhưng chặt).
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    // Phần tử cuối do proxy gần nhất thêm vào — khó giả mạo hơn phần tử đầu do client gửi.
    const last = parts[parts.length - 1];
    if (last) return last.slice(0, 64);
  }
  return "unknown";
}
