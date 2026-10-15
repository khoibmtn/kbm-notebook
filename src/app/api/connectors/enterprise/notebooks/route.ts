import { handleRoute } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { listEnterpriseNotebooks } from "@/server/connectors/service";

/** Notebook NotebookLM Enterprise (`notebooks:listRecentlyViewed`) của người dùng. */
export const GET = handleRoute(async () => {
  const { user } = await requireUser();
  return { notebooks: await listEnterpriseNotebooks(user.id) };
});
