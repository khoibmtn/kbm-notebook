import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Server } from "socket.io";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as search } from "@/app/api/notebooks/[id]/search/route";
import { GET as listSources, POST as createSource } from "@/app/api/notebooks/[id]/sources/route";
import { DELETE as deleteSource, GET as getSource, PATCH as patchSource } from "@/app/api/notebooks/[id]/sources/[sourceId]/route";
import { POST as reprocess } from "@/app/api/notebooks/[id]/sources/[sourceId]/reprocess/route";
import { POST as upload } from "@/app/api/notebooks/[id]/sources/upload/route";
import { setIo } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { jobs, sourceChunks, sources } from "@/server/db/schema";
import { createIngestHandler } from "@/server/jobs/handlers/ingest";
import { claimJob, registerJobHandler, runJob } from "@/server/jobs/worker";
import type { Evidence } from "@/server/knowledge/providers/types";
import type { SourceDetailDto, SourceDto } from "@/lib/sources";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { makeBlankPdf, makeDocx, makeFile, makePdf, makePptx } from "../helpers/docs";
import { makeRequest, params, type TestUser } from "../helpers/users";

const PDF = "application/pdf";

const PAGE_HTML = `<!doctype html><html><head><title>Bài viết về núi lửa</title></head><body><nav>Menu</nav><article>
<h1>Núi lửa Krakatoa</h1><p>Krakatoa là một đảo núi lửa ở eo biển Sunda, nổi tiếng với vụ phun trào dữ dội năm 1883 làm thay đổi khí hậu toàn cầu trong nhiều năm, và gây ra sóng thần cực lớn.</p>
<p>Các nhà địa chất vẫn theo dõi hoạt động của Anak Krakatau, hòn đảo mới hình thành từ miệng núi lửa cũ, bằng địa chấn kế và ảnh vệ tinh.</p></article></body></html>`;

// Không dùng mạng thật: giả lập bước tải trang (kiểm tra SSRF/gzip/redirect đã có test riêng ở tests/unit/ssrf.test.ts).
vi.mock("@/server/knowledge/ingest/ssrf", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/knowledge/ingest/ssrf")>();
  return {
    ...mod,
    safeFetch: vi.fn(async (u: string) => ({ finalUrl: u, contentType: "text/html; charset=utf-8", status: 200, body: Buffer.from(PAGE_HTML) })),
  };
});

/** Chạy mọi job ingest_source đang chờ (chỉ file test này tạo loại job này). */
async function runIngestJobs(): Promise<string[]> {
  const outcomes: string[] = [];
  for (;;) {
    const job = await claimJob("test-worker", ["ingest_source"]);
    if (!job) break;
    outcomes.push(await runJob(job));
  }
  return outcomes;
}

function uploadReq(nb: string, user: TestUser | null, files: File[], extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const headers = new Headers();
  if (user) headers.set("cookie", user.cookie);
  return new Request(`http://localhost:3000/api/notebooks/${nb}/sources/upload`, { method: "POST", headers, body: form });
}

async function doUpload(nb: string, user: TestUser, files: File[], extra?: Record<string, string>) {
  const res = await upload(uploadReq(nb, user, files, extra), params({ id: nb }));
  return { res, body: (await res.json()) as { sources: SourceDto[]; errors: { name: string; status: number }[]; error?: { code: string; message: string } } };
}

async function doSearch(nb: string, user: TestUser, body: Record<string, unknown>) {
  const res = await search(makeRequest(`/api/notebooks/${nb}/search`, { method: "POST", user, body }), params({ id: nb }));
  return { res, evidence: ((await res.clone().json()) as { evidence?: Evidence[] }).evidence ?? [] };
}

async function detail(nb: string, user: TestUser, id: string) {
  const res = await getSource(makeRequest(`/api/notebooks/${nb}/sources/${id}`, { user }), params({ id: nb, sourceId: id }));
  return { res, source: ((await res.clone().json()) as { source?: SourceDetailDto }).source };
}

