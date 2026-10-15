import { eq } from "drizzle-orm";
import mammoth from "mammoth";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { GET as listArtifacts, POST as createArtifact } from "@/app/api/notebooks/[id]/artifacts/route";
import { DELETE as deleteArtifact, GET as getArtifact, PATCH as patchArtifact } from "@/app/api/artifacts/[artifactId]/route";
import { POST as exportArtifact } from "@/app/api/artifacts/[artifactId]/export/route";
import { GET as listExports } from "@/app/api/artifacts/[artifactId]/exports/route";
import { POST as forkArtifact } from "@/app/api/artifacts/[artifactId]/fork/route";
import { POST as regenerate } from "@/app/api/artifacts/[artifactId]/regenerate/route";
import { PATCH as patchShare } from "@/app/api/artifacts/[artifactId]/share/route";
import { DELETE as deleteShare } from "@/app/api/artifacts/[artifactId]/shares/[shareId]/route";
import { POST as addShare } from "@/app/api/artifacts/[artifactId]/shares/route";
import { GET as listVersions } from "@/app/api/artifacts/[artifactId]/versions/route";
import { POST as restoreVersion } from "@/app/api/artifacts/[artifactId]/versions/[versionId]/restore/route";
import { GET as getShared } from "@/app/api/share/[token]/route";
import { GET as getPrompts } from "@/app/api/settings/prompts/route";
import { registerEngines } from "@/server/artifacts/registry";
import { clearMockJson, registerMockJson, registerMockJsonFn } from "@/server/ai/mock";
import { db } from "@/server/db";
import { artifacts, jobs } from "@/server/db/schema";
import { createExportArtifactHandler } from "@/server/jobs/handlers/export-artifact";
import { createGenerateArtifactHandler } from "@/server/jobs/handlers/generate-artifact";
import { registerJobHandler } from "@/server/jobs/worker";
import type { ArtifactDetailDto, ArtifactDto, ArtifactExportDto, ArtifactListResponse, ArtifactVersionDto } from "@/lib/artifacts/meta";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { insertReadySource, runJobsOfType, SAMPLE_PAGES } from "../helpers/artifacts";
import { createTestUser, makeRequest, params, type TestUser } from "../helpers/users";

const QUIZ_JSON = {
  title: "Kiểm tra tế bào",
  questions: [
    {
      type: "mcq",
      stem: "Bào quan nào tạo ra ATP?",
      options: [
        { key: "A", text: "Ty thể" },
        { key: "B", text: "Ribosome" },
        { key: "C", text: "Lục lạp" },
      ],
      answer: "A",
      explanation: "Ty thể thực hiện hô hấp tế bào [2] và một trích dẫn sai [9].",
      citations: [2, 9],
      difficulty: "easy",
    },
    { type: "tf", stem: "Quang hợp xảy ra ở ty thể.", answer: "sai", explanation: "Xảy ra ở lục lạp.", citations: [1], difficulty: "medium" },
  ],
};

const REPORT_JSON = {
  title: "Báo cáo về tế bào",
  markdown: "# Tế bào\n\nQuang hợp diễn ra ở lục lạp [1]. Ty thể sản xuất ATP [2][7]. Ribosome tổng hợp protein [3, 2].\n\n- Ý một [3]\n- Ý hai không có nguồn [42]",
};

beforeAll(() => {
  registerJobHandler("generate_artifact", createGenerateArtifactHandler());
  registerJobHandler("export_artifact", createExportArtifactHandler());
});
afterEach(() => {
  clearMockJson();
  registerEngines({ slide_deck: null, infographic: null });
});
afterAll(async () => {
  await db.delete(jobs).where(eq(jobs.type, "generate_artifact"));
});

