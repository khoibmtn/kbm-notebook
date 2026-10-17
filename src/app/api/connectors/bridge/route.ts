import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { clearBridgeSettings, getConnectorsOverview, saveBridgeSettings } from "@/server/connectors/settings";
import { saveBridgeSchema } from "@/lib/validators/connectors";

/** Lưu URL + token của NotebookLM Bridge (token mã hoá phía server, không bao giờ trả về). */
export const PUT = handleRoute(async (req) => {
  const { user } = await requireUser();
  const input = await parseBody(saveBridgeSchema, req);
  await saveBridgeSettings(user.id, input);
  return { connectors: await getConnectorsOverview(user.id) };
});

/** Xoá cấu hình Bridge của người dùng (các kết nối đã tạo giữ credential đã chụp cho tới khi bị xoá). */
export const DELETE = handleRoute(async () => {
  const { user } = await requireUser();
  await clearBridgeSettings(user.id);
  return { connectors: await getConnectorsOverview(user.id) };
});