beforeAll(() => {
  registerJobHandler("ingest_source", createIngestHandler({ retryDelayMs: 0 }));
});
beforeEach(async () => {
  await runIngestJobs(); // dọn job còn sót của test trước
});
afterEach(() => setIo(undefined as unknown as Server));

const PAGES = [
  "Page one covers photosynthesis: plants convert sunlight, water and carbon dioxide into glucose and oxygen inside chloroplasts.",
  "Page two covers mitochondria: the organelle that produces ATP through cellular respiration, often called the powerhouse of the cell.",
  "Page three covers ribosomes: they translate messenger RNA into proteins by assembling amino acids in the correct order.",
];

describe("upload → ingest → search", () => {
  it("PDF 3 trang: pending → ready, có chunk + embedding + tóm tắt; search trả đúng trang", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const events: { event: string; payload: { status: string; progress: number; change: string } }[] = [];
    setIo({
      of: () => ({ to: () => ({ emit: (event: string, payload: never) => events.push({ event, payload }) }) }),
    } as unknown as Server);

    const { res, body } = await doUpload(notebook.id, owner, [makeFile(await makePdf(PAGES), "sinh-hoc.pdf", PDF)]);
    expect(res.status).toBe(201);
    expect(body.sources).toHaveLength(1);
    const src = body.sources[0];
    expect(src).toMatchObject({ kind: "file", fileType: "pdf", title: "sinh-hoc.pdf", status: "pending", visibility: "shared", canManage: true });

    expect(await runIngestJobs()).toEqual(["done"]);
    const { source } = await detail(notebook.id, owner, src.id);
    expect(source).toMatchObject({ status: "ready", pageCount: 3, pageUnit: "page", progress: 100, error: null });
    expect(source!.tokenCount).toBeGreaterThan(20);
    expect(source!.summary).toBeTruthy();
    expect(source!.keyTopics!.length).toBeGreaterThanOrEqual(3);
    expect(source!.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(source!.pages[1].text).toContain("mitochondria");
    expect(source!.chunks.length).toBeGreaterThanOrEqual(3);

    // chunk có embedding 768 chiều + tsv
    const rows = await db
      .select({ page: sourceChunks.page, hasVec: isNotNull(sourceChunks.embedding), dims: sql<number>`vector_dims(${sourceChunks.embedding})`, tsv: isNotNull(sourceChunks.tsv) })
      .from(sourceChunks)
      .where(eq(sourceChunks.sourceId, src.id));
    expect(rows.every((r) => r.hasVec && r.dims === 768 && r.tsv)).toBe(true);

    // realtime: created → processing (tiến độ tăng dần) → ready
    const statuses = events.filter((e) => e.event === "source:status").map((e) => e.payload.status);
    expect(statuses[0]).toBe("pending");
    expect(statuses).toContain("processing");
    expect(statuses[statuses.length - 1]).toBe("ready");
    const progress = events.filter((e) => e.payload.status === "processing").map((e) => e.payload.progress);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);

    // search: câu hỏi về ty thể → chunk của trang 2
    const mito = await doSearch(notebook.id, owner, { query: "which organelle produces ATP, the powerhouse of the cell?" });
    expect(mito.res.status).toBe(200);
    expect(mito.evidence.length).toBeGreaterThan(0);
    const top = mito.evidence[0];
    expect(top).toMatchObject({ provider: "local", sourceId: src.id, sourceTitle: "sinh-hoc.pdf" });
    expect(top.locator.page).toBe(2);
    expect(top.text).toContain("mitochondria");
    expect(top.locator.startChar).toBeLessThan(top.locator.endChar!);
    expect(top.score).toBeGreaterThan(0);
    expect(top.similarity).toBeGreaterThan(0);

    const ribo = await doSearch(notebook.id, owner, { query: "ribosomes translate messenger RNA into proteins", topK: 2 });
    expect(ribo.evidence.length).toBeLessThanOrEqual(2);
    expect(ribo.evidence[0].locator.page).toBe(3);
  });

  it("PDF 50 trang → ready; mỗi truy vấn trả chunk đúng trang", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const topics = ["volcano", "glacier", "monsoon", "tectonic", "savanna", "tundra", "estuary", "plateau", "archipelago", "peninsula"];
    const pages = Array.from({ length: 50 }, (_, i) => {
      const n = i + 1;
      const topic = `${topics[i % 10]}${n}`; // từ khoá duy nhất cho từng trang
      return `Section ${n}. This page describes ${topic}. ` + `The ${topic} is discussed with several unrelated filler sentences about geography and climate, number ${n}. `.repeat(6);
    });
    const { res, body } = await doUpload(notebook.id, owner, [makeFile(await makePdf(pages), "dia-ly-50-trang.pdf", PDF)]);
    expect(res.status).toBe(201);
    expect(await runIngestJobs()).toEqual(["done"]);
    const { source } = await detail(notebook.id, owner, body.sources[0].id);
    expect(source).toMatchObject({ status: "ready", pageCount: 50 });
    expect(new Set(source!.chunks.map((c) => c.page)).size).toBe(50);
    for (const n of [1, 17, 33, 50]) {
      const topic = `${topics[(n - 1) % 10]}${n}`;
      const { evidence } = await doSearch(notebook.id, owner, { query: `Tell me about ${topic}` });
      expect(evidence[0].locator.page, `trang ${n}`).toBe(n);
      expect(evidence[0].text).toContain(topic);
    }
  });

  it("DOCX, PPTX, văn bản dán: locator đúng (section / slide)", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const docx = await makeDocx([{ heading: "Quang hợp" }, { text: "Cây xanh tạo ra glucose nhờ ánh sáng mặt trời." }, { heading: "Hô hấp" }, { text: "Ty thể tạo ra năng lượng ATP." }]);
    const pptx = await makePptx([
      { title: "Intro", bullets: ["welcome to the course"] },
      { title: "Genetics", bullets: ["DNA stores hereditary information"] },
    ]);
    const { res } = await doUpload(notebook.id, owner, [
      makeFile(docx, "bai.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      makeFile(pptx, "deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ]);
    expect(res.status).toBe(201);
    const text = await createSource(
      makeRequest(`/api/notebooks/${notebook.id}/sources`, { method: "POST", user: owner, body: { kind: "text", title: "Ghi chú", text: "Định lý Pythagoras: a bình phương cộng b bình phương bằng c bình phương." } }),
      params({ id: notebook.id }),
    );
    expect(text.status).toBe(201);
    expect(await runIngestJobs()).toEqual(["done", "done", "done"]);

    const doc = await doSearch(notebook.id, owner, { query: "Ty thể tạo ra năng lượng ATP" });
    const docHit = doc.evidence.find((e) => e.sourceTitle === "bai.docx")!;
    expect(docHit.locator.section).toBeDefined();
    expect(docHit.text).toContain("ATP");

    const slide = await doSearch(notebook.id, owner, { query: "DNA stores hereditary information" });
    const slideHit = slide.evidence.find((e) => e.sourceTitle === "deck.pptx")!;
    expect(slideHit.locator.slide).toBe(2);
    expect(slideHit.locator.page).toBeUndefined();

    const pyt = await doSearch(notebook.id, owner, { query: "định lý Pythagoras" });
    expect(pyt.evidence[0]).toMatchObject({ sourceTitle: "Ghi chú" });
  });

  it("URL: tải trang → Readability → tiêu đề trang thay tên tạm, search tìm thấy, có finalUrl", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const res = await createSource(
      makeRequest(`/x`, { method: "POST", user: owner, body: { kind: "url", url: "http://93.184.216.34/nui-lua" } }),
      params({ id: notebook.id }),
    );
    expect(res.status).toBe(201);
    const { source } = (await res.json()) as { source: SourceDto };
    expect(source).toMatchObject({ kind: "url", status: "pending", title: "93.184.216.34/nui-lua", url: "http://93.184.216.34/nui-lua" });
    expect(await runIngestJobs()).toEqual(["done"]);
    const detailed = (await detail(notebook.id, owner, source.id)).source!;
    expect(detailed).toMatchObject({ status: "ready", title: "Bài viết về núi lửa" });
    expect(detailed.pages.some((p) => p.section === "Núi lửa Krakatoa")).toBe(true);
    const hit = await doSearch(notebook.id, owner, { query: "Anak Krakatau địa chấn kế" });
    expect(hit.evidence[0]).toMatchObject({ sourceId: source.id, sourceTitle: "Bài viết về núi lửa" });
    expect(hit.evidence[0].locator.section).toBeDefined();
  });

  it("lọc theo sourceIds; mảng rỗng → không có kết quả", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    await doUpload(notebook.id, owner, [
      makeFile(await makePdf(["Alpha document talks about volcano eruptions and magma chambers."]), "a.pdf", PDF),
      makeFile(await makePdf(["Beta document talks about volcano monitoring with seismographs."]), "b.pdf", PDF),
    ]);
    await runIngestJobs();
    const all = await doSearch(notebook.id, owner, { query: "volcano" });
    expect(new Set(all.evidence.map((e) => e.sourceTitle))).toEqual(new Set(["a.pdf", "b.pdf"]));
    const onlyB = all.evidence.find((e) => e.sourceTitle === "b.pdf")!.sourceId!;
    const filtered = await doSearch(notebook.id, owner, { query: "volcano", sourceIds: [onlyB] });
    expect(filtered.evidence.length).toBeGreaterThan(0);
    expect(filtered.evidence.every((e) => e.sourceId === onlyB)).toBe(true);
    expect((await doSearch(notebook.id, owner, { query: "volcano", sourceIds: [] })).evidence).toEqual([]);
  });
});

