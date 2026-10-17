import { afterEach, describe, expect, it } from "vitest";
import { env, placeholderSecretProblems, resetEnvCache } from "@/server/env";

const KEYS = ["NODE_ENV", "APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function set(key: (typeof KEYS)[number], value: string) {
  (process.env as Record<string, string>)[key] = value;
  resetEnvCache();
}
afterEach(() => {
  for (const k of KEYS) (process.env as Record<string, string | undefined>)[k] = saved[k];
  resetEnvCache();
});

describe("M-9 · production từ chối khoá mẫu của .env.example", () => {
  it("nhận diện khoá toàn số 0 và secret 'change-me…'", () => {
    expect(placeholderSecretProblems({ APP_ENCRYPTION_KEY: "0".repeat(64), BETTER_AUTH_SECRET: "change-me-to-a-long-random-string" })).toHaveLength(2);
    expect(placeholderSecretProblems({ APP_ENCRYPTION_KEY: "a".repeat(64), BETTER_AUTH_SECRET: "x".repeat(32) })).toEqual([]);
  });

  it("NODE_ENV=production + khoá mẫu → env() ném lỗi; dev/test vẫn cho phép", () => {
    set("APP_ENCRYPTION_KEY", "0".repeat(64));
    set("NODE_ENV", "development");
    expect(env().APP_ENCRYPTION_KEY).toBe("0".repeat(64));
    set("NODE_ENV", "production");
    expect(() => env()).toThrowError(/khoá mẫu toàn số 0/);
    set("APP_ENCRYPTION_KEY", "ab".repeat(32));
    set("BETTER_AUTH_SECRET", "change-me-to-a-long-random-string");
    expect(() => env()).toThrowError(/change-me/);
    set("BETTER_AUTH_SECRET", "a-real-secret-a-real-secret-0123456789");
    expect(env().BETTER_AUTH_SECRET).toContain("real-secret");
  });
});
