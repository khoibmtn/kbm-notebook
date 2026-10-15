import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { GET as getArtifact, PATCH as patchArtifact } from "@/app/api/artifacts/[artifactId]/route";
import { POST as forkArtifact } from "@/app/api/artifacts/[artifactId]/fork/route";
import { POST as regenerate } from "@/app/api/artifacts/[artifactId]/regenerate/route";
import { PATCH as patchShare } from "@/app/api/artifacts/[artifactId]/share/route";
import { GET as listVersions } from "@/app/api/artifacts/[artifactId]/versions/route";
import { GET as getVersion } from "@/app/api/artifacts/[artifactId]/versions/[versionId]/route";
import { POST as createArtifact } from "@/app/api/notebooks/[id]/artifacts/route";
import { GET as getShared } from "@/app/api/share/[token]/route";
import { clearMockJson, registerMockJson } from "@/server/ai/mock";
import { registerDefaultEngines } from "@/server/artifacts/registry";
import { addVersion, findArtifactByToken, loadArtifactAccess, setVisibility, type GenerateArtifactPayload } from "@/server/artifacts/service";
import { stripPrivateEvidenceText } from "@/server/artifacts/evidence";
import { canViewArtifact } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { artifacts, jobs } from "@/server/db/schema";
import { generateArtifactNow } from "@/server/jobs/handlers/generate-artifact";
import { softDeleteNotebook } from "@/server/notebooks/service";
import type { ArtifactDetailDto, ArtifactDto, ArtifactVersionDto } from "@/lib/artifacts/meta";
import { createNotebookWithMembers, insertArtifact } from "../helpers/fixtures";
import { insertReadySource, parkJobs, SAMPLE_PAGES } from "../helpers/artifacts";
import { makeRequest, params, type TestUser } from "../helpers/users";

const REPORT_JSON = { title: "Báo cáo", markdown: "# Tế bào\n\nQuang hợp diễn ra ở lục lạp [1]. Ty thể sản xuất ATP [2]." };

afterEach(() => {
  clearMockJson();
  registerDefaultEngines();
});

/**
 * Chạy job sinh artifact NGAY trong test (rút job khỏi hàng đợi trước) — không dùng `claimJob` để khỏi tranh job
 * `generate_artifact` với các file test khác đang chạy song song trên cùng DB.
 */
async function runGenerate(artifactId: string): Promise<void> {
  const [job] = await db.select().from(jobs).where(sql`${jobs.type} = 'generate_artifact' and ${jobs.payload}->>'artifactId' = ${artifactId}`);
  if (!job) return; // đã bị worker khác xử lý
  await db.delete(jobs).where(eq(jobs.id, job.id));
  const out = await generateArtifactNow(job.payload as GenerateArtifactPayload, { attempts: 1, maxAttempts: 3 });
  expect(out.ok).toBe(true);
}

async function setup() {
  const base = await createNotebookWithMembers(["viewer", "editor"]);
  const shared = await insertReadySource(base.notebook.id, base.owner.id, { title: "Nguồn chia sẻ", pages: SAMPLE_PAGES });
  return { ...base, shared };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

async function create(c: Ctx, user: TestUser, body: Record<string, unknown>) {
  const res = await createArtifact(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { method: "POST", user, body }), params({ id: c.notebook.id }));
  const parsed = (await res.json()) as { artifact?: ArtifactDto; error?: { code: string; message: string } };
  await parkJobs(c.notebook.id); // job generate_artifact do runGenerate() chạy trực tiếp, không để file test khác nhặt
  return { res, ...parsed };
}
async function detail(id: string, user: TestUser | null, query = "") {
  const res = await getArtifact(makeRequest(`/api/artifacts/${id}`, { user, query }), params({ artifactId: id }));
  return { res, body: (await res.json()) as { artifact?: ArtifactDetailDto; error?: { code: string } } };
}
async function share(id: string, user: TestUser, visibility: string, extra: Record<string, unknown> = {}) {
  const res = await patchShare(makeRequest(`/api/artifacts/${id}/share`, { method: "PATCH", user, body: { visibility, ...extra } }), params({ artifactId: id }));
  return { res, body: (await res.json()) as { artifact?: ArtifactDetailDto; error?: { code: string; message: string } } };
}
const row = async (id: string) => (await db.select().from(artifacts).where(eq(artifacts.id, id)))[0];

