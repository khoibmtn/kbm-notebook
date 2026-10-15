import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { listBridgeNotebooks } from "@/server/connectors/service";

/** Notebook NotebookLM của người dùng (qua Bridge đã cấu hình) — cho hộp thoại "Kết nối notebook". */
export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  return { notebooks: await listBridgeNotebooks(user.id) };
});
