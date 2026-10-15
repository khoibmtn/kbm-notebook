import { randomUUID } from "node:crypto";
import { getAuth } from "@/server/auth/auth";

export type TestUser = { id: string; name: string; email: string; cookie: string };

/** Đăng ký + đăng nhập thật qua better-auth; trả cookie session để dựng Request. */
export async function createTestUser(name = "Người dùng thử"): Promise<TestUser> {
  const email = `u-${randomUUID().slice(0, 8)}@test.local`;
  const password = "password-for-tests-123";
  const auth = getAuth();
  const signUp = await auth.api.signUpEmail({ body: { name, email, password } });
  const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const setCookie = headers.getSetCookie();
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  return { id: signUp.user.id, name, email, cookie };
}

type CallOpts = { method?: string; body?: unknown; user?: TestUser | null; query?: string };

/** Dựng Request gọi thẳng route handler. */
export function makeRequest(path: string, opts: CallOpts = {}): Request {
  const headers = new Headers();
  if (opts.user) headers.set("cookie", opts.user.cookie);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://localhost:3000${path}${opts.query ?? ""}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });
