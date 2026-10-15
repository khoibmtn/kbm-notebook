import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { getConnectorsOverview } from "@/server/connectors/settings";

/** Cài đặt kết nối của người dùng (che secret) + trạng thái Google Drive. Không gọi ra ngoài. */
export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  return { connectors: await getConnectorsOverview(user.id) };
});
