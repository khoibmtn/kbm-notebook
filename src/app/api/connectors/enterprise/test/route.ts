import { handleRoute } from "@/server/api/errors";
import { enforceRateLimit } from "@/server/api/rate-limit";
import { requireUser } from "@/server/auth/session";
import { testEnterprise } from "@/server/connectors/service";
import { testEnterpriseSchema } from "@/lib/validators/connectors";

/** "Kiểm tra": gọi `notebooks:listRecentlyViewed` của Discovery Engine v1alpha và trả số notebook THẬT hoặc lỗi thật của Google. */
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
  const parsed = testEnterpriseSchema.safeParse(raw ?? undefined);
  if (!parsed.success) throw parsed.error;
  return testEnterprise(user.id, parsed.data);
});
