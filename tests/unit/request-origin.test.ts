import { describe, expect, it } from "vitest";
import { isOriginAllowed, isRequestOriginAllowed, trustedOriginsFromEnv } from "@/lib/request-origin";

const h = (init: Record<string, string>) => new Headers(init);

describe("L-17 · kiểm tra Origin cho request thay đổi trạng thái", () => {
  it("GET/HEAD/OPTIONS luôn qua (OAuth callback cross-site dùng GET)", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(isRequestOriginAllowed(m, h({ "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("Sec-Fetch-Site: chỉ same-origin / none được phép với POST/PATCH/PUT/DELETE", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(isRequestOriginAllowed(m, h({ "sec-fetch-site": "same-origin" }), [])).toBe(true);
      expect(isRequestOriginAllowed(m, h({ "sec-fetch-site": "none" }), [])).toBe(true);
      expect(isRequestOriginAllowed(m, h({ "sec-fetch-site": "same-site" }), [])).toBe(false); // subdomain bị chiếm
      expect(isRequestOriginAllowed(m, h({ "sec-fetch-site": "cross-site" }), [])).toBe(false);
    }
  });

  it("không có Sec-Fetch-Site: không Origin → qua (curl/test); có Origin → phải cùng host hoặc tin cậy", () => {
    expect(isRequestOriginAllowed("POST", h({}), [])).toBe(true);
    expect(isRequestOriginAllowed("POST", h({ origin: "http://app.local:3000", host: "app.local:3000" }), [])).toBe(true);
    expect(isRequestOriginAllowed("POST", h({ origin: "https://evil.example", host: "app.local:3000" }), [])).toBe(false);
    expect(isRequestOriginAllowed("POST", h({ origin: "https://evil.example", host: "app.local:3000" }), ["https://evil.example"])).toBe(true);
    expect(isRequestOriginAllowed("POST", h({ origin: "https://app.example.com", host: "internal:3000", "x-forwarded-host": "app.example.com" }), [])).toBe(true);
    expect(isRequestOriginAllowed("POST", h({ origin: "null", host: "app.local" }), [])).toBe(false);
  });

  it("danh sách tin cậy lấy từ biến môi trường", () => {
    expect(trustedOriginsFromEnv({ BETTER_AUTH_URL: "http://a", NEXT_PUBLIC_APP_URL: " http://b ", TRUSTED_ORIGINS: "http://c, http://d" })).toEqual(["http://a", "http://b", "http://c", "http://d"]);
    expect(isOriginAllowed("http://c", null, ["http://c/"])).toBe(true);
  });
});
