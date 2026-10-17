import { describe, expect, it } from "vitest";
import { decrypt, encrypt, maskSecret, randomToken } from "@/server/crypto";

describe("crypto AES-256-GCM", () => {
  it("mã hoá rồi giải mã ra đúng bản rõ (kể cả Unicode)", () => {
    const plain = "AIzaSy-khoá-bí-mật-🔑";
    const enc = encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decrypt(enc)).toBe(plain);
  });

  it("mỗi lần mã hoá dùng IV khác nhau", () => {
    expect(encrypt("abc")).not.toBe(encrypt("abc"));
  });

  it("phát hiện dữ liệu bị sửa (GCM auth tag)", () => {
    const [v, iv, tag, data] = encrypt("secret").split(":");
    const tampered = Buffer.from(data, "base64url");
    tampered[0] ^= 0xff;
    expect(() => decrypt([v, iv, tag, tampered.toString("base64url")].join(":"))).toThrow();
  });

  it("từ chối định dạng sai", () => {
    expect(() => decrypt("garbage")).toThrow();
    expect(() => decrypt("v2:a:b:c")).toThrow();
  });

  it("che khoá khi hiển thị", () => {
    expect(maskSecret("AIzaSyABCDEFGH1234")).toBe("AIza…1234");
    expect(maskSecret("short")).toBe("••••");
  });

  it("sinh token ngẫu nhiên an toàn cho URL", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(randomToken());
  });

  it("báo lỗi rõ khi thiếu APP_ENCRYPTION_KEY hợp lệ", () => {
    const old = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = "zz";
    try {
      expect(() => encrypt("x")).toThrow(/APP_ENCRYPTION_KEY/);
    } finally {
      process.env.APP_ENCRYPTION_KEY = old;
    }
  });
});
