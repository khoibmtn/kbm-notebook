import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { GET as getArtifact } from "@/app/api/artifacts/[artifactId]/route";
import { POST as exportArtifact } from "@/app/api/artifacts/[artifactId]/export/route";
import { POST as uploadImage } from "@/app/api/artifacts/[artifactId]/images/route";
import { POST as aiEdit } from "@/app/api/artifacts/[artifactId]/slides/[slideId]/ai-edit/route";
import { PATCH as patchArtifact } from "@/app/api/artifacts/[artifactId]/route";
import { POST as createArtifact } from "@/app/api/notebooks/[id]/artifacts/route";
import { registerDefaultEngines, registerEngines, type SlideDeckContent } from "@/server/artifacts/registry";
import { exportSlideDeckPptx } from "@/server/artifacts/slides/export-pptx";
import { db } from "@/server/db";
import { artifactVersions, files, jobs } from "@/server/db/schema";
import { createExportArtifactHandler } from "@/server/jobs/handlers/export-artifact";
import { createGenerateArtifactHandler } from "@/server/jobs/handlers/generate-artifact";
import { registerJobHandler } from "@/server/jobs/worker";
import type { ArtifactDetailDto, ArtifactDto, ArtifactExportDto } from "@/lib/artifacts/meta";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { insertReadySource, runJobsOfType } from "../helpers/artifacts";
import { createTestUser, makeRequest, params, type TestUser } from "../helpers/users";

/** 1×1 PNG hợp lệ. */
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const PAGES = Array.from(
  { length: 14 },
  (_, i) =>
    `Chủ đề số ${i + 1}: tế bào thực hiện chức năng thứ ${i + 1} trong cơ thể sống. Đây là câu thứ hai nói về quá trình ${i + 1} và vai trò của nó đối với sự sống.`,
);

beforeAll(() => {
  registerJobHandler("generate_artifact", createGenerateArtifactHandler());
  registerJobHandler("export_artifact", createExportArtifactHandler());
});
afterEach(() => registerDefaultEngines());
afterAll(async () => {
  await db.delete(jobs).where(eq(jobs.type, "generate_artifact"));
});

