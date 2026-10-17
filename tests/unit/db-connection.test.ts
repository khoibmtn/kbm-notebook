import { describe, expect, it } from "vitest";
import { poolConfigFromUrl } from "@/server/db/connection";

describe("poolConfigFromUrl", () => {
  it("không đổi gì khi không có sslmode (localhost, docker compose)", () => {
    const url = "postgres://kbm:kbm@localhost:5432/kbm_notebook";
    expect(poolConfigFromUrl(url)).toEqual({ connectionString: url });
  });

  it("giữ nguyên URL ổ cắm Unix của Cloud SQL, không bật TLS", () => {
    const url = "postgres://kbm:pw@/kbm_notebook?host=/cloudsql/p:asia-southeast1:kbm-pg";
    expect(poolConfigFromUrl(url)).toEqual({ connectionString: url });
  });

  it("sslmode=require (Supabase): bật TLS không xác minh CA và gỡ tham số khỏi URL", () => {
    const cfg = poolConfigFromUrl("postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require");
    expect(cfg.connectionString).toBe("postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres");
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("gỡ sslmode đúng khi nằm giữa các tham số khác", () => {
    const a = poolConfigFromUrl("postgres://u:p@h/db?sslmode=require&application_name=kbm");
    expect(a.connectionString).toBe("postgres://u:p@h/db?application_name=kbm");
    const b = poolConfigFromUrl("postgres://u:p@h/db?application_name=kbm&sslmode=no-verify");
    expect(b.connectionString).toBe("postgres://u:p@h/db?application_name=kbm");
    expect(b.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("verify-full và disable để nguyên cho pg xử lý", () => {
    const full = "postgres://u:p@h/db?sslmode=verify-full";
    expect(poolConfigFromUrl(full)).toEqual({ connectionString: full });
    const off = "postgres://u:p@h/db?sslmode=disable";
    expect(poolConfigFromUrl(off)).toEqual({ connectionString: off });
  });

  it("tuỳ chọn bổ sung (max) được hợp nhất", () => {
    expect(poolConfigFromUrl("postgres://u:p@h/db?sslmode=require", { max: 3 }).max).toBe(3);
  });
});
