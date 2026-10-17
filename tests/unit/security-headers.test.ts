import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { GLOBAL_SECURITY_HEADERS, securityHeaders } from "@/lib/security-headers";

describe("M-14 · header bảo mật", () => {
  it("next.config cấu hình headers() toàn cục: chống clickjacking, nosniff, Referrer-Policy, Permissions-Policy", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual(securityHeaders());
    const global = rules.find((r) => r.source === "/:path*")!;
    const map = Object.fromEntries(global.headers.map((h) => [h.key, h.value]));
    expect(map["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(map["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(map["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
    expect(map["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(map["Permissions-Policy"]).toContain("camera=()");
    expect(GLOBAL_SECURITY_HEADERS.length).toBe(global.headers.length);
  });

  it("trang chia sẻ (token trong URL) không gửi Referer", () => {
    for (const source of ["/s/:path*", "/a/:path*", "/invite/:path*"]) {
      const rule = securityHeaders().find((r) => r.source === source)!;
      expect(rule.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
  });
});
