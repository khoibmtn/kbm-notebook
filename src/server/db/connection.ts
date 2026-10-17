import type { PoolConfig } from "pg";

/**
 * Cấu hình `pg.Pool` từ `DATABASE_URL`, có xử lý TLS cho nhà cung cấp Postgres đám mây (Supabase, Neon, …).
 *
 * - `sslmode=require` / `no-verify` / `ssl=true`: BẬT TLS nhưng KHÔNG xác minh chuỗi chứng chỉ
 *   (`rejectUnauthorized: false`) — giống libpq `require`. Lý do: Supabase dùng CA riêng nên `pg` (coi `require`
 *   như `verify-full`) sẽ lỗi `SELF_SIGNED_CERT_IN_CHAIN`. Tham số được gỡ khỏi chuỗi kết nối để `pg` không ghi đè.
 * - `sslmode=disable` hoặc không có tham số (kể cả ổ cắm Unix `?host=/cloudsql/…`): không TLS như trước.
 * - `verify-ca` / `verify-full`: giữ nguyên, để `pg` tự xử lý (xác minh đầy đủ).
 * Tách riêng, không import `server-only`, để dùng chung cho app và script migrate.
 */
export function poolConfigFromUrl(connectionString: string, extra: PoolConfig = {}): PoolConfig {
  const m = /[?&](sslmode|ssl)=([^&]*)/i.exec(connectionString);
  const mode = m ? decodeURIComponent(m[2]).toLowerCase() : "";
  const relaxed = mode === "require" || mode === "no-verify" || (m?.[1].toLowerCase() === "ssl" && (mode === "true" || mode === "1"));
  if (!relaxed) return { connectionString, ...extra };
  // Gỡ sslmode/ssl khỏi chuỗi (giữ nguyên phần còn lại của URL).
  const stripped = connectionString
    .replace(/([?&])(sslmode|ssl)=[^&]*&/gi, "$1")
    .replace(/[?&](sslmode|ssl)=[^&]*$/gi, "");
  return { connectionString: stripped, ssl: { rejectUnauthorized: false }, ...extra };
}
