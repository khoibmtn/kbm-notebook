import { handleRoute, parseBody } from "@/server/api/errors";
import { requireUser } from "@/server/auth/session";
import { clearEnterpriseSettings, getConnectorsOverview, saveEnterpriseSettings } from "@/server/connectors/settings";
import { saveEnterpriseSchema } from "@/lib/validators/connectors";

/** Lưu cấu hình NotebookLM Enterprise (access token hoặc service account JSON mã hoá phía server). */
export const PUT = handleRoute(async (req) => {
  const { user } = await requireUser();
  const input = await parseBody(saveEnterpriseSchema, req);
  await saveEnterpriseSettings(user.id, input);
  return { connectors: await getConnectorsOverview(user.id) };
});

export const DELETE = handleRoute(async () => {
  const { user } = await requireUser();
  await clearEnterpriseSettings(user.id);
  return { connectors: await getConnectorsOverview(user.id) };
});
