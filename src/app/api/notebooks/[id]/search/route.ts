import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { requireNotebookRole } from "@/server/auth/permissions";
import { retrieve } from "@/server/knowledge/retrieve";
import { searchSchema } from "@/lib/validators/sources";

type P = { id: string };

/** Tìm đoạn liên quan trong nguồn của sổ tay (hybrid vector + full-text, RRF). Tôn trọng nguồn riêng tư của người gọi. */
export const POST = handleRoute<P>(async (req, { params }) => {
  const { id } = await params;
  const { user } = await requireUser();
  await requireNotebookRole(user.id, id, "viewer");
  const input = await parseBody(searchSchema, req);
  const evidence = await retrieve({
    query: input.query,
    notebookId: id,
    sourceIds: input.sourceIds,
    topK: input.topK,
    userId: user.id,
  });
  return { evidence };
});