type Ctx = Awaited<ReturnType<typeof setup>>;
async function setup(roles: Array<"viewer" | "editor" | "admin"> = ["viewer", "editor"]) {
  const base = await createNotebookWithMembers(roles);
  const source = await insertReadySource(base.notebook.id, base.owner.id, { title: "Sinh học tế bào", pages: SAMPLE_PAGES, keyTopics: ["quang hợp", "ty thể"] });
  return { ...base, source };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function create(nb: string, user: TestUser, body: Record<string, unknown>) {
  const res = await createArtifact(makeRequest(`/api/notebooks/${nb}/artifacts`, { method: "POST", user, body }), params({ id: nb }));
  return { res, body: await res.clone().json() as { artifact?: ArtifactDto; error?: { code: string } } };
}

async function runGenerate() {
  return runJobsOfType("generate_artifact");
}

async function get(id: string, user: TestUser | null, query = "") {
  const res = await getArtifact(makeRequest(`/api/artifacts/${id}`, { user, query }), params({ artifactId: id }));
  return { res, body: (await res.clone().json()) as { artifact?: ArtifactDetailDto; error?: { code: string } } };
}

async function createReadyQuiz(c: Ctx, user: TestUser = c.owner) {
  registerMockJson("artifact:quiz", QUIZ_JSON);
  const { body } = await create(c.notebook.id, user, { type: "quiz", options: { count: 2 } });
  await runGenerate();
  return body.artifact!;
}

describe("tạo artifact", () => {
  it("viewer không tạo được (403), người lạ nhận 404, chưa đăng nhập 401", async () => {
    const c = await setup();
    const asViewer = await create(c.notebook.id, c.members.viewer, { type: "quiz" });
    expect(asViewer.res.status).toBe(403);
    const stranger = await createTestUser();
    expect((await create(c.notebook.id, stranger, { type: "quiz" })).res.status).toBe(404);
    const anon = await createArtifact(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { method: "POST", body: { type: "quiz" } }), params({ id: c.notebook.id }));
    expect(anon.status).toBe(401);
  });

  it("quiz: queued → job → ready, version 1 đúng schema, trích dẫn được ánh xạ và loại số sai", async () => {
    const c = await setup();
    registerMockJson("artifact:quiz", QUIZ_JSON);
    const { res, body } = await create(c.notebook.id, c.members.editor, { type: "quiz", options: { count: 5, difficulty: "easy" } });
    expect(res.status).toBe(201);
    expect(body.artifact).toMatchObject({ type: "quiz", status: "queued", visibility: "notebook" });

    expect(await runGenerate()).toEqual(["done"]);
    const { body: detail } = await get(body.artifact!.id, c.owner);
    const a = detail.artifact!;
    expect(a.status).toBe("ready");
    expect(a.currentVersionNo).toBe(1);
    // tiêu đề tự đặt lấy từ model vì người dùng không đặt
    expect(a.title).toBe("Kiểm tra tế bào");
    const content = a.content as { questions: Array<{ id: string; type: string; answer: string; citations?: number[] }>; evidence: Array<{ sourceTitle: string; locator: { page?: number } }> };
    expect(content.questions).toHaveLength(2);
    expect(content.questions[0].answer).toBe("A");
    expect(content.questions[1].answer).toBe("false"); // "sai" được chuẩn hoá
    // [2] hợp lệ → số mới 1; [9] không tồn tại → bị loại; câu 2 trích [1] → số mới 2
    expect(content.questions[0].citations).toEqual([1]);
    expect(content.questions[1].citations).toEqual([2]);
    expect(content.evidence).toHaveLength(2);
    expect(content.evidence[0].sourceTitle).toBe("Sinh học tế bào");
    expect(content.evidence[0].locator.page).toBe(2);
    expect(content.evidence[1].locator.page).toBe(1);
  });

  it("report: markdown [n] được chuẩn hoá, trích dẫn sai bị xoá, evidence gọn theo thứ tự dùng", async () => {
    const c = await setup();
    registerMockJson("artifact:report", REPORT_JSON);
    const { body } = await create(c.notebook.id, c.owner, { type: "report", title: "Báo cáo của tôi", customPrompt: "Nhấn mạnh năng lượng" });
    await runGenerate();
    const a = (await get(body.artifact!.id, c.owner)).body.artifact!;
    expect(a.title).toBe("Báo cáo của tôi"); // tên do người dùng đặt được giữ nguyên
    const md = (a.content as { markdown: string }).markdown;
    expect(md).toContain("lục lạp [1].");
    expect(md).toContain("ATP [2].");
    expect(md).not.toMatch(/\[7\]|\[42\]/);
    expect(md).toContain("protein [3][2].");
    expect((a.content as { evidence: unknown[] }).evidence).toHaveLength(3);
    expect(a.generationConfig?.customPrompt).toBe("Nhấn mạnh năng lượng");
  });

  it("không có nguồn ready trong phạm vi → 400 no_sources", async () => {
    const base = await createNotebookWithMembers([]);
    const res = await create(base.notebook.id, base.owner, { type: "report" });
    expect(res.res.status).toBe(400);
    expect(res.body.error?.code).toBe("no_sources");
  });

  it("scope.sourceIds: chỉ dùng nguồn được chọn; nguồn private của người khác bị loại", async () => {
    const c = await setup();
    const other = await insertReadySource(c.notebook.id, c.owner.id, { title: "Nguồn khác", pages: ["Hoá học hữu cơ nghiên cứu hợp chất cacbon và phản ứng của chúng trong cơ thể sống."] });
    const priv = await insertReadySource(c.notebook.id, c.owner.id, { title: "Riêng tư", pages: ["Bí mật riêng tư không được lộ cho người khác biết đến bao giờ cả."], visibility: "private" });
    registerMockJsonFn("artifact:report", (req) => {
      const text = req.messages[req.messages.length - 1].content;
      expect(text).toContain("Nguồn khác");
      expect(text).not.toContain("Sinh học tế bào");
      expect(text).not.toContain("Bí mật riêng tư");
      return { title: "T", markdown: "Hoá hữu cơ [1]." };
    });
    const { body } = await create(c.notebook.id, c.members.editor, { type: "report", scope: { sourceIds: [other.id, priv.id] } });
    expect(await runGenerate()).toEqual(["done"]);
    expect((await get(body.artifact!.id, c.owner)).body.artifact!.status).toBe("ready");
  });

  it("slide_deck/infographic: 501 not_implemented khi chưa có engine, không tạo hàng nào", async () => {
    const c = await setup();
    const before = (await db.select().from(artifacts).where(eq(artifacts.notebookId, c.notebook.id))).length;
    for (const type of ["slide_deck", "infographic"]) {
      const r = await create(c.notebook.id, c.owner, { type });
      expect(r.res.status).toBe(501);
      expect(r.body.error?.code).toBe("not_implemented");
    }
    expect((await db.select().from(artifacts).where(eq(artifacts.notebookId, c.notebook.id))).length).toBe(before);
    const list = await json<ArtifactListResponse>(await listArtifacts(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { user: c.owner }), params({ id: c.notebook.id })));
    expect(list.engines.slide_deck).toBe(false);
    expect(list.engines.quiz).toBe(true);
  });

  it("đường nối registry: engine được tiêm (bản giả của test) được gọi và nội dung được lưu", async () => {
    const c = await setup();
    registerEngines({
      slide_deck: {
        generate: async ({ evidence, options }) => ({
          theme: { palette: "blue", font: "Inter" },
          slides: [{ id: "s1", title: `Slide ${options.slideCount}` }],
          evidence,
        }),
        exportPptx: async () => Buffer.from("PPTX-DOUBLE"),
      },
    });
    const { body } = await create(c.notebook.id, c.owner, { type: "slide_deck", options: { slideCount: 7 } });
    expect(await runGenerate()).toEqual(["done"]);
    const a = (await get(body.artifact!.id, c.owner)).body.artifact!;
    expect(a.status).toBe("ready");
    expect((a.content as { slides: Array<{ title: string }> }).slides[0].title).toBe("Slide 7");
    const exp = await exportArtifact(makeRequest(`/api/artifacts/${a.id}/export`, { method: "POST", user: c.owner, body: { format: "pptx" } }), params({ artifactId: a.id }));
    expect(exp.status).toBe(200);
    const { export: dto } = await json<{ export: ArtifactExportDto }>(exp);
    const file = await getFile(makeRequest(`/api/files/${dto.fileId}`, { user: c.owner }), params({ id: dto.fileId }));
    expect(await file.text()).toBe("PPTX-DOUBLE");
  });

  it("model trả JSON sai schema → thử lại tới hết lượt rồi failed kèm lỗi (không bịa nội dung)", async () => {
    const c = await setup();
    registerMockJson("artifact:quiz", { title: "x", questions: [{ type: "mcq", stem: "?", answer: "Z", explanation: "", citations: [], difficulty: "easy", options: [{ key: "A", text: "a" }, { key: "B", text: "b" }] }] });
    const { body } = await create(c.notebook.id, c.owner, { type: "quiz" });
    // đưa job về lượt cuối để kiểm tra trạng thái failed ngay
    await db.update(jobs).set({ attempts: 2 }).where(eq(jobs.type, "generate_artifact"));
    const outcomes = await runGenerate();
    expect(outcomes[0]).toMatch(/failed|retry/);
    const a = (await get(body.artifact!.id, c.owner)).body.artifact!;
    expect(a.status).toBe("failed");
    expect(a.error).toContain("câu hỏi hợp lệ");
    expect(a.content).toBeNull();
  });
});

