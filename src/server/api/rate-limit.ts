import "server-only";
import { sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";

export type RateLimitResult = { allowed: boolean; count: number; limit: number; retryAfterSec: number };

/**
 * Giới hạn tần suất theo cửa sổ cố định, lưu ở bảng `rate_limits` (docs/02 §5).
 * Một câu lệnh upsert nguyên tử: hết cửa sổ thì đặt lại về 1, ngược lại tăng 1.
 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number, amount = 1): Promise<RateLimitResult> {
  const windowSec = Math.max(1, Math.round(windowMs / 1000));
  const inc = Math.max(1, Math.floor(amount));
  const res = await db.execute<{ count: number; retry_after: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), ${inc})
    ON CONFLICT (key) DO UPDATE SET
      window_start = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => ${windowSec}) THEN now() ELSE rate_limits.window_start END,
      count = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => ${windowSec}) THEN ${inc} ELSE rate_limits.count + ${inc} END
    RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => ${windowSec}) - now()))))::int AS retry_after
  `);
  const row = res.rows[0];
  const count = Number(row.count);
  return { allowed: count <= limit, count, limit, retryAfterSec: Number(row.retry_after) };
}

/** Xem mức đã dùng trong cửa sổ hiện tại mà KHÔNG tăng bộ đếm (0 nếu chưa có / đã hết cửa sổ). */
export async function peekRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const windowSec = Math.max(1, Math.round(windowMs / 1000));
  const res = await db.execute<{ count: number; retry_after: number }>(sql`
    SELECT count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => ${windowSec}) - now()))))::int AS retry_after
    FROM rate_limits
    WHERE key = ${key} AND window_start > now() - make_interval(secs => ${windowSec})
  `);
  const row = res.rows[0];
  if (!row) return { allowed: true, count: 0, limit, retryAfterSec: 0 };
  const count = Number(row.count);
  return { allowed: count < limit, count, limit, retryAfterSec: Number(row.retry_after) };
}

/** Như `consumeRateLimit` nhưng ném 429 `rate_limited` khi vượt ngưỡng. `{minutes}` trong message được thay bằng số phút chờ. */
export async function enforceRateLimit(key: string, limit: number, windowMs: number, message: string, amount = 1): Promise<void> {
  const r = await consumeRateLimit(key, limit, windowMs, amount);
  if (!r.allowed) {
    throw new ApiError(429, "rate_limited", message.replace("{minutes}", String(Math.ceil(r.retryAfterSec / 60))), {
      retryAfterSec: r.retryAfterSec,
    });
  }
}
