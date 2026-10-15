import "server-only";
import { consumeRateLimit, peekRateLimit } from "@/server/api/rate-limit";
import { ApiError } from "@/server/api/errors";
import { env } from "@/server/env";
import { IngestError } from "./errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const key = (userId: string) => `ingest-tokens:${userId}`;

function message(retryAfterSec: number): string {
  const hours = Math.max(1, Math.ceil(retryAfterSec / 3600));
  return `Bạn đã dùng hết ngân sách xử lý tài liệu trong ngày (${env().MAX_INGEST_TOKENS_PER_DAY.toLocaleString("vi-VN")} token). Thử lại sau khoảng ${hours} giờ.`;
}

/** Trước khi nhận nguồn mới: nếu ngân sách ngày đã cạn → 429 (không tạo nguồn). */
export async function assertIngestBudget(userId: string): Promise<void> {
  const r = await peekRateLimit(key(userId), env().MAX_INGEST_TOKENS_PER_DAY, DAY_MS);
  if (!r.allowed) throw new ApiError(429, "rate_limited", message(r.retryAfterSec), { retryAfterSec: r.retryAfterSec });
}

/**
 * Tính `tokens` (ước lượng token của văn bản sắp embedding/tóm tắt) vào ngân sách ngày của người tạo nguồn.
 * Vượt ngân sách → `IngestError` vĩnh viễn: nguồn chuyển `failed` với thông báo rõ ràng (khoá Gemini của server không bị đốt).
 */
export async function chargeIngestTokens(userId: string, tokens: number): Promise<void> {
  const r = await consumeRateLimit(key(userId), env().MAX_INGEST_TOKENS_PER_DAY, DAY_MS, Math.max(1, Math.ceil(tokens)));
  if (!r.allowed) throw new IngestError(message(r.retryAfterSec));
}