describe("quyền xem theo visibility", () => {
  it("private: ẩn với thành viên khác (danh sách + GET 404); chủ vẫn thấy", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c, c.members.editor);
    const set = await patchShare(makeRequest(`/api/artifacts/${art.id}/share`, { method: "PATCH", user: c.members.editor, body: { visibility: "private" } }), params({ artifactId: art.id }));
    expect(set.status).toBe(200);
    expect((await get(art.id, c.members.viewer)).res.status).toBe(404);
    expect((await get(art.id, c.owner)).res.status).toBe(404); // ngay cả owner notebook không thấy artifact private của người khác
    expect((await get(art.id, c.members.editor)).res.status).toBe(200);
    const list = await json<ArtifactListResponse>(await listArtifacts(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { user: c.members.viewer }), params({ id: c.notebook.id })));
    expect(list.artifacts.find((x) => x.id === art.id)).toBeUndefined();
    const own = await json<ArtifactListResponse>(await listArtifacts(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { user: c.members.editor }), params({ id: c.notebook.id })));
    expect(own.artifacts.find((x) => x.id === art.id)).toBeDefined();
  });

  it("notebook: thành viên xem được, người ngoài 404", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    expect((await get(art.id, c.members.viewer)).res.status).toBe(200);
    const stranger = await createTestUser();
    expect((await get(art.id, stranger)).res.status).toBe(404);
    expect((await get(art.id, null)).res.status).toBe(404);
  });

  it("link: token đúng xem được khi chưa đăng nhập, token sai/đã xoay 404; xoay token vô hiệu liên kết cũ", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    const shareRes = await patchShare(makeRequest(`/api/artifacts/${art.id}/share`, { method: "PATCH", user: c.owner, body: { visibility: "link" } }), params({ artifactId: art.id }));
    const token = (await json<{ artifact: ArtifactDetailDto }>(shareRes)).artifact.shareToken!;
    expect(token).toBeTruthy();

    // khách + token qua /api/share/[token]
    const ok = await getShared(makeRequest(`/api/share/${token}`), params({ token }));
    expect(ok.status).toBe(200);
    const shared = (await json<{ artifact: ArtifactDetailDto }>(ok)).artifact;
    expect(shared.id).toBe(art.id);
    expect(shared.shareToken).toBeNull();
    expect(shared.canEdit).toBe(false);
    expect(shared.content).not.toBeNull();
    // khách + token qua GET artifact
    expect((await get(art.id, null, `?token=${token}`)).res.status).toBe(200);
    expect((await get(art.id, null, `?token=sai-token-sai-token-sai`)).res.status).toBe(404);
    expect((await get(art.id, null)).res.status).toBe(404);

    // editor không phải owner: xoay token
    const rotated = await patchShare(makeRequest(`/api/artifacts/${art.id}/share`, { method: "PATCH", user: c.members.editor, body: { visibility: "link", rotateToken: true } }), params({ artifactId: art.id }));
    const token2 = (await json<{ artifact: ArtifactDetailDto }>(rotated)).artifact.shareToken!;
    expect(token2).not.toBe(token);
    expect((await getShared(makeRequest(`/api/share/${token}`), params({ token }))).status).toBe(404);
    expect((await getShared(makeRequest(`/api/share/${token2}`), params({ token: token2 }))).status).toBe(200);

    // đổi về notebook → liên kết ngừng hoạt động
    await patchShare(makeRequest(`/api/artifacts/${art.id}/share`, { method: "PATCH", user: c.owner, body: { visibility: "notebook" } }), params({ artifactId: art.id }));
    expect((await getShared(makeRequest(`/api/share/${token2}`), params({ token: token2 }))).status).toBe(404);
  });

  it("public: chỉ owner sổ tay được đặt; khách xem được không cần token", async () => {
    const c = await setup(["editor", "admin"]);
    const art = await createReadyQuiz(c);
    const byEditor = await patchShare(makeRequest(`/api/artifacts/${art.id}/share`, { method: "PATCH", user: c.members.editor, body: { visibility: "public" } }), params({ artifactId: art.id }));
    expect(byEditor.status).toBe(403);
    const byAdmin = await patchShare(makeRequest(`/api/artifacts/${art.id}/share`, { method: "PATCH", user: c.members.admin, body: { visibility: "public" } }), params({ artifactId: art.id }));
    expect(byAdmin.status).toBe(403);
    const byOwner = await patchShare(makeRequest(`/api/artifacts/${art.id}/share`, { method: "PATCH", user: c.owner, body: { visibility: "public" } }), params({ artifactId: art.id }));
    expect(byOwner.status).toBe(200);
    const anon = await get(art.id, null);
    expect(anon.res.status).toBe(200);
    expect(anon.body.artifact?.canEdit).toBe(false);
    expect(anon.body.artifact?.shareToken).toBeNull();
  });

  it("chia sẻ riêng cho người ngoài sổ tay: xem được (view) / sửa được (edit); thu hồi thì mất quyền", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    await patchShare(makeRequest(`/api/artifacts/${art.id}/share`, { method: "PATCH", user: c.owner, body: { visibility: "private" } }), params({ artifactId: art.id }));
    const guest = await createTestUser("Khách");
    expect((await get(art.id, guest)).res.status).toBe(404);

    const add = await addShare(makeRequest(`/api/artifacts/${art.id}/shares`, { method: "POST", user: c.owner, body: { email: guest.email.toUpperCase(), role: "view" } }), params({ artifactId: art.id }));
    expect(add.status).toBe(201);
    const share = (await json<{ share: { id: string; userId: string } }>(add)).share;
    expect(share.userId).toBe(guest.id);
    const seen = await get(art.id, guest);
    expect(seen.res.status).toBe(200);
    expect(seen.body.artifact?.canEdit).toBe(false);
    const denied = await patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: guest, body: { title: "Đổi" } }), params({ artifactId: art.id }));
    expect(denied.status).toBe(403);

    await addShare(makeRequest(`/api/artifacts/${art.id}/shares`, { method: "POST", user: c.owner, body: { userId: guest.id, role: "edit" } }), params({ artifactId: art.id }));
    const edited = await patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: guest, body: { title: "Khách đổi tên" } }), params({ artifactId: art.id }));
    expect(edited.status).toBe(200);

    const rm = await deleteShare(makeRequest(`/api/artifacts/${art.id}/shares/${share.id}`, { method: "DELETE", user: c.owner }), params({ artifactId: art.id, shareId: share.id }));
    expect(rm.status).toBe(200);
    expect((await get(art.id, guest)).res.status).toBe(404);
  });
});

