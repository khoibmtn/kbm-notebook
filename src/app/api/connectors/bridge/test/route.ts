import { handleRoute } from "@/server/api/errors";
import { enforceRateLimit } from "@/server/api/rate-limit";
import { requireUser } from "@/server/auth/session";
import { testBridge } from "@/server/connectors/service";
import { testBridgeSchema } from "@/lib/validators/connectors";

/**
 * "Kiểm tra kết nối": server gọi `GET /health` của Bridge bằng URL/token đang nhập (hoặc đã lưu) và trả kết quả THẬT
 * (`authenticated`, `account`) hoặc lỗi thật (502 `connector_error`). Không có trạng thái giả.
 */
export const POST = handleRoute(async (req) => {
  const { user } = await requireUser();
  await enforceRateLimit(`connectors:test:${user.id}`, 30, 10 * 60 * 1000, "Bạn kiểm tra kết nối quá nhanh. Thử lại sau khoảng {minutes} phút.");
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
  }
  const parsed = testBridgeSchema.safeParse(raw ?? undefined);
  if (!parsed.success) throw parsed.error;
  return testBridge(user.id, parsed.data);
});
