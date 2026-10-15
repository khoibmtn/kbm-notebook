import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as getAi, PUT as putAi } from "@/app/api/settings/ai/route";
import { POST as testAi } from "@/app/api/settings/ai/test/route";
import { GET as getPrompts, PUT as putPrompts } from "@/app/api/settings/prompts/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/settings/profile/route";
import { PUT as putNotifications } from "@/app/api/settings/notifications/route";
import { db } from "@/server/db";
import { userSettings } from "@/server/db/schema";
import { decrypt } from "@/server/crypto";
import { createTestUser, makeRequest } from "../helpers/users";

describe("settings API", () => {
  it("401 khi chưa đăng nhập", async () => {
    expect((await getAi(makeRequest("/api/settings/ai"))).status).toBe(401);
    expect((await testAi(makeRequest("/api/settings/ai/test", { method: "POST" }))).status).toBe(401);
  });

  it("lưu khoá Gemini: mã hoá trong DB, API chỉ trả bản che, xoá được", async () => {
    const u = await createTestUser();
    const key = "AIzaSyTEST-1234567890abcdef";
    const res = await putAi(makeRequest("/api/settings/ai", { method: "PUT", user: u, body: { geminiApiKey: key, defaultChatModel: "gemini-custom" } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Record<string, unknown> };
    expect(body.settings.hasUserKey).toBe(true);
    expect(body.settings.keyMask).toBe("AIza…cdef");
    expect(JSON.stringify(body)).not.toContain(key);
    expect(body.settings.defaultChatModel).toBe("gemini-custom");

    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, u.id));
    expect(row.geminiApiKeyEnc).toBeTruthy();
    expect(row.geminiApiKeyEnc).not.toContain(key);
    expect(decrypt(row.geminiApiKeyEnc!)).toBe(key);

    const removed = await putAi(makeRequest("/api/settings/ai", { method: "PUT", user: u, body: { geminiApiKey: null } }));
    expect(((await removed.json()) as { settings: { hasUserKey: boolean } }).settings.hasUserKey).toBe(false);
    const get = await getAi(makeRequest("/api/settings/ai", { user: u }));
    expect(((await get.json()) as { settings: { defaultChatModel: string } }).settings.defaultChatModel).toBe("gemini-custom");
  });

  it("khoá quá ngắn → 400", async () => {
    const u = await createTestUser();
    const res = await putAi(makeRequest("/api/settings/ai", { method: "PUT", user: u, body: { geminiApiKey: "abc" } }));
    expect(res.status).toBe(400);
  });

  it("POST /ai/test với AI_PROVIDER=mock gọi listModels thật của mock", async () => {
    const u = await createTestUser();
    const res = await testAi(makeRequest("/api/settings/ai/test", { method: "POST", user: u, body: {} }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, provider: "mock", models: ["mock-chat", "mock-embedding"] });
  });

  it("prompts: lưu ghi đè, loại sai → 400, mục rỗng bị bỏ", async () => {
    const u = await createTestUser();
    const put = (prompts: unknown) => putPrompts(makeRequest("/api/settings/prompts", { method: "PUT", user: u, body: { prompts } }));
    expect((await put({ not_a_type: { user: "x" } })).status).toBe(400);
    const ok = await put({ quiz: { user: "Tạo quiz {{instructions}}" }, report: {} });
    expect(ok.status).toBe(200);
    const got = (await (await getPrompts(makeRequest("/api/settings/prompts", { user: u }))).json()) as { prompts: Record<string, unknown> };
    expect(Object.keys(got.prompts)).toEqual(["quiz"]);
  });

  it("profile & notifications", async () => {
    const u = await createTestUser();
    const res = await patchProfile(makeRequest("/api/settings/profile", { method: "PATCH", user: u, body: { name: "Tên mới", title: "Giảng viên", locale: "en", theme: "dark" } }));
    expect(res.status).toBe(200);
    const g = (await (await getProfile(makeRequest("/api/settings/profile", { user: u }))).json()) as { profile: Record<string, unknown> };
    expect(g.profile).toMatchObject({ name: "Tên mới", title: "Giảng viên", locale: "en", theme: "dark", notifyEmail: true });
    expect((await patchProfile(makeRequest("/api/settings/profile", { method: "PATCH", user: u, body: { locale: "fr" } }))).status).toBe(400);
    const n = await putNotifications(makeRequest("/api/settings/notifications", { method: "PUT", user: u, body: { notifyEmail: false } }));
    expect(n.status).toBe(200);
    const g2 = (await (await getProfile(makeRequest("/api/settings/profile", { user: u }))).json()) as { profile: { notifyEmail: boolean } };
    expect(g2.profile.notifyEmail).toBe(false);
  });
});