describe("H-5 · nguồn riêng tư không lộ qua artifact chia sẻ", () => {
  it("phạm vi mặc định có nguồn riêng tư của người tạo → artifact riêng tư + containsPrivateSources, giữ nguyên văn cho chính họ", async () => {
    const c = await setup();
    const priv = await insertReadySource(c.notebook.id, c.members.editor.id, { title: "Nhật ký riêng", pages: ["Bí mật riêng tư của editor về ty thể."], visibility: "private" });
    registerMockJson("artifact:report", REPORT_JSON);
    const { artifact } = await create(c, c.members.editor, { type: "report", scope: { sourceIds: [priv.id] } });
    expect(artifact).toMatchObject({ visibility: "private", containsPrivateSources: true });
    await runGenerate(artifact!.id);

    const mine = await detail(artifact!.id, c.members.editor);
    expect(mine.body.artifact).toMatchObject({ status: "ready", visibility: "private", containsPrivateSources: true });
    const content = mine.body.artifact!.content as { evidence: { sourceId: string; text: string }[] };
    expect(content.evidence.some((e) => e.sourceId === priv.id && e.text.length > 0)).toBe(true);

    // thành viên khác (và owner) không thấy artifact riêng tư
    expect((await detail(artifact!.id, c.members.viewer)).res.status).toBe(404);
    expect((await detail(artifact!.id, c.owner)).res.status).toBe(404);
  });

  it("không chuyển được sang notebook|link|public (409 + thông báo tiếng Việt); riêng tư thì được; fork vẫn riêng tư", async () => {
    const c = await setup();
    await insertReadySource(c.notebook.id, c.owner.id, { title: "Riêng", pages: ["nội dung riêng"], visibility: "private" });
    registerMockJson("artifact:report", REPORT_JSON);
    const { artifact } = await create(c, c.owner, { type: "report" });
    expect(artifact).toMatchObject({ visibility: "private", containsPrivateSources: true });
    await runGenerate(artifact!.id);

    for (const v of ["notebook", "link", "public"]) {
      const r = await share(artifact!.id, c.owner, v);
      expect(r.res.status).toBe(409);
      expect(r.body.error?.code).toBe("private_sources_not_shareable");
      expect(r.body.error?.message).toMatch(/nguồn riêng tư/);
    }
    expect((await share(artifact!.id, c.owner, "private")).res.status).toBe(200);
    expect((await row(artifact!.id)).visibility).toBe("private");

    const fork = await forkArtifact(makeRequest("/x", { method: "POST", user: c.owner }), params({ artifactId: artifact!.id }));
    expect(fork.status).toBe(201);
    expect(((await fork.json()) as { artifact: ArtifactDto }).artifact).toMatchObject({ visibility: "private", containsPrivateSources: true });
  });

  it("artifact chỉ dùng nguồn chia sẻ: theo mặc định của sổ tay, chia sẻ được; tạo lại KHÔNG kéo nguồn riêng tư vào", async () => {
    const c = await setup();
    registerMockJson("artifact:report", REPORT_JSON);
    // owner có một nguồn riêng tư nhưng chọn tay nguồn chia sẻ
    await insertReadySource(c.notebook.id, c.owner.id, { title: "Riêng của owner", pages: ["bí mật của owner"], visibility: "private" });
    const { artifact } = await create(c, c.owner, { type: "report", scope: { sourceIds: [c.shared.id] } });
    expect(artifact).toMatchObject({ visibility: "notebook", containsPrivateSources: false });
    await runGenerate(artifact!.id);
    expect((await share(artifact!.id, c.owner, "link")).res.status).toBe(200);

    // Tạo lại với phạm vi mặc định (tất cả): nguồn riêng tư bị loại để không làm lộ
    const re = await regenerate(makeRequest("/x", { method: "POST", user: c.owner, body: { scope: { sourceIds: [] } } }), params({ artifactId: artifact!.id }));
    expect(re.status).toBeLessThan(300);
    await parkJobs(c.notebook.id);
    await runGenerate(artifact!.id);
    const after = await detail(artifact!.id, c.owner);
    expect(after.body.artifact).toMatchObject({ visibility: "link", containsPrivateSources: false });
    const ev = (after.body.artifact!.content as { evidence: { sourceTitle: string }[] }).evidence;
    expect(ev.some((e) => e.sourceTitle === "Riêng của owner")).toBe(false);

    // Chọn tay nguồn riêng tư cho artifact đang chia sẻ → 409
    const priv = await insertReadySource(c.notebook.id, c.owner.id, { title: "Riêng 2", pages: ["x"], visibility: "private" });
    const bad = await regenerate(makeRequest("/x", { method: "POST", user: c.owner, body: { scope: { sourceIds: [priv.id] } } }), params({ artifactId: artifact!.id }));
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("private_sources_in_shared_artifact");
  });

  it("stripPrivateEvidenceText chỉ bỏ text của bằng chứng thuộc nguồn riêng tư", () => {
    const content = {
      markdown: "x",
      evidence: [
        { id: "a", sourceId: "p1", sourceTitle: "P", locator: { page: 2 }, text: "bí mật", score: 1 },
        { id: "b", sourceId: "s1", sourceTitle: "S", locator: {}, text: "công khai", score: 1 },
        { id: "c", sourceId: null, sourceTitle: "Web", locator: { url: "https://x" }, text: "web", score: 1 },
      ],
    };
    const out = stripPrivateEvidenceText(content, new Set(["p1"]));
    expect(out.evidence.map((e) => e.text)).toEqual(["", "công khai", "web"]);
    expect(out.evidence[0]).toMatchObject({ id: "a", sourceId: "p1", sourceTitle: "P", locator: { page: 2 } });
    expect(stripPrivateEvidenceText(content, new Set())).toBe(content);
  });
});

