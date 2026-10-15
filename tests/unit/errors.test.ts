import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, handleRoute, parseBody } from "@/server/api/errors";
import { AiNotConfiguredError, AiProviderError } from "@/server/ai/provider";

const req = (body?: string) => new Request("http://x.test/api", { method: "POST", body, headers: { "content-type": "application/json" } });

async function body(res: Response) {
  return (await res.json()) as { error?: { code: string; message: string }; [k: string]: unknown };
}

describe("handleRoute", () => {
  it("bọc object thành JSON 200", async () => {
    const res = await handleRoute(async () => ({ hello: "world" }))(req());
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ hello: "world" });
  });

  it("ApiError → { error: { code, message } } đúng status", async () => {
    const res = await handleRoute(async () => {
      throw ApiError.forbidden("cấm");
    })(req());
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ error: { code: "forbidden", message: "cấm" } });
  });

  it("ZodError → 400 validation_error", async () => {
    const schema = z.object({ title: z.string().min(3) });
    const res = await handleRoute(async (r) => parseBody(schema, r))(req(JSON.stringify({ title: "a" })));
    expect(res.status).toBe(400);
    expect((await body(res)).error?.code).toBe("validation_error");
  });

  it("JSON hỏng → 400 invalid_json", async () => {
    const res = await handleRoute(async (r) => parseBody(z.object({}), r))(req("{not json"));
    expect(res.status).toBe(400);
    expect((await body(res)).error?.code).toBe("invalid_json");
  });

  it("AiNotConfiguredError → 412", async () => {
    const res = await handleRoute(async () => {
      throw new AiNotConfiguredError();
    })(req());
    expect(res.status).toBe(412);
    expect((await body(res)).error?.code).toBe("ai_not_configured");
  });

  it("AiProviderError: 429 giữ nguyên, 4xx khác → 400, còn lại → 502", async () => {
    const mk = (s: number | null) =>
      handleRoute(async () => {
        throw new AiProviderError("x", s);
      })(req());
    expect((await mk(429)).status).toBe(429);
    expect((await mk(403)).status).toBe(400);
    expect((await mk(null)).status).toBe(502);
  });

  it("lỗi lạ → 500 không lộ chi tiết", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleRoute(async () => {
      throw new Error("mật khẩu db là abc");
    })(req());
    expect(res.status).toBe(500);
    const b = await body(res);
    expect(b.error?.code).toBe("internal_error");
    expect(JSON.stringify(b)).not.toContain("mật khẩu");
    spy.mockRestore();
  });
});
