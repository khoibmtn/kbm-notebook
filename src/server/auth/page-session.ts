import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getSession, type AppSession } from "./session";

/** Dùng trong Server Component/layout: chưa đăng nhập → chuyển tới /login. */
export const requirePageSession = cache(async (nextPath?: string): Promise<AppSession> => {
  const session = await getSession();
  if (!session) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  return session;
});