async function setup() {
  const base = await createNotebookWithMembers(["viewer", "editor"]);
  const source = await insertReadySource(base.notebook.id, base.owner.id, { title: "Sinh học tế bào", pages: PAGES });
  return { ...base, source };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

async function create(c: Ctx, user: TestUser, body: Record<string, unknown>) {
  const res = await createArtifact(makeRequest(`/api/notebooks/${c.notebook.id}/artifacts`, { method: "POST", user, body }), params({ id: c.notebook.id }));
  return { res, artifact: ((await res.json()) as { artifact: ArtifactDto }).artifact };
}
async function detail(id: string, user: TestUser) {
  const res = await getArtifact(makeRequest(`/api/artifacts/${id}`, { user }), params({ artifactId: id }));
  return ((await res.json()) as { artifact: ArtifactDetailDto }).artifact;
}
async function exportAs(id: string, user: TestUser, format: string) {
  const res = await exportArtifact(makeRequest(`/api/artifacts/${id}/export`, { method: "POST", user, body: { format } }), params({ artifactId: id }));
  return res;
}
async function fileBytes(dto: ArtifactExportDto, user: TestUser): Promise<Buffer> {
  const res = await getFile(makeRequest(`/api/files/${dto.fileId}`, { user }), params({ id: dto.fileId }));
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

describe("slide_deck với engine thật (provider mock)", () => {
  it("tạo → job → ready ≥ 10 slide; xuất PPTX giải nén được và slide1.xml chứa tiêu đề", async () => {
    const c = await setup();
    const { res, artifact } = await create(c, c.members.editor, { type: "slide_deck", options: { slideCount: 12 } });
    expect(res.status).toBe(201);
    expect(await runJobsOfType("generate_artifact")).toEqual(["done"]);

    const a = await detail(artifact.id, c.owner);
    expect(a.status).toBe("ready");
    const content = a.content as SlideDeckContent;
    expect(content.slides.length).toBeGreaterThanOrEqual(10);
    expect(content.evidence.length).toBeGreaterThan(0);

    const out = await exportAs(artifact.id, c.members.viewer, "pptx"); // viewer xem được thì xuất được
    expect(out.status).toBe(200);
    const dto = ((await out.json()) as { export: ArtifactExportDto }).export;
    expect(dto.fileName).toMatch(/\.pptx$/);
    const zip = await JSZip.loadAsync(await fileBytes(dto, c.members.viewer));
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const title = (content.slides[0] as unknown as { title: string }).title;
    expect(slide1).toContain(title.split(" ")[0]);
    expect(Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length).toBeGreaterThanOrEqual(content.slides.length);
  }, 60_000);

  it("PDF slide deck: Chromium in HTML 1280×720 mỗi slide một trang", async () => {
    const c = await setup();
    const { artifact } = await create(c, c.owner, { type: "slide_deck", options: { slideCount: 6 } });
    await runJobsOfType("generate_artifact");
    const res = await exportAs(artifact.id, c.owner, "pdf");
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(jobId).toBeTruthy();
    expect(await runJobsOfType("export_artifact")).toEqual(["done"]);
    const { listExports } = await import("@/server/artifacts/export-service");
    const exps = await listExports(artifact.id);
    expect(exps).toHaveLength(1);
    const bytes = await fileBytes(exps[0], c.owner);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const content = (await detail(artifact.id, c.owner)).content as SlideDeckContent;
    // + 1 trang "Nguồn" vì các slide có trích dẫn
    expect(pdf.numPages).toBeGreaterThanOrEqual(content.slides.length);
    expect(pdf.numPages).toBeLessThanOrEqual(content.slides.length + 2);
  }, 120_000);

  it("ảnh AI (dataUrl) được lưu vào kho tệp → fileId; thành viên đọc được qua /api/files, người lạ 404; PPTX nhúng ảnh", async () => {
    const c = await setup();
    registerEngines({
      slide_deck: {
        generate: async ({ evidence }) => ({
          theme: { palette: "indigo", font: "Inter" },
          slides: [
            { id: "s1", layout: "title", title: "Bộ slide có ảnh" },
            { id: "s2", layout: "image_text", title: "Slide ảnh", bullets: ["Ý một"], image: { prompt: "tế bào", dataUrl: `data:image/png;base64,${PNG_1PX.toString("base64")}` } },
          ],
          evidence,
        }),
        exportPptx: (content, opts) => exportSlideDeckPptx(content as never, { resolveImage: opts?.resolveImage }),
      },
    });
    const { artifact } = await create(c, c.members.editor, { type: "slide_deck" });
    expect(await runJobsOfType("generate_artifact")).toEqual(["done"]);

    const [row] = await db.select().from(artifactVersions).where(eq(artifactVersions.artifactId, artifact.id));
    const json = JSON.stringify(row.content);
    expect(json).not.toContain("dataUrl");
    expect(json).not.toContain("base64");
    const slide = (row.content as { slides: Array<{ image?: { fileId?: string } }> }).slides[1];
    const fileId = slide.image!.fileId!;
    expect(fileId).toMatch(/^[0-9a-f-]{36}$/);
    const [f] = await db.select().from(files).where(eq(files.id, fileId));
    expect(f.ownerId).toBe(c.members.editor.id);
    expect(f.mime).toBe("image/png");

    // quyền: ai xem được artifact thì đọc được ảnh; người lạ thì không
    const asViewer = await getFile(makeRequest(`/api/files/${fileId}`, { user: c.members.viewer }), params({ id: fileId }));
    expect(asViewer.status).toBe(200);
    expect(Buffer.from(await asViewer.arrayBuffer()).equals(PNG_1PX)).toBe(true);
    const stranger = await createTestUser();
    expect((await getFile(makeRequest(`/api/files/${fileId}`, { user: stranger }), params({ id: fileId }))).status).toBe(404);

    const out = await exportAs(artifact.id, c.owner, "pptx");
    const dto = ((await out.json()) as { export: ArtifactExportDto }).export;
    const zip = await JSZip.loadAsync(await fileBytes(dto, c.owner));
    expect(Object.keys(zip.files).some((n) => n.startsWith("ppt/media/"))).toBe(true);
  }, 60_000);

  it("tải ảnh lên: editor được (201, PNG thật), viewer 403, tệp không phải ảnh 415", async () => {
    const c = await setup();
    const { artifact } = await create(c, c.owner, { type: "slide_deck", options: { slideCount: 5 } });
    await runJobsOfType("generate_artifact");
    const form = (bytes: Buffer, name: string, type: string) => {
      const f = new FormData();
      f.append("file", new File([new Uint8Array(bytes)], name, { type }));
      return f;
    };
    const call = (user: TestUser, body: FormData) =>
      uploadImage(new Request(`http://localhost:3000/api/artifacts/${artifact.id}/images`, { method: "POST", headers: { cookie: user.cookie }, body }), params({ artifactId: artifact.id }));

    const ok = await call(c.members.editor, form(PNG_1PX, "a.png", "image/png"));
    expect(ok.status).toBe(201);
    const { fileId } = (await ok.json()) as { fileId: string };
    const [f] = await db.select().from(files).where(eq(files.id, fileId));
    expect(f.ownerId).toBe(c.members.editor.id);
    expect((await call(c.members.viewer, form(PNG_1PX, "a.png", "image/png"))).status).toBe(403);
    expect((await call(c.members.editor, form(Buffer.from("<svg onload=alert(1)/>"), "x.png", "image/png"))).status).toBe(415);
  });
});

describe("sửa một slide bằng AI", () => {
  async function readyDeck() {
    const c = await setup();
    const { artifact } = await create(c, c.members.editor, { type: "slide_deck", options: { slideCount: 6 } });
    await runJobsOfType("generate_artifact");
    const a = await detail(artifact.id, c.owner);
    return { c, a, deck: a.content as SlideDeckContent };
  }
  const call = (id: string, slideId: string, user: TestUser, body: unknown) =>
    aiEdit(makeRequest(`/api/artifacts/${id}/slides/${slideId}/ai-edit`, { method: "POST", user, body }), params({ artifactId: id, slideId }));

  it("editor: engine nhận nội dung + ngữ cảnh dựng lại từ evidence, kết quả thành phiên bản mới", async () => {
    const { c, a, deck } = await readyDeck();
    const slideId = (deck.slides[1] as { id: string }).id;
    let seen: { contextText?: string; instruction: string; slideId: string } | null = null;
    const real = (await import("@/server/artifacts/registry")).getSlideEngine();
    registerEngines({
      slide_deck: {
        ...real,
        editSlide: async (input) => {
          seen = { contextText: input.contextText, instruction: input.instruction, slideId: input.slideId };
          return input.content;
        },
      },
    });
    const res = await call(a.id, slideId, c.members.editor, { instruction: "Rút gọn thành hai ý", baseVersionId: a.currentVersionId });
    expect(seen).not.toBeNull();
    expect(seen!.instruction).toBe("Rút gọn thành hai ý");
    expect(seen!.slideId).toBe(slideId);
    expect(seen!.contextText).toContain("[1] Nguồn:");
    expect(seen!.contextText).toContain("Sinh học tế bào");
    expect(res.status).toBe(200);
    // ngữ cảnh đánh số khớp với evidence đã lưu: slide.citations [n] trỏ đúng đoạn
    const evidence = deck.evidence as Array<{ sourceTitle: string }>;
    expect(seen!.contextText!.startsWith(`[1] Nguồn: "${evidence[0].sourceTitle}"`)).toBe(true);
    expect((await res.json() as { artifact: ArtifactDetailDto }).artifact.currentVersionNo).toBe(2);
  });

  it("editor + provider trả slide hợp lệ: slide đổi, slide khác giữ nguyên, phiên bản +1; viewer 403; slide lạ 404; lệch phiên bản 409", async () => {
    const { c, a, deck } = await readyDeck();
    const slideId = (deck.slides[1] as { id: string }).id;
    const real = (await import("@/server/artifacts/registry")).getSlideEngine();
    const NEW_TITLE = "Tiêu đề do AI viết lại";
    registerEngines({
      slide_deck: {
        ...real,
        editSlide: async ({ content, slideId: id }) => ({
          ...content,
          slides: content.slides.map((s) => ((s as { id: string }).id === id ? { ...s, title: NEW_TITLE } : s)),
        }),
      },
    });
    expect((await call(a.id, slideId, c.members.viewer, { instruction: "x" })).status).toBe(403);
    expect((await call(a.id, "khong-co", c.members.editor, { instruction: "x" })).status).toBe(404);
    expect((await call(a.id, slideId, c.members.editor, { instruction: "" })).status).toBe(400);
    expect((await call(a.id, slideId, c.members.editor, { instruction: "x", baseVersionId: "11111111-1111-4111-8111-111111111111" })).status).toBe(409);

    const ok = await call(a.id, slideId, c.members.editor, { instruction: "Viết lại tiêu đề", baseVersionId: a.currentVersionId });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { artifact: ArtifactDetailDto };
    expect(body.artifact.currentVersionNo).toBe(2);
    const slides = (body.artifact.content as SlideDeckContent).slides as Array<{ id: string; title: string }>;
    expect(slides[1].title).toBe(NEW_TITLE);
    expect(slides[0].title).toBe((deck.slides[0] as unknown as { title: string }).title);
    expect(slides.length).toBe(deck.slides.length);
  });

  it("loại khác slide_deck → 400", async () => {
    const c = await setup();
    const { artifact } = await create(c, c.owner, { type: "infographic" });
    await runJobsOfType("generate_artifact");
    expect((await call(artifact.id, "x", c.owner, { instruction: "x" })).status).toBe(400);
  });
});

describe("infographic với engine thật (provider mock)", () => {
  it("tạo → ready → SVG xuất ra là XML hợp lệ, không script/href ngoài; PDF chạy bằng job", async () => {
    const c = await setup();
    const { artifact } = await create(c, c.members.editor, { type: "infographic", options: { orientation: "portrait" } });
    expect(await runJobsOfType("generate_artifact")).toEqual(["done"]);
    const a = await detail(artifact.id, c.owner);
    expect(a.status).toBe("ready");
    const content = a.content as { blocks: unknown[]; evidence: unknown[] };
    expect(content.blocks.length).toBeGreaterThan(0);

    const out = await exportAs(artifact.id, c.members.viewer, "svg");
    expect(out.status).toBe(200);
    const dto = ((await out.json()) as { export: ArtifactExportDto }).export;
    const svg = (await fileBytes(dto, c.members.viewer)).toString("utf8");
    const dom = new JSDOM(svg, { contentType: "image/svg+xml" }); // ném lỗi nếu không phải XML hợp lệ
    expect(dom.window.document.documentElement.tagName).toBe("svg");
    expect(svg).not.toMatch(/<script|href=|onload=/i);

    const pdf = await exportAs(artifact.id, c.owner, "pdf");
    expect(pdf.status).toBe(202);
    expect(await runJobsOfType("export_artifact")).toEqual(["done"]);
  }, 120_000);

  it("PATCH nội dung slide_deck vẫn đi qua kiểm tra khung; xuất PPTX với nội dung hỏng trả 400 chứ không 500", async () => {
    const c = await setup();
    const { artifact } = await create(c, c.owner, { type: "slide_deck", options: { slideCount: 5 } });
    await runJobsOfType("generate_artifact");
    const a = await detail(artifact.id, c.owner);
    const deck = a.content as SlideDeckContent;
    const broken = { ...deck, slides: [{ id: "s1", layout: "khong_ton_tai", title: "x" }] };
    const patch = await patchArtifact(makeRequest(`/api/artifacts/${a.id}`, { method: "PATCH", user: c.owner, body: { content: broken } }), params({ artifactId: a.id }));
    expect(patch.status).toBe(200); // khung hợp lệ nhưng engine từ chối khi xuất
    const out = await exportAs(a.id, c.owner, "pptx");
    expect(out.status).toBe(400);
  });
});
