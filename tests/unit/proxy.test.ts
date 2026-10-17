import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const req = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

describe("M-15 · proxy không tạo vòng lặp redirect với cookie cũ", () => {
  it("/login và /register đi tiếp dù có cookie phiên (cookie có thể đã hết hạn phía DB); trang tự xác thực session thật", () => {
    for (const path of ["/login", "/register"]) {
      const res = proxy(req(path, "better-auth.session_token=stale.value"));
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).toBe(200);
    }
  });

  it("route của (app) không có cookie → chuyển về /login?next=…; có cookie thì đi tiếp", () => {
    const res = proxy(req("/n/abc?tab=chat"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/n/abc?tab=chat");
    expect(proxy(req("/n/abc", "better-auth.session_token=x.y")).headers.get("location")).toBeNull();
  });
});
