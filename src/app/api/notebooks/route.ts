import { z } from "zod";
import { handleRoute, parseBody, parseQuery } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { createNotebookSchema } from "@/lib/validators/notebooks";
import { createNotebook, listNotebooksForUser } from "@/server/notebooks/service";

export const GET = handleRoute(async (req) => {
  const { user } = await requireUser();
  const { q } = parseQuery(z.object({ q: z.string().max(200).optional() }), req);
  return { notebooks: await listNotebooksForUser(user.id, q) };
});

export const POST = handleRoute(async (req) => {
  const { user } = await requireUser();
  const input = await parseBody(createNotebookSchema, req);
  const notebook = await createNotebook(user.id, input);
  return Response.json({ notebook }, { status: 201 });
});