describe("kiểm tra đầu vào", () => {
  it("413 khi vượt MAX_UPLOAD_MB; 415 loại không hỗ trợ; 400 không có tệp", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const big = await doUpload(notebook.id, owner, [makeFile(Buffer.alloc(1024 * 1024 + 10, 97), "lon.txt", "text/plain")]);
    expect(big.res.status).toBe(413);
    expect(big.body.error?.code).toBe("payload_too_large");

    const exe = await doUpload(notebook.id, owner, [makeFile("MZ", "virus.exe", "application/x-msdownload")]);
    expect(exe.res.status).toBe(415);
    expect(exe.body.error?.code).toBe("unsupported_type");

    // MIME mâu thuẫn với đuôi tệp
    const fake = await doUpload(notebook.id, owner, [makeFile("hello", "anh.pdf", "image/png")]);
    expect(fake.res.status).toBe(415);

    const none = await upload(uploadReq(notebook.id, owner, []), params({ id: notebook.id }));
    expect(none.status).toBe(400);
  });

  it("nhiều tệp: tệp hợp lệ vẫn được tạo, tệp lỗi nằm trong errors", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const { res, body } = await doUpload(notebook.id, owner, [makeFile("nội dung", "ok.txt", "text/plain"), makeFile("x", "bad.exe", "application/octet-stream")]);
    expect(res.status).toBe(201);
    expect(body.sources).toHaveLength(1);
    expect(body.errors).toEqual([expect.objectContaining({ name: "bad.exe", status: 415 })]);
  });

  it("URL nội bộ bị chặn (SSRF) và validate zod", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const post = (body: unknown) => createSource(makeRequest(`/api/notebooks/${notebook.id}/sources`, { method: "POST", user: owner, body }), params({ id: notebook.id }));
    const blocked = await post({ kind: "url", url: "http://127.0.0.1:8080/admin" });
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("blocked_url");
    expect((await post({ kind: "url", url: "ftp://example.com/x" })).status).toBe(400);
    expect((await post({ kind: "url", url: "not a url" })).status).toBe(400);
    expect((await post({ kind: "text", title: "", text: "x" })).status).toBe(400);
    expect((await post({ kind: "docx" })).status).toBe(400);
  });

  it("YouTube: tạo nguồn ở trạng thái failed 'chưa hỗ trợ', không xếp job", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const res = await createSource(
      makeRequest(`/api/notebooks/${notebook.id}/sources`, { method: "POST", user: owner, body: { kind: "url", url: "https://www.youtube.com/watch?v=abc123" } }),
      params({ id: notebook.id }),
    );
    expect(res.status).toBe(201);
    const { source } = (await res.json()) as { source: SourceDto };
    expect(source).toMatchObject({ kind: "youtube", status: "failed", error: "Nguồn YouTube chưa hỗ trợ" });
    expect(await runIngestJobs()).toEqual([]);
  });
});

