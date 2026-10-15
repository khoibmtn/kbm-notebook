import { handleRoute, parseBody } from "@/server/api/errors";
import { requireNotebookRole } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";
import { generateUniqueNotebookSlug, setNotebookPublic } from "@/server/community/public-notebooks";
import { getNotebook } from "@/server/notebooks/service";
import { publishNotebookSchema } from "@/lib/validators/community";

type P = { id: string };

/** Trạng thái công khai hiện tại + slug gợi ý (từ tiêu đề) khi chưa có. Chỉ chủ sổ tay. */
export const GET = handleRoute<P>(async (_req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "owner");
  const nb = await getNotebook(id);
  const suggestedSlug = nb.publicSlug ?? (await generateUniqueNotebookSlug(nb.title, nb.id));
  return { isPublic: nb.isPublic, slug: nb.publicSlug, suggestedSlug };
});

/** Bật/tắt công khai sổ tay và đặt slug (chỉ chủ sở hữu). Công khai chỉ lộ tiêu đề, mô tả, emoji và artifact công khai. */
export const PATCH = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "owner");
  const input = await parseBody(publishNotebookSchema, req);
  const nb = await setNotebookPublic(await getNotebook(id), input);
  return { isPublic: nb.isPublic, slug: nb.publicSlug };
});
