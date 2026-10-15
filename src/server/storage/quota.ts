import "server-only";
import { eq, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { consumeRateLimit, enforceRateLimit, peekRateLimit } from "@/server/api/rate-limit";
import { db } from "@/server/db";
import { files } from "@/server/db/schema";
import { env } from "@/server/env";

const TEN_MIN = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Tổng dung lượng (byte) các tệp đang tính cho sổ tay. */
export async function notebookStorageBytes(notebookId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`coalesce(sum(${files.sizeBytes}), 0)` })
    .from(files)
    .where(eq(files.notebookId, notebookId));
  return Number(row?.n ?? 0);
}

export function notebookQuotaError(): ApiError {
  const mb = env().MAX_NOTEBOOK_STORAGE_MB;
  return new ApiError(
    413,
    "notebook_storage_full",
    `Sổ tay đã đạt giới hạn dung lượng ${mb} MB. Hãy xoá bớt nguồn hoặc tệp đính kèm trước khi tải thêm.`,
  );
}

/** Ném 413 nếu thêm `incomingBytes` sẽ vượt quota của sổ tay (`MAX_NOTEBOOK_STORAGE_MB`). */
export async function assertNotebookQuota(notebookId: string, incomingBytes = 0): Promise<void> {
  const limit = env().MAX_NOTEBOOK_STORAGE_MB * 1024 * 1024;
  const used = await notebookStorageBytes(notebookId);
  if (used + Math.max(0, incomingBytes) > limit) throw notebookQuotaError();
}

const filesKey = (userId: string) => `upload:files:${userId}`;
const kibKey = (userId: string) => `upload:kib:${userId}`;
const kibLimit = () => env().UPLOAD_MAX_MB_PER_HOUR * 1024;

const TOO_MANY_FILES = "Bạn tải lên quá nhiều tệp trong thời gian ngắn. Thử lại sau khoảng {minutes} phút.";
const TOO_MANY_BYTES = "Bạn đã tải lên quá nhiều dung lượng trong một giờ. Thử lại sau khoảng {minutes} phút.";

function limited(message: string, retryAfterSec: number): ApiError {
  return new ApiError(429, "rate_limited", message.replace("{minutes}", String(Math.max(1, Math.ceil(retryAfterSec / 60)))), { retryAfterSec });
}

/**
 * Kiểm tra TRƯỚC khi đọc body: người dùng còn hạn mức tải lên không (số tệp / 10 phút, MB / giờ).
 * `bytesHint` = Content-Length nếu có (đã gồm phần đệm multipart, nên hơi dư).
 */
export async function assertUploadBudget(userId: string, bytesHint?: number): Promise<void> {
  const e = env();
  const f = await peekRateLimit(filesKey(userId), e.UPLOAD_MAX_FILES_PER_10MIN, TEN_MIN);
  if (!f.allowed) throw limited(TOO_MANY_FILES, f.retryAfterSec);
  const b = await peekRateLimit(kibKey(userId), kibLimit(), HOUR);
  const hintKib = bytesHint && Number.isFinite(bytesHint) ? Math.ceil(bytesHint / 1024) : 0;
  if (!b.allowed || b.count + hintKib > kibLimit()) throw limited(TOO_MANY_BYTES, b.retryAfterSec);
}

/** Tính 1 tệp vào hạn mức (gọi trước khi ghi tệp). Ném 429 nếu vượt. */
export async function chargeUploadFile(userId: string): Promise<void> {
  await enforceRateLimit(filesKey(userId), env().UPLOAD_MAX_FILES_PER_10MIN, TEN_MIN, TOO_MANY_FILES);
}

/** Tính dung lượng đã ghi vào hạn mức theo giờ. Ném 429 nếu vượt (người gọi nên xoá tệp vừa ghi). */
export async function chargeUploadBytes(userId: string, bytes: number): Promise<void> {
  const r = await consumeRateLimit(kibKey(userId), kibLimit(), HOUR, Math.ceil(bytes / 1024));
  if (!r.allowed) throw limited(TOO_MANY_BYTES, r.retryAfterSec);
}