describe("lỗi khi xử lý", () => {
  it("PDF không có lớp văn bản → failed (không retry), thông báo cần OCR; xử lý lại được", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const { body } = await doUpload(notebook.id, owner, [makeFile(await makeBlankPdf(2), "scan.pdf", PDF)]);
    const id = body.sources[0].id;
    expect(await runIngestJobs()).toEqual(["done"]); // job không retry
    const { source } = await detail(notebook.id, owner, id);
    expect(source).toMatchObject({ status: "failed", error: "PDF không có lớp văn bản (cần OCR)" });
    expect(source!.chunks).toEqual([]);

    const re = await reprocess(makeRequest(`/x`, { method: "POST", user: owner }), params({ id: notebook.id, sourceId: id }));
    expect(re.status).toBe(202);
    expect(((await re.json()) as { source: SourceDto }).source.status).toBe("pending");
    // đang pending → xử lý lại tiếp 409
    const again = await reprocess(makeRequest(`/x`, { method: "POST", user: owner }), params({ id: notebook.id, sourceId: id }));
    expect(again.status).toBe(409);
    await runIngestJobs();
  });

  it("lỗi tạm thời: nguồn giữ 'processing' khi còn lượt thử, 'failed' khi hết lượt", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    registerJobHandler("ingest_source", createIngestHandler({ retryDelayMs: 0, getProvider: async () => { throw new Error("mạng chập chờn"); } }));
    try {
      const { body } = await doUpload(notebook.id, owner, [makeFile("Một đoạn văn bản bình thường để xử lý.", "t.txt", "text/plain")]);
      const id = body.sources[0].id;
      const job1 = (await claimJob("w", ["ingest_source"]))!;
      expect(await runJob(job1)).toBe("retry");
      const [mid] = await db.select().from(sources).where(eq(sources.id, id));
      expect(mid.status).toBe("processing");
      expect(mid.error).toContain("mạng chập chờn");

      // lượt cuối
      await db.update(jobs).set({ runAt: new Date(), attempts: 2 }).where(eq(jobs.id, job1.id));
      const last = (await claimJob("w", ["ingest_source"]))!;
      expect(last.attempts).toBe(3);
      expect(await runJob(last)).toBe("failed");
      const [fin] = await db.select().from(sources).where(eq(sources.id, id));
      expect(fin).toMatchObject({ status: "failed" });
      expect(fin.error).toContain("mạng chập chờn");
    } finally {
      registerJobHandler("ingest_source", createIngestHandler({ retryDelayMs: 0 }));
    }
  });

  it("reprocess nguồn ready → ready lại, chunk được tạo mới", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const { body } = await doUpload(notebook.id, owner, [makeFile("Câu một. Câu hai. Câu ba về hệ mặt trời.", "n.md", "text/markdown")]);
    const id = body.sources[0].id;
    await runIngestJobs();
    const before = (await detail(notebook.id, owner, id)).source!;
    expect(before.status).toBe("ready");
    const re = await reprocess(makeRequest(`/x`, { method: "POST", user: owner }), params({ id: notebook.id, sourceId: id }));
    expect(re.status).toBe(202);
    await runIngestJobs();
    const after = (await detail(notebook.id, owner, id)).source!;
    expect(after.status).toBe("ready");
    expect(after.chunks).toHaveLength(before.chunks.length);
    expect(after.chunks[0].id).not.toBe(before.chunks[0].id);
  });
});

