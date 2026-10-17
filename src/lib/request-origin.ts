/**
 * Kiểm tra nguồn gốc (Origin) của request thay đổi trạng thái — lớp phòng thủ thêm ngoài cookie `SameSite=Lax`
 * (L-17: subdomain bị chiếm / site cùng "site" gửi POST text/plain chứa JSON). Hàm thuần, dùng được ở proxy và socket.
 *
 * Quy tắc cho phương thức không an toàn (POST/PUT/PATCH/DELETE):
 * - `Sec-Fetch-Site: cross-site | same-site` → từ chối; `same-origin | none` → cho phép.
 * - Không có Sec-Fetch-Site (client không phải trình duyệt hiện đại): không có `Origin` → cho phép (curl, test, server-to-server);
 *   có `Origin` → phải cùng host với request hoặc nằm trong danh sách tin cậy.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function trustedOriginsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const list = [env.BETTER_AUTH_URL, env.NEXT_PUBLIC_APP_URL, ...(env.TRUSTED_ORIGINS ? env.TRUSTED_ORIGINS.split(",") : [])];
  return list.map((o) => o?.trim()).filter((o): o is string => Boolean(o));
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** `Origin` có cùng host với request hoặc nằm trong danh sách tin cậy không? */
export function isOriginAllowed(origin: string, host: string | null, trusted: string[]): boolean {
  const o = originOf(origin);
  if (!o) return false;
  if (host && new URL(o).host === host) return true;
  return trusted.some((t) => originOf(t) === o);
}

export function isRequestOriginAllowed(
  method: string,
  headers: { get(name: string): string | null },
  trusted: string[] = trustedOriginsFromEnv(),
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = headers.get("origin");
  if (!origin) return true;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  return isOriginAllowed(origin, host, trusted);
}
