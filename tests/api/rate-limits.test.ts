/* eslint-disable @typescript-eslint/no-explicit-any -- phản hồi JSON được kiểm tra bằng expect */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { POST as createArtifact } from "@/app/api/notebooks/[id]/artifacts/route";
import { POST as postComment } from "@/app/api/artifacts/[artifactId]/comments/route";
import { db } from "@/server/db";
import { jobs, rateLimits } from "@/server/db/schema";
import { ARTIFACT_RATE } from "@/server/artifacts/service";
import { MESSAGE_RATE } from "@/server/team-chat/actions";
import { COMMENT_RATE } from "@/server/community/social";
import { insertReadySource, SAMPLE_PAGES } from "../helpers/artifacts";
import { createNotebookWithMembers, insertArtifact } from "../helpers/fixtures";
import { generalChannelId, send } from "../helpers/team-chat";
import { makeRequest, params } from "../helpers/users";

afterAll(async () => {
  await db.delete(jobs).where(eq(jobs.type, "generate_artifact"));
});

describe("giới hạn tần suất (429)", () => {
  it("sinh artifact: 20 lần / 10 phút mỗi người dùng, lần thứ 21 → 429 rate_limited", async () => {
    expect(ARTIFACT_RATE).toEqual({ limit: 20, windowMs: 10 * 60 * 1000 });
    const { notebook, owner, members } = await createNotebookWithMembers(["editor"]);
    await insertReadySource(notebook.id, owner.id, { title: "Nguồn", pages: SAMPLE_PAGES });
    const create = (user: typeof owner) =>
      createArtifact(makeRequest(`/api/notebooks/${notebook.id}/artifacts`, { method: "POST", user, body: { type: "report" } }), params({ id: notebook.id }));

    for (let i = 0; i < ARTIFACT_RATE.limit; i++) {
      const res = await create(owner);
      expect(res.status, `lần ${i + 1}`).toBe(201);
    }
    const blocked = await create(owner);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as any;
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details.retryAfterSec).toBeGreaterThan(0);
    // giới hạn theo từng người dùng: người khác vẫn tạo được
    expect((await create(members.editor)).status).toBe(201);
    // yêu cầu bị từ chối vì dữ liệu sai không tiêu tốn hạn mức
    const bad = await createArtifact(makeRequest(`/api/notebooks/${notebook.id}/artifacts`, { method: "POST", user: members.editor, body: { type: "khong-ton-tai" } }), params({ id: notebook.id }));
    expect(bad.status).toBe(400);
  });

  it("gửi tin nhắn nhóm: 120 tin / phút mỗi người dùng, tin thứ 121 → 429", async () => {
    expect(MESSAGE_RATE).toEqual({ limit: 120, windowMs: 60 * 1000 });
    const { notebook, owner, members } = await createNotebookWithMembers(["editor"]);
    const general = await generalChannelId(owner, notebook.id);
    // Đặt sẵn bộ đếm gần ngưỡng để test không phải gửi 120 tin.
    await db.insert(rateLimits).values({ key: `team-msg:${owner.id}`, windowStart: new Date(), count: MESSAGE_RATE.limit - 1 });
    expect((await send(owner, general, { content: "tin cuối trong hạn mức" })).res.status).toBe(201);
    const blocked = await send(owner, general, { content: "tin vượt hạn mức" });
    expect(blocked.res.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
    // người khác không bị ảnh hưởng
    expect((await send(members.editor, general, { content: "vẫn gửi được" })).res.status).toBe(201);
  });

  it("hết cửa sổ thì được gửi lại", async () => {
    const { notebook, owner } = await createNotebookWithMembers([]);
    const general = await generalChannelId(owner, notebook.id);
    await db.insert(rateLimits).values({ key: `team-msg:${owner.id}`, windowStart: new Date(Date.now() - 2 * 60_000), count: 500 });
    expect((await send(owner, general, { content: "cửa sổ mới" })).res.status).toBe(201);
  });

  it("bình luận: 20 / phút", async () => {
    const { notebook, owner } = await createNotebookWithMembers([]);
    const art = await insertArtifact(notebook.id, owner.id, { visibility: "public" });
    await db.insert(rateLimits).values({ key: `comment:${owner.id}`, windowStart: new Date(), count: COMMENT_RATE.limit });
    const res = await postComment(makeRequest(`/api/artifacts/${art.id}/comments`, { method: "POST", user: owner, body: { body: "quá nhanh" } }), params({ artifactId: art.id }));
    expect(res.status).toBe(429);
  });
});
