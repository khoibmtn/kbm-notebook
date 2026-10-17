import "server-only";
import { ApiError, requestContext } from "@/server/api/errors";
import { getAuth } from "./auth";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  emailVerified: boolean;
};

export type AppSession = {
  user: SessionUser;
  session: { id: string; token: string; expiresAt: Date };
};

async function resolveHeaders(explicit?: Headers): Promise<Headers> {
  if (explicit) return explicit;
  const ctx = requestContext.getStore();
  if (ctx) return ctx.headers;
  // Import lười: module này cũng được nạp bởi custom server (ngoài runtime Next).
  const { headers } = await import("next/headers");
  return headers();
}

/** Lấy session hiện tại (hoặc null). Dùng được trong Server Component, route handler và socket handshake (truyền headers). */
export async function getSession(headers?: Headers): Promise<AppSession | null> {
  const h = await resolveHeaders(headers);
  const result = await getAuth().api.getSession({ headers: h });
  if (!result) return null;
  return result as unknown as AppSession;
}

/** Bắt buộc đăng nhập, nếu không ném ApiError(401). */
export async function requireUser(headers?: Headers): Promise<AppSession> {
  const session = await getSession(headers);
  if (!session) throw ApiError.unauthorized();
  return session;
}