describe("phân quyền", () => {
  it("viewer upload/tạo → 403; người ngoài → 404; chưa đăng nhập → 401", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer"]);
    const file = makeFile("nội dung", "a.txt", "text/plain");
    expect((await upload(uploadReq(notebook.id, members.viewer, [file]), params({ id: notebook.id }))).status).toBe(403);
    const post = (user: TestUser | null) =>
      createSource(makeRequest(`/x`, { method: "POST", user, body: { kind: "text", title: "t", text: "x" } }), params({ id: notebook.id }));
    expect((await post(members.viewer)).status).toBe(403);
    expect((await post(null)).status).toBe(401);
    const { createTestUser } = await import("../helpers/users");
    const stranger = await createTestUser();
    expect((await upload(uploadReq(notebook.id, stranger, [file]), params({ id: notebook.id }))).status).toBe(404);
    expect((await listSources(makeRequest(`/x`, { user: stranger }), params({ id: notebook.id }))).status).toBe(404);
    // viewer vẫn xem được danh sách và tìm kiếm
    expect((await listSources(makeRequest(`/x`, { user: members.viewer }), params({ id: notebook.id }))).status).toBe(200);
    expect((await doSearch(notebook.id, members.viewer, { query: "gì đó" })).res.status).toBe(200);
    void owner;
  });

  it("nguồn private: người khác không thấy (danh sách, chi tiết 404, search, sửa/xoá 404), chủ nguồn thấy", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["editor", "admin"]);
    const { body } = await doUpload(notebook.id, members.editor, [makeFile("Bí mật: mã khuyến mãi là CAMEL42 dành riêng.", "bimat.txt", "text/plain")], { visibility: "private" });
    const priv = body.sources[0];
    expect(priv.visibility).toBe("private");
    await doUpload(notebook.id, owner, [makeFile("Tài liệu chung nói về khuyến mãi mùa hè.", "chung.txt", "text/plain")]);
    await runIngestJobs();

    const titles = async (u: TestUser) =>
      ((await (await listSources(makeRequest(`/x`, { user: u }), params({ id: notebook.id }))).json()) as { sources: SourceDto[] }).sources.map((s) => s.title).sort();
    expect(await titles(members.editor)).toEqual(["bimat.txt", "chung.txt"]);
    expect(await titles(owner)).toEqual(["chung.txt"]);
    expect(await titles(members.admin)).toEqual(["chung.txt"]);

    expect((await detail(notebook.id, owner, priv.id)).res.status).toBe(404);
    expect((await detail(notebook.id, members.admin, priv.id)).res.status).toBe(404);
    expect((await detail(notebook.id, members.editor, priv.id)).res.status).toBe(200);
    const patch = await patchSource(makeRequest(`/x`, { method: "PATCH", user: members.admin, body: { title: "x" } }), params({ id: notebook.id, sourceId: priv.id }));
    expect(patch.status).toBe(404);
    const del = await deleteSource(makeRequest(`/x`, { method: "DELETE", user: owner }), params({ id: notebook.id, sourceId: priv.id }));
    expect(del.status).toBe(404);

    const mine = await doSearch(notebook.id, members.editor, { query: "mã khuyến mãi CAMEL42" });
    expect(mine.evidence.map((e) => e.sourceTitle)).toContain("bimat.txt");
    const theirs = await doSearch(notebook.id, owner, { query: "mã khuyến mãi CAMEL42" });
    expect(theirs.evidence.map((e) => e.sourceTitle)).not.toContain("bimat.txt");
    expect(theirs.evidence.map((e) => e.sourceTitle)).toContain("chung.txt");
    // kể cả khi chỉ định thẳng sourceIds
    expect((await doSearch(notebook.id, owner, { query: "CAMEL42", sourceIds: [priv.id] })).evidence).toEqual([]);

    // chuyển sang shared → mọi người thấy
    const share = await patchSource(makeRequest(`/x`, { method: "PATCH", user: members.editor, body: { visibility: "shared" } }), params({ id: notebook.id, sourceId: priv.id }));
    expect(share.status).toBe(200);
    expect(await titles(owner)).toEqual(["bimat.txt", "chung.txt"]);
  });

  it("đổi tên / quyền / xoá: chỉ chủ nguồn hoặc admin+ (editor khác → 403)", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["editor", "admin", "viewer"]);
    const { body } = await doUpload(notebook.id, owner, [makeFile("nội dung chung", "chung.txt", "text/plain")]);
    const id = body.sources[0].id;
    const call = (fn: typeof patchSource, user: TestUser, method: string, b?: unknown) =>
      fn(makeRequest(`/x`, { method, user, body: b }), params({ id: notebook.id, sourceId: id }));

    expect((await call(patchSource, members.editor, "PATCH", { title: "hack" })).status).toBe(403);
    expect((await call(deleteSource, members.editor, "DELETE")).status).toBe(403);
    expect((await call(patchSource, members.viewer, "PATCH", { title: "hack" })).status).toBe(403);
    expect((await call(patchSource, members.editor, "PATCH", {})).status).toBe(403); // quyền được kiểm trước body
    expect((await call(patchSource, owner, "PATCH", {})).status).toBe(400);

    const renamed = await call(patchSource, members.admin, "PATCH", { title: "  Tên mới  " });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { source: SourceDto }).source.title).toBe("Tên mới");
  });

  it("xoá mềm: biến khỏi danh sách/search/chi tiết, chunk bị xoá, dòng vẫn còn với deleted_at", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const { body } = await doUpload(notebook.id, owner, [makeFile("Chuyện về con rồng lửa Zorgon ở núi cao.", "rong.txt", "text/plain")]);
    const id = body.sources[0].id;
    await runIngestJobs();
    expect((await doSearch(notebook.id, owner, { query: "rồng lửa Zorgon" })).evidence.length).toBeGreaterThan(0);

    const del = await deleteSource(makeRequest(`/x`, { method: "DELETE", user: owner }), params({ id: notebook.id, sourceId: id }));
    expect(del.status).toBe(200);
    expect((await detail(notebook.id, owner, id)).res.status).toBe(404);
    expect((await doSearch(notebook.id, owner, { query: "rồng lửa Zorgon" })).evidence).toEqual([]);
    const list = (await (await listSources(makeRequest(`/x`, { user: owner }), params({ id: notebook.id }))).json()) as { sources: SourceDto[] };
    expect(list.sources).toEqual([]);
    const [row] = await db.select().from(sources).where(eq(sources.id, id));
    expect(row.deletedAt).not.toBeNull();
    expect(await db.select().from(sourceChunks).where(and(eq(sourceChunks.sourceId, id)))).toEqual([]);
  });

  it("nguồn của notebook khác không truy cập được qua id notebook của mình", async () => {
    const a = await createNotebookWithMembers();
    const b = await createNotebookWithMembers();
    const { body } = await doUpload(a.notebook.id, a.owner, [makeFile("riêng của A", "a.txt", "text/plain")]);
    const res = await getSource(makeRequest(`/x`, { user: b.owner }), params({ id: b.notebook.id, sourceId: body.sources[0].id }));
    expect(res.status).toBe(404);
  });
});

describe("GET /sources/[id] khi đang xử lý", () => {
  it("nguồn pending trả về trang rỗng, không có chunk", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const { body } = await doUpload(notebook.id, owner, [makeFile("đang chờ", "w.txt", "text/plain")]);
    const { source } = await detail(notebook.id, owner, body.sources[0].id);
    expect(source).toMatchObject({ status: "pending", pages: [], chunks: [] });
    await runIngestJobs();
  });
});
