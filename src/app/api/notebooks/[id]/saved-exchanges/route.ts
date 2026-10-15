import { handleRoute } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { listSavedExchanges } from "@/server/chat/saved";

type P = { id: string };

/** Các cặp hỏi-đáp người gọi đã lưu trong sổ tay (mới nhất trước). */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  return { exchanges: await listSavedExchanges(id, user.id) };
});
