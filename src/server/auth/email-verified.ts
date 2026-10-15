import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { emailVerificationRequired } from "@/server/env";

/**
 * Email chưa xác minh KHÔNG được dùng làm danh tính (H-4): không khớp lời mời theo email, không tự khớp
 * `artifact_shares.email`, không chấp nhận lời mời bằng liên kết. Tài khoản Google đã được nhà cung cấp xác minh.
 * Khi `AUTH_REQUIRE_EMAIL_VERIFICATION=false` (dev/test) các cổng này mở.
 */

/** Điều kiện SQL: người dùng (bảng `users`, hoặc alias `u`) đủ tin cậy để dùng email làm danh tính. */
export function verifiedEmailCondition(): SQL {
  return emailVerificationRequired() ? sql`${users.emailVerified} = true` : sql`true`;
}

/** Như trên nhưng cho SQL thô dùng alias bảng người dùng (vd. `u`). */
export function verifiedEmailRaw(alias: string): SQL {
  return emailVerificationRequired() ? sql.raw(`${alias}.email_verified = true`) : sql`true`;
}

export function emailVerificationError(): ApiError {
  return new ApiError(
    403,
    "email_not_verified",
    "Bạn cần xác minh địa chỉ email trước. Hãy mở email xác minh đã gửi cho bạn (hoặc bấm “Gửi lại email xác minh”).",
  );
}

/** Người dùng có được dùng email làm danh tính không (đã xác minh, hoặc máy chủ không yêu cầu xác minh)? */
export async function isEmailTrusted(userId: string): Promise<boolean> {
  if (!emailVerificationRequired()) return true;
  const [u] = await db.select({ v: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(u?.v);
}

/** Ném 403 `email_not_verified` nếu chưa đủ tin cậy. */
export async function requireTrustedEmail(userId: string): Promise<void> {
  if (!(await isEmailTrusted(userId))) throw emailVerificationError();
}