describe("phiên bản, nhân bản, tạo lại, xoá", () => {
  it("PATCH nội dung tạo phiên bản mới; viewer 403; nội dung sai schema 400; baseVersionId lệch 409", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    const detail = (await get(art.id, c.owner)).body.artifact!;
    const content = structuredClone(detail.content) as { questions: Array<{ stem: string }> };
    content.questions[0].stem = "Câu hỏi đã sửa";

    const asViewer = await patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: c.members.viewer, body: { content } }), params({ artifactId: art.id }));
    expect(asViewer.status).toBe(403);

    const bad = await patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: c.owner, body: { content: { questions: [] , evidence: [] } } }), params({ artifactId: art.id }));
    expect(bad.status).toBe(400);

    const ok = await patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: c.members.editor, body: { content, baseVersionId: detail.currentVersionId } }), params({ artifactId: art.id }));
    expect(ok.status).toBe(200);
    const updated = (await json<{ artifact: ArtifactDetailDto }>(ok)).artifact;
    expect(updated.currentVersionNo).toBe(2);
    expect((updated.content as { questions: Array<{ stem: string }> }).questions[0].stem).toBe("Câu hỏi đã sửa");

    // người thứ hai sửa dựa trên phiên bản cũ → 409
    const stale = await patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: c.owner, body: { content, baseVersionId: detail.currentVersionId } }), params({ artifactId: art.id }));
    expect(stale.status).toBe(409);
    expect((await stale.json() as { error: { code: string } }).error.code).toBe("version_conflict");

    // đổi tên không tạo phiên bản
    const rename = await patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: c.owner, body: { title: "Tên mới" } }), params({ artifactId: art.id }));
    expect((await json<{ artifact: ArtifactDetailDto }>(rename)).artifact.currentVersionNo).toBe(2);
  });

  it("lưu đồng thời không đụng version_no (đánh số tăng dần, không trùng)", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    const detail = (await get(art.id, c.owner)).body.artifact!;
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) => {
        const content = structuredClone(detail.content) as { questions: Array<{ stem: string }> };
        content.questions[0].stem = `Sửa lần ${i}`;
        return patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: c.owner, body: { content } }), params({ artifactId: art.id }));
      }),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const versions = (await json<{ versions: ArtifactVersionDto[] }>(await listVersions(makeRequest(`/api/artifacts/${art.id}/versions`, { user: c.owner }), params({ artifactId: art.id })))).versions;
    expect(versions.map((v) => v.versionNo)).toEqual([5, 4, 3, 2, 1]);
    expect(versions.filter((v) => v.isCurrent)).toHaveLength(1);
    expect(versions[0].isCurrent).toBe(true);
  });

  it("khôi phục tạo phiên bản mới mang nội dung cũ; lịch sử được giữ", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    const first = (await get(art.id, c.owner)).body.artifact!;
    const content = structuredClone(first.content) as { questions: Array<{ stem: string }> };
    content.questions[0].stem = "Bản sửa";
    await patchArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "PATCH", user: c.owner, body: { content } }), params({ artifactId: art.id }));
    const versions = (await json<{ versions: ArtifactVersionDto[] }>(await listVersions(makeRequest(`/api/artifacts/${art.id}/versions`, { user: c.owner }), params({ artifactId: art.id })))).versions;
    const v1 = versions.find((v) => v.versionNo === 1)!;
    const res = await restoreVersion(makeRequest(`/api/artifacts/${art.id}/versions/${v1.id}/restore`, { method: "POST", user: c.owner }), params({ artifactId: art.id, versionId: v1.id }));
    expect(res.status).toBe(200);
    const restored = (await json<{ artifact: ArtifactDetailDto }>(res)).artifact;
    expect(restored.currentVersionNo).toBe(3);
    expect((restored.content as { questions: Array<{ stem: string }> }).questions[0].stem).toBe("Bào quan nào tạo ra ATP?");
    const after = (await json<{ versions: ArtifactVersionDto[] }>(await listVersions(makeRequest(`/api/artifacts/${art.id}/versions`, { user: c.owner }), params({ artifactId: art.id })))).versions;
    expect(after).toHaveLength(3);
    // viewer không khôi phục được
    const viewer = await restoreVersion(makeRequest(`/api/artifacts/${art.id}/versions/${v1.id}/restore`, { method: "POST", user: c.members.viewer }), params({ artifactId: art.id, versionId: v1.id }));
    expect(viewer.status).toBe(403);
  });

  it("nhân bản: artifact mới độc lập, forked_from_id, phiên bản 1 = nội dung hiện tại", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    const res = await forkArtifact(makeRequest(`/api/artifacts/${art.id}/fork`, { method: "POST", user: c.members.editor }), params({ artifactId: art.id }));
    expect(res.status).toBe(201);
    const copy = (await json<{ artifact: ArtifactDetailDto }>(res)).artifact;
    expect(copy.id).not.toBe(art.id);
    expect(copy.forkedFromId).toBe(art.id);
    expect(copy.createdBy).toBe(c.members.editor.id);
    expect(copy.currentVersionNo).toBe(1);
    expect(copy.status).toBe("ready");
    expect(copy.content).toEqual((await get(art.id, c.owner)).body.artifact!.content);
    // sửa bản sao không ảnh hưởng bản gốc
    const content = structuredClone(copy.content) as { questions: Array<{ stem: string }> };
    content.questions[0].stem = "Chỉ bản sao";
    await patchArtifact(makeRequest(`/api/artifacts/${copy.id}`, { method: "PATCH", user: c.members.editor, body: { content } }), params({ artifactId: copy.id }));
    expect(((await get(art.id, c.owner)).body.artifact!.content as { questions: Array<{ stem: string }> }).questions[0].stem).toBe("Bào quan nào tạo ra ATP?");
    expect((await forkArtifact(makeRequest(`/api/artifacts/${art.id}/fork`, { method: "POST", user: c.members.viewer }), params({ artifactId: art.id }))).status).toBe(403);
  });

  it("tạo lại: job mới, status queued rồi ready, phiên bản cũ được giữ, kết quả là phiên bản mới", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    registerMockJson("artifact:quiz", { ...QUIZ_JSON, questions: [{ ...QUIZ_JSON.questions[0], stem: "Câu hỏi sau khi tạo lại" }] });
    const res = await regenerate(makeRequest(`/api/artifacts/${art.id}/regenerate`, { method: "POST", user: c.members.editor, body: { customPrompt: "Khó hơn", options: { difficulty: "hard" } } }), params({ artifactId: art.id }));
    expect(res.status).toBe(202);
    expect((await json<{ artifact: ArtifactDto }>(res)).artifact.status).toBe("queued");
    // đang xếp hàng → từ chối tạo lại lần nữa, từ chối sửa nội dung
    const again = await regenerate(makeRequest(`/api/artifacts/${art.id}/regenerate`, { method: "POST", user: c.owner }), params({ artifactId: art.id }));
    expect(again.status).toBe(409);
    expect(await runGenerate()).toEqual(["done"]);
    const a = (await get(art.id, c.owner)).body.artifact!;
    expect(a.status).toBe("ready");
    expect(a.currentVersionNo).toBe(2);
    expect(a.generationConfig?.customPrompt).toBe("Khó hơn");
    expect((a.content as { questions: Array<{ stem: string }> }).questions[0].stem).toBe("Câu hỏi sau khi tạo lại");
    const versions = (await json<{ versions: ArtifactVersionDto[] }>(await listVersions(makeRequest(`/api/artifacts/${art.id}/versions`, { user: c.owner }), params({ artifactId: art.id })))).versions;
    expect(versions.map((v) => v.versionNo)).toEqual([2, 1]);
  });

  it("xoá mềm: editor xoá được, viewer 403; sau đó 404 ở GET và danh sách", async () => {
    const c = await setup();
    const art = await createReadyQuiz(c);
    expect((await deleteArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "DELETE", user: c.members.viewer }), params({ artifactId: art.id }))).status).toBe(403);
    expect((await deleteArtifact(makeRequest(`/api/artifacts/${art.id}`, { method: "DELETE", user: c.members.editor }), params({ artifactId: art.id }))).status).toBe(200);
    expect((await get(art.id, c.owner)).res.status).toBe(404);
    const list = await json<ArtifactListResponse>(await listArtifacts(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { user: c.owner }), params({ id: c.notebook.id })));
    expect(list.artifacts.find((x) => x.id === art.id)).toBeUndefined();
  });

  it("danh sách: mới nhất trước, lọc theo type/status", async () => {
    const c = await setup();
    const quiz = await createReadyQuiz(c);
    registerMockJson("artifact:report", REPORT_JSON);
    const rep = (await create(c.notebook.id, c.owner, { type: "report" })).body.artifact!;
    const all = await json<ArtifactListResponse>(await listArtifacts(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { user: c.members.viewer }), params({ id: c.notebook.id })));
    expect(all.artifacts.map((a) => a.id)).toEqual([rep.id, quiz.id]);
    const onlyQuiz = await json<ArtifactListResponse>(await listArtifacts(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { user: c.owner, query: "?type=quiz" }), params({ id: c.notebook.id })));
    expect(onlyQuiz.artifacts.map((a) => a.id)).toEqual([quiz.id]);
    const queued = await json<ArtifactListResponse>(await listArtifacts(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { user: c.owner, query: "?status=queued" }), params({ id: c.notebook.id })));
    expect(queued.artifacts.map((a) => a.id)).toEqual([rep.id]);
    await runGenerate();
  });
});