describe("H-6 · sổ tay đã xoá mềm thì artifact không còn xem được", () => {
  it("link/public/token/notebook/private đều 404 sau khi xoá sổ tay; ảnh qua ?share= cũng bị chặn", async () => {
    const c = await setup();
    const a = await insertArtifact(c.notebook.id, c.owner.id, { visibility: "notebook" });
    const linked = await setVisibility(a, { role: "owner" }, "link");
    const pub = await insertArtifact(c.notebook.id, c.owner.id, { visibility: "public" });
    expect((await detail(pub.id, null)).res.status).toBe(200);
    expect(await findArtifactByToken(linked.shareToken!)).not.toBeNull();
    expect((await getShared(makeRequest(`/api/share/${linked.shareToken}`), params({ token: linked.shareToken! }))).status).toBe(200);

    await softDeleteNotebook(c.notebook.id);

    expect((await detail(pub.id, null)).res.status).toBe(404);
    expect((await detail(a.id, null, `?token=${linked.shareToken}`)).res.status).toBe(404);
    expect((await detail(a.id, c.owner)).res.status).toBe(404);
    expect(await findArtifactByToken(linked.shareToken!)).toBeNull();
    expect((await getShared(makeRequest(`/api/share/${linked.shareToken}`), params({ token: linked.shareToken! }))).status).toBe(404);
    expect(await canViewArtifact(null, pub)).toBe(false);
    await expect(loadArtifactAccess(c.owner.id, a.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("M-1 · khách chỉ thấy bản hiện tại, không thấy cấu hình sinh / lịch sử", () => {
  it("token và public: generationConfig = null, versions chỉ có bản hiện tại, bản cũ 404; thành viên thấy đủ", async () => {
    const c = await setup();
    const a = await insertArtifact(c.notebook.id, c.owner.id, {
      visibility: "notebook",
      generationConfig: { customPrompt: "prompt riêng tư", scope: { sourceIds: [c.shared.id] }, model: "gemini-x" },
    });
    const v1 = await addVersion(a.id, { content: { markdown: "số liệu nhạy cảm", evidence: [] }, userId: c.owner.id, setStatusReady: true });
    const v2 = await addVersion(a.id, { content: { markdown: "bản đã gỡ số liệu", evidence: [] }, userId: c.owner.id });
    const [fresh] = await db.select().from(artifacts).where(eq(artifacts.id, a.id));
    const linked = await setVisibility(fresh, { role: "owner" }, "link");

    const guest = await detail(a.id, null, `?token=${linked.shareToken}`);
    expect(guest.body.artifact?.generationConfig).toBeNull();
    expect(JSON.stringify(guest.body)).not.toContain("prompt riêng tư");
    expect(JSON.stringify(guest.body)).not.toContain("gemini-x");

    const gv = await listVersions(makeRequest(`/api/artifacts/${a.id}/versions`, { query: `?token=${linked.shareToken}` }), params({ artifactId: a.id }));
    const guestVersions = ((await gv.json()) as { versions: ArtifactVersionDto[] }).versions;
    expect(guestVersions.map((v) => v.id)).toEqual([v2.id]);

    const old = await getVersion(makeRequest(`/api/artifacts/${a.id}/versions/${v1.id}`, { query: `?token=${linked.shareToken}` }), params({ artifactId: a.id, versionId: v1.id }));
    expect(old.status).toBe(404);
    const cur = await getVersion(makeRequest(`/api/artifacts/${a.id}/versions/${v2.id}`, { query: `?token=${linked.shareToken}` }), params({ artifactId: a.id, versionId: v2.id }));
    expect(cur.status).toBe(200);

    // thành viên sổ tay thấy đủ
    const member = await detail(a.id, c.members.viewer);
    expect(member.body.artifact?.generationConfig).toMatchObject({ customPrompt: "prompt riêng tư", model: "gemini-x" });
    const mv = await listVersions(makeRequest(`/api/artifacts/${a.id}/versions`, { user: c.members.viewer }), params({ artifactId: a.id }));
    expect(((await mv.json()) as { versions: ArtifactVersionDto[] }).versions).toHaveLength(2);
    const mold = await getVersion(makeRequest(`/api/artifacts/${a.id}/versions/${v1.id}`, { user: c.members.viewer }), params({ artifactId: a.id, versionId: v1.id }));
    expect(mold.status).toBe(200);

    // artifact public: khách không đăng nhập cũng bị rút gọn
    await setVisibility(await row(a.id), { role: "owner" }, "public");
    const pub = await detail(a.id, null);
    expect(pub.body.artifact?.generationConfig).toBeNull();
  });
});

describe("M-2 · token chia sẻ được thu hồi khi rời link", () => {
  it("link → private → link sinh token MỚI; token cũ hết hiệu lực; rotate đổi token; link → public giữ token", async () => {
    const c = await setup();
    const a = await insertArtifact(c.notebook.id, c.owner.id, { visibility: "notebook" });
    const t1 = (await share(a.id, c.owner, "link")).body.artifact!.shareToken!;
    expect(t1).toBeTruthy();
    // bật lại link khi đang link: giữ token
    expect((await share(a.id, c.owner, "link")).body.artifact!.shareToken).toBe(t1);

    const off = await share(a.id, c.owner, "private");
    expect(off.body.artifact!.shareToken).toBeNull();
    expect((await row(a.id)).shareToken).toBeNull();
    expect(await findArtifactByToken(t1)).toBeNull();

    const t2 = (await share(a.id, c.owner, "link")).body.artifact!.shareToken!;
    expect(t2).not.toBe(t1);
    expect((await detail(a.id, null, `?token=${t1}`)).res.status).toBe(404);
    expect((await detail(a.id, null, `?token=${t2}`)).res.status).toBe(200);

    // notebook → link cũng sinh token mới
    await share(a.id, c.owner, "notebook");
    const t3 = (await share(a.id, c.owner, "link")).body.artifact!.shareToken!;
    expect([t1, t2]).not.toContain(t3);

    const rotated = (await share(a.id, c.owner, "link", { rotateToken: true })).body.artifact!.shareToken!;
    expect(rotated).not.toBe(t3);
  });
});

describe("M-5 · toàn vẹn trích dẫn khi sửa nội dung", () => {
  const ev = (id: string, text: string) => ({ id, provider: "local", sourceId: null, sourceTitle: `Nguồn ${id}`, locator: { page: 1 }, text, score: 1 });
  async function patch(c: Ctx, artifactId: string, content: unknown) {
    const res = await patchArtifact(
      makeRequest(`/api/artifacts/${artifactId}`, { method: "PATCH", user: c.members.editor, body: { content } }),
      params({ artifactId }),
    );
    return { res, body: (await res.json()) as { error?: { code: string; message: string } } };
  }

  it("không thêm/sửa được bằng chứng; chỉ giữ hoặc bỏ bớt; số trích dẫn phải nằm trong danh sách", async () => {
    const c = await setup();
    const a = await insertArtifact(c.notebook.id, c.owner.id, { type: "report", visibility: "notebook" });
    const base = { markdown: "Ý một [1]. Ý hai [2].", evidence: [ev("e1", "nguyên văn một"), ev("e2", "nguyên văn hai")] };
    await addVersion(a.id, { content: base, userId: c.owner.id, setStatusReady: true });

    // sửa chữ trong markdown, giữ nguyên bằng chứng → OK
    expect((await patch(c, a.id, { ...base, markdown: "Ý một đã sửa [1]. Ý hai [2]." })).res.status).toBe(200);

    // trích dẫn giả: sửa nguyên văn của một mục → 400
    const forgedText = await patch(c, a.id, { ...base, evidence: [ev("e1", "NGUYÊN VĂN GIẢ"), base.evidence[1]] });
    expect(forgedText.res.status).toBe(400);
    expect(forgedText.body.error?.code).toBe("evidence_tampered");

    // thêm mục bằng chứng mới → 400
    const added = await patch(c, a.id, { ...base, evidence: [...base.evidence, ev("e3", "mới")] });
    expect(added.body.error?.code).toBe("evidence_tampered");

    // [3] không trỏ tới mục nào → 400
    const badCite = await patch(c, a.id, { ...base, markdown: "Ý ba [3]." });
    expect(badCite.res.status).toBe(400);
    expect(badCite.body.error?.code).toBe("invalid_citation");

    // bỏ bớt một mục và cập nhật markdown cho khớp → OK
    expect((await patch(c, a.id, { markdown: "Chỉ còn ý một [1].", evidence: [base.evidence[0]] })).res.status).toBe(200);
  });

  it("mảng citations có cấu trúc (quiz/slide/…) cũng phải nằm trong danh sách", async () => {
    const c = await setup();
    const a = await insertArtifact(c.notebook.id, c.owner.id, { type: "flashcards", visibility: "notebook" });
    const base = { cards: [{ id: "c1", front: "Hỏi", back: "Đáp", citations: [1] }], evidence: [ev("e1", "nguyên văn")] };
    await addVersion(a.id, { content: base, userId: c.owner.id, setStatusReady: true });
    const bad = await patch(c, a.id, { ...base, cards: [{ id: "c1", front: "Hỏi", back: "Đáp", citations: [1, 5] }] });
    expect(bad.res.status).toBe(400);
    expect(bad.body.error?.code).toBe("invalid_citation");
    expect((await patch(c, a.id, { ...base, cards: [{ id: "c1", front: "Hỏi 2", back: "Đáp", citations: [1] }] })).res.status).toBe(200);
  });
});
