import "server-only";
import { enforceRateLimit } from "./rate-limit";

const TEN_MIN = 10 * 60 * 1000;

/**
 * Hạn mức tần suất cho các thao tác tốn tiền / CPU (M-7), tính theo người dùng trong cửa sổ cố định 10 phút
 * (bảng `rate_limits`). Chat hỏi đáp có hạn mức riêng ở `chat/ask.ts`; tạo/tạo lại artifact ở `artifacts/service.ts` (`ARTIFACT_RATE`); tải lên ở `storage/quota.ts`; gửi tin nhắn nhóm / bình luận ở P6.
 */
export const USER_LIMITS = {
  /** Sửa slide bằng AI. */
  aiEdit: { limit: 20, windowMs: TEN_MIN, message: "Bạn sửa bằng AI quá nhanh (tối đa 20 lần mỗi 10 phút). Thử lại sau khoảng {minutes} phút." },
  /** Xuất PDF/PNG/SVG (mỗi lần mở một trình duyệt Chromium). */
  exportHeavy: { limit: 10, windowMs: TEN_MIN, message: "Bạn xuất PDF/ảnh quá nhanh (tối đa 10 lần mỗi 10 phút). Thử lại sau khoảng {minutes} phút." },
  /** Thêm nguồn từ URL (mỗi lần máy chủ tải một trang web). */
  addUrlSource: { limit: 30, windowMs: TEN_MIN, message: "Bạn thêm liên kết quá nhanh (tối đa 30 lần mỗi 10 phút). Thử lại sau khoảng {minutes} phút." },
} as const;

export type UserLimitName = keyof typeof USER_LIMITS;

/** Ném 429 `rate_limited` khi người dùng vượt hạn mức của thao tác `name`. */
export async function enforceUserLimit(name: UserLimitName, userId: string): Promise<void> {
  const cfg = USER_LIMITS[name];
  await enforceRateLimit(`limit:${name}:${userId}`, cfg.limit, cfg.windowMs, cfg.message);
}