describe("xuất", () => {
  it("docx: trả file id, /api/files/[id] stream đúng content-type, mammoth đọc lại được chữ và mục Nguồn; người lạ 404", async () => {
    const c = await setup();
    registerMockJson("artifact:report", REPORT_JSON);
    const art = (await create(c.notebook.id, c.owner, { type: "report", title: "Báo cáo tế bào" })).body.artifact!;
    await runGenerate();
    const res = await exportArtifact(makeRequest(`/api/artifacts/${art.id}/export`, { method: "POST", user: c.members.viewer, body: { format: "docx" } }), params({ artifactId: art.id }));
    expect(res.status).toBe(200);
    const { export: exp } = await json<{ export: ArtifactExportDto }>(res);
    expect(exp).toMatchObject({ format: "docx", versionNo: 1 });
    expect(exp.fileName).toBe("Báo cáo tế bào.docx");

    const file = await getFile(makeRequest(`/api/files/${exp.fileId}`, { user: c.members.editor }), params({ id: exp.fileId }));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const buf = Buffer.from(await file.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const text = (await mammoth.extractRawText({ buffer: buf })).value;
    expect(text).toContain("Quang hợp diễn ra ở lục lạp [1]");
    expect(text).toContain("Nguồn");
    expect(text).toContain("Sinh học tế bào");

    const stranger = await createTestUser();
    const denied = await getFile(makeRequest(`/api/files/${exp.fileId}`, { user: stranger }), params({ id: exp.fileId }));
    expect(denied.status).toBe(404);

    const list = await json<{ exports: ArtifactExportDto[] }>(await listExports(makeRequest(`/api/artifacts/${art.id}/exports`, { user: c.owner }), params({ artifactId: art.id })));
    expect(list.exports.map((e) => e.format)).toEqual(["docx"]);
  });

  it("csv/md/json/anki cho quiz & thẻ ghi nhớ; định dạng không hợp lệ cho loại → 400", async () => {
    const c = await setup();
    const quiz = await createReadyQuiz(c);
    const doExport = async (id: string, format: string) =>
      exportArtifact(makeRequest(`/api/artifacts/${id}/export`, { method: "POST", user: c.owner, body: { format } }), params({ artifactId: id }));
    const csv = await json<{ export: ArtifactExportDto }>(await doExport(quiz.id, "csv"));
    const csvFile = await getFile(makeRequest(`/api/files/${csv.export.fileId}`, { user: c.owner }), params({ id: csv.export.fileId }));
    const csvBytes = Buffer.from(await csvFile.arrayBuffer());
    expect([...csvBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM để Excel đọc đúng tiếng Việt
    expect(csvBytes.toString("utf8")).toContain("Bào quan nào tạo ra ATP?");
    expect((await doExport(quiz.id, "apkg_tsv")).status).toBe(400);
    expect((await doExport(quiz.id, "pptx")).status).toBe(400);
    expect((await doExport(quiz.id, "json")).status).toBe(200);

    registerMockJson("artifact:flashcards", { title: "Thẻ", cards: [{ front: "Ty thể?", back: "Tạo ATP", tags: ["sinh học", "tế bào"], citations: [2] }] });
    const fc = (await create(c.notebook.id, c.owner, { type: "flashcards" })).body.artifact!;
    await runGenerate();
    const tsv = await json<{ export: ArtifactExportDto }>(await doExport(fc.id, "apkg_tsv"));
    const tsvText = await (await getFile(makeRequest(`/api/files/${tsv.export.fileId}`, { user: c.owner }), params({ id: tsv.export.fileId }))).text();
    expect(tsvText).toContain("Ty thể?\tTạo ATP\tsinh_học tế_bào");
  });

  it("pdf: 202 + job export_artifact → tệp PDF thật, tải được qua /api/files", async () => {
    const c = await setup();
    registerMockJson("artifact:report", REPORT_JSON);
    const art = (await create(c.notebook.id, c.owner, { type: "report", title: "Báo cáo PDF" })).body.artifact!;
    await runGenerate();
    const res = await exportArtifact(makeRequest(`/api/artifacts/${art.id}/export`, { method: "POST", user: c.owner, body: { format: "pdf" } }), params({ artifactId: art.id }));
    expect(res.status).toBe(202);
    const { jobId } = await json<{ jobId: string }>(res);
    const before = await json<{ exports: ArtifactExportDto[]; job: { status: string } | null }>(await listExports(makeRequest(`/api/artifacts/${art.id}/exports`, { user: c.owner, query: `?jobId=${jobId}` }), params({ artifactId: art.id })));
    expect(before.exports).toHaveLength(0);
    expect(before.job?.status).toBe("queued");

    expect(await runJobsOfType("export_artifact")).toEqual(["done"]);
    const after = await json<{ exports: ArtifactExportDto[]; job: { status: string } | null }>(await listExports(makeRequest(`/api/artifacts/${art.id}/exports`, { user: c.owner, query: `?jobId=${jobId}` }), params({ artifactId: art.id })));
    expect(after.job?.status).toBe("done");
    expect(after.exports).toHaveLength(1);
    const file = await getFile(makeRequest(`/api/files/${after.exports[0].fileId}`, { user: c.owner }), params({ id: after.exports[0].fileId }));
    expect(file.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await file.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5_000);
  }, 60_000);

  it("artifact chưa có nội dung → 409; slide_deck pptx khi chưa có engine → 501", async () => {
    const c = await setup();
    registerMockJson("artifact:report", REPORT_JSON);
    const art = (await create(c.notebook.id, c.owner, { type: "report" })).body.artifact!;
    const res = await exportArtifact(makeRequest(`/api/artifacts/${art.id}/export`, { method: "POST", user: c.owner, body: { format: "md" } }), params({ artifactId: art.id }));
    expect(res.status).toBe(409);
    await runGenerate();
  });
});

describe("prompt hiệu lực", () => {
  it("GET /api/settings/prompts trả mặc định + hiệu lực cho từng loại", async () => {
    const u = await createTestUser();
    const res = await getPrompts(makeRequest("/api/settings/prompts", { user: u }), params({}));
    const body = await json<{ prompts: Record<string, unknown>; defaults: Record<string, { system: string }>; effective: Record<string, { system: string; user: string }> }>(res);
    expect(Object.keys(body.effective)).toHaveLength(12); // 11 loại artifact + prompt `chat` của Chat AI
    expect(body.effective.chat.system).toBe(body.defaults.chat.system);
    expect(body.effective.quiz.system).toBe(body.defaults.quiz.system);
    expect(body.effective.report.user).toContain("{{instructions}}");
  });
});
