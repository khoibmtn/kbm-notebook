import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { POST as rawExportRoute } from "@/app/api/artifacts/[artifactId]/export/route";
import { POST as regenerateRoute } from "@/app/api/artifacts/[artifactId]/regenerate/route";
import { POST as aiEditRoute } from "@/app/api/artifacts/[artifactId]/slides/[slideId]/ai-edit/route";
import { POST as rawCreateArtifactRoute } from "@/app/api/notebooks/[id]/artifacts/route";
import { POST as createConversationRoute } from "@/app/api/notebooks/[id]/conversations/route";
import { POST as rawCreateSourceRoute } from "@/app/api/notebooks/[id]/sources/route";
import { addVersion } from "@/server/artifacts/service";
import { ARTIFACT_RATE } from "@/server/artifacts/service";
import { db } from "@/server/db";
import { jobs, rateLimits } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { ingestSource } from "@/server/knowledge/ingest/pipeline";
import { createSourceFromText } from "@/server/knowledge/sources";
import { createNotebookWithMembers, insertArtifact } from "../helpers/fixtures";
import { insertReadySource, parkJobs, SAMPLE_PAGES } from "../helpers/artifacts";
import { json } from "../helpers/team-chat";
import { makeRequest, params } from "../helpers/users";

afterEach(() => {
  delete process.env.MAX_INGEST_TOKENS_PER_DAY;
  resetEnvCache();
});

type Ctx = { params: Promise<{ id: string }> };
async function exportRoute(req: Request, ctx: { params: Promise<{ artifactId: string }> }) {
  const res = await rawExportRoute(req, ctx);
  await db.execute(sql`UPDATE jobs SET run_at = now() + interval '1 day' WHERE status = 'queued' AND payload->>'artifactId' = ${(await ctx.params).artifactId}`);
  return res;
}
async function createSourceRoute(req: Request, ctx: Ctx) {
  const res = await rawCreateSourceRoute(req, ctx);
  await parkJobs((await ctx.params).id);
  return res;
}
async function createArtifactRoute(req: Request, ctx: Ctx) {
  const res = await rawCreateArtifactRoute(req, ctx);
  await parkJobs((await ctx.params).id);
  return res;
}

async function fillUntilLimited(call: () => Promise<Response>, limit: number): Promise<Response> {
  for (let i = 0; i < limit; i++) {
    const res = await call();
    expect(res.status, `lượt ${i + 1}`).not.toBe(429);
  }
  return call();
}

describe("M-7 · hạn mức thao tác tốn tiền / CPU", () => {
  it("tạo lại artifact dùng chung hạn mức với tạo mới (ARTIFACT_RATE, xem rate-limits.test.ts)", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    await insertReadySource(notebook.id, owner.id, { pages: SAMPLE_PAGES });
    await db.insert(rateLimits).values({ key: `artifact:${owner.id}`, windowStart: new Date(), count: ARTIFACT_RATE.limit });
    const art = await insertArtifact(notebook.id, owner.id, { type: "report", status: "ready" });
    const re = await regenerateRoute(makeRequest("/x", { method: "POST", user: owner, body: {} }), params({ artifactId: art.id }));
    expect(re.status).toBe(429);
    expect((await json(re)).error.code).toBe("rate_limited");
  });

  it("sửa slide bằng AI: lần 21 → 429 (kiểm tra hạn mức trước mọi xử lý)", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const art = await insertArtifact(notebook.id, owner.id, { type: "report" });
    const call = () =>
      aiEditRoute(
        makeRequest("/x", { method: "POST", user: owner, body: { instruction: "viết ngắn gọn hơn" } }),
        params({ artifactId: art.id, slideId: "s1" }),
      );
    const limited = await fillUntilLimited(call, 20);
    expect(limited.status).toBe(429);
  });

  it("xuất PDF/PNG: lần 11 → 429; xuất định dạng nhẹ (md) không bị tính", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const art = await insertArtifact(notebook.id, owner.id, { type: "report" });
    await addVersion(art.id, { content: { markdown: "# Tiêu đề\n\nNội dung", evidence: [] }, userId: owner.id, setStatusReady: true });
    const call = (format: string) => () =>
      exportRoute(makeRequest("/x", { method: "POST", user: owner, body: { format } }), params({ artifactId: art.id }));
    const limited = await fillUntilLimited(call("pdf"), 10);
    expect(limited.status).toBe(429);
    expect((await json(limited)).error.message).toMatch(/tối đa 10 lần/);
    expect((await call("md")()).status).toBe(200);
    await db.delete(jobs).where(sql`${jobs.payload}->>'artifactId' = ${art.id}`);
  });

  it("thêm nguồn từ URL: lần 31 → 429", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    // URL YouTube → nguồn 'failed' ngay, không tạo job và không cần DNS
    const call = (i: number) => () =>
      createSourceRoute(
        makeRequest(`/api/notebooks/${notebook.id}/sources`, { method: "POST", user: owner, body: { kind: "url", url: `https://www.youtube.com/watch?v=${i}` } }),
        params({ id: notebook.id }),
      );
    let n = 0;
    const limited = await fillUntilLimited(() => call(n++)(), 30);
    expect(limited.status).toBe(429);
  });

  it("tên mô hình do client gửi phải là tên hợp lệ (không đường dẫn / khoảng trắng)", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const create = (model: string) =>
      createArtifactRoute(makeRequest(`/api/notebooks/${notebook.id}/artifacts`, { method: "POST", user: owner, body: { type: "report", model } }), params({ id: notebook.id }));
    for (const bad of ["../../etc/passwd", "models/x?key=1", "a b", "x".repeat(101)]) expect((await create(bad)).status).toBe(400);
    const conv = await createConversationRoute(makeRequest(`/api/notebooks/${notebook.id}/conversations`, { method: "POST", user: owner, body: {} }), params({ id: notebook.id }));
    expect(conv.status).toBe(201);
  });
});

describe("M-7 · ngân sách token xử lý nguồn mỗi ngày", () => {
  it("vượt MAX_INGEST_TOKENS_PER_DAY: nguồn 'failed' với thông báo rõ; nguồn mới bị từ chối 429", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    process.env.MAX_INGEST_TOKENS_PER_DAY = "100";
    resetEnvCache();
    const first = await createSourceFromText({ notebookId: notebook.id, userId: owner.id, title: "Dài", text: "Quang hợp là quá trình thực vật chuyển hoá ánh sáng. ".repeat(60), visibility: "shared" });
    await expect(ingestSource(first.id)).rejects.toMatchObject({ permanent: true, message: expect.stringMatching(/ngân sách xử lý tài liệu/) });

    const res = await createSourceRoute(
      makeRequest(`/api/notebooks/${notebook.id}/sources`, { method: "POST", user: owner, body: { kind: "text", title: "Mới", text: "nội dung" } }),
      params({ id: notebook.id }),
    );
    expect(res.status).toBe(429);
    expect((await json(res)).error.message).toMatch(/ngân sách xử lý tài liệu/);
    // người dùng khác không bị ảnh hưởng
    const { owner: other, notebook: nb2 } = await createNotebookWithMembers();
    const ok = await createSourceRoute(
      makeRequest(`/api/notebooks/${nb2.id}/sources`, { method: "POST", user: other, body: { kind: "text", title: "Ổn", text: "nội dung" } }),
      params({ id: nb2.id }),
    );
    expect(ok.status).toBe(201);
    await db.delete(jobs).where(sql`${jobs.payload}->>'notebookId' in (${notebook.id}, ${nb2.id})`);
  });
});
