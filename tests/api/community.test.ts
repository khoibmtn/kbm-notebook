/* eslint-disable @typescript-eslint/no-explicit-any -- phản hồi JSON được kiểm tra bằng expect */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DELETE as unlikeRoute, GET as getLike, POST as likeRoute } from "@/app/api/artifacts/[artifactId]/like/route";
import { DELETE as deleteComment } from "@/app/api/artifacts/[artifactId]/comments/[commentId]/route";
import { GET as listComments, POST as postComment } from "@/app/api/artifacts/[artifactId]/comments/route";
import { GET as exploreArtifacts } from "@/app/api/explore/artifacts/route";
import { GET as exploreNotebooks } from "@/app/api/explore/notebooks/route";
import { GET as getPublicNotebook } from "@/app/api/public/notebooks/[slug]/route";
import { GET as getPublishState, PATCH as patchPublish } from "@/app/api/notebooks/[id]/public/route";
import { GET as listJoinRequests, POST as postJoinRequest } from "@/app/api/notebooks/[id]/join-requests/route";
import { POST as acceptRequest } from "@/app/api/notebooks/[id]/join-requests/[requestId]/accept/route";
import { POST as rejectRequest } from "@/app/api/notebooks/[id]/join-requests/[requestId]/reject/route";
import { GET as listNotifications } from "@/app/api/notifications/route";
import { db } from "@/server/db";
import { artifactVersions, artifacts } from "@/server/db/schema";
import { getNotebookRole } from "@/server/auth/permissions";
import { createNotebookWithMembers, insertArtifact, insertSource } from "../helpers/fixtures";
import { createTestUser, makeRequest, params, type TestUser } from "../helpers/users";

async function json(res: Response): Promise<any> {
  return res.json();
}

async function publicArtifact(notebookId: string, createdBy: string, over: Partial<typeof artifacts.$inferInsert> = {}) {
  const art = await insertArtifact(notebookId, createdBy, { visibility: "public", title: "Bài công khai", ...over });
  const [v] = await db.insert(artifactVersions).values({ artifactId: art.id, versionNo: 1, content: { markdown: "# x", evidence: [] }, contentMd: "# x" }).returning();
  await db.update(artifacts).set({ currentVersionId: v.id }).where(eq(artifacts.id, art.id));
  return art;
}

const like = (user: TestUser | null, id: string, method: "GET" | "POST" | "DELETE" = "POST") =>
  (method === "GET" ? getLike : method === "POST" ? likeRoute : unlikeRoute)(makeRequest(`/api/artifacts/${id}/like`, { method, user }), params({ artifactId: id }));
const comment = (user: TestUser | null, id: string, body: string) =>
  postComment(makeRequest(`/api/artifacts/${id}/comments`, { method: "POST", user, body: { body } }), params({ artifactId: id }));
const comments = (user: TestUser | null, id: string) => listComments(makeRequest(`/api/artifacts/${id}/comments`, { user }), params({ artifactId: id }));
const delComment = (user: TestUser | null, id: string, commentId: string) =>
  deleteComment(makeRequest(`/api/artifacts/${id}/comments/${commentId}`, { method: "DELETE", user }), params({ artifactId: id, commentId }));

describe("thích artifact", () => {
  it("artifact riêng tư của người khác → 404 cho thích và bình luận (kể cả owner sổ tay)", async () => {
    const { notebook, owner, members } = await createNotebookWithMembers(["editor"]);
    const art = await insertArtifact(notebook.id, members.editor.id, { visibility: "private" });
    expect((await like(owner, art.id)).status).toBe(404);
    expect((await comment(owner, art.id, "xin chào")).status).toBe(404);
    const stranger = await createTestUser("Người lạ");
    expect((await like(stranger, art.id)).status).toBe(404);
    // chủ artifact thì được
    expect((await like(members.editor, art.id)).status).toBe(200);
  });

  it("artifact công khai: người đăng nhập thích / bỏ thích, idempotent, đếm đúng; khách chỉ đọc", async () => {
    const { notebook, owner } = await createNotebookWithMembers([]);
    const art = await publicArtifact(notebook.id, owner.id);
    const a = await createTestUser("A");
    const b = await createTestUser("B");

    expect((await like(null, art.id, "POST")).status).toBe(401);
    let res = await like(a, art.id);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ likeCount: 1, liked: true, canInteract: true });
    res = await like(a, art.id); // lặp lại không tăng
    expect((await json(res)).likeCount).toBe(1);
    res = await like(b, art.id);
    expect((await json(res)).likeCount).toBe(2);

    // khách xem được số lượt thích nhưng không tương tác
    res = await like(null, art.id, "GET");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ likeCount: 2, liked: false, canInteract: false });

    res = await like(a, art.id, "DELETE");
    expect(await json(res)).toMatchObject({ likeCount: 1, liked: false });
  });

  it("artifact đã xoá hoặc id sai → 404", async () => {
    const { notebook, owner } = await createNotebookWithMembers([]);
    const art = await publicArtifact(notebook.id, owner.id);
    await db.update(artifacts).set({ deletedAt: new Date() }).where(eq(artifacts.id, art.id));
    expect((await like(owner, art.id)).status).toBe(404);
    expect((await like(owner, "khong-phai-uuid")).status).toBe(404);
  });
});

describe("bình luận artifact", () => {
  it("đăng, liệt kê (cũ → mới), validate nội dung", async () => {
    const { notebook, owner } = await createNotebookWithMembers([]);
    const art = await publicArtifact(notebook.id, owner.id);
    const a = await createTestUser("Bạn A");

    expect((await comment(null, art.id, "khách")).status).toBe(401);
    expect((await comment(a, art.id, "   ")).status).toBe(400);
    expect((await comment(a, art.id, "x".repeat(2001))).status).toBe(400);
    const r1 = await comment(a, art.id, "Bài hay **quá**");
    expect(r1.status).toBe(201);
    const c1 = (await json(r1)).comment;
    expect(c1).toMatchObject({ body: "Bài hay **quá**", canDelete: true, author: { name: "Bạn A" } });
    await comment(owner, art.id, "Cảm ơn bạn");

    // khách đọc được
    const list = await json(await comments(null, art.id));
    expect(list.comments.map((c: any) => c.body)).toEqual(["Bài hay **quá**", "Cảm ơn bạn"]);
    expect(list.comments.every((c: any) => c.canDelete === false)).toBe(true);
    // người viết thấy nút xoá bình luận của mình
    const mine = await json(await comments(a, art.id));
    expect(mine.comments.map((c: any) => c.canDelete)).toEqual([true, false]);
  });

  it("xoá: tác giả bình luận, admin+ của sổ tay chứa artifact; người khác 403", async () => {
    const { notebook, owner, members } = await createNotebookWithMembers(["admin", "editor"]);
    const art = await publicArtifact(notebook.id, owner.id);
    const a = await createTestUser("A");
    const b = await createTestUser("B");

    const ca = (await json(await comment(a, art.id, "của A"))).comment.id;
    const cb = (await json(await comment(b, art.id, "của B"))).comment.id;
    const cc = (await json(await comment(a, art.id, "thêm của A"))).comment.id;

    expect((await delComment(b, art.id, ca)).status).toBe(403); // người lạ khác
    expect((await delComment(members.editor, art.id, ca)).status).toBe(403); // editor không có quyền kiểm duyệt
    expect((await delComment(a, art.id, ca)).status).toBe(200); // chính chủ
    expect((await delComment(members.admin, art.id, cb)).status).toBe(200); // admin sổ tay
    expect((await delComment(owner, art.id, cc)).status).toBe(200); // owner sổ tay
    expect((await delComment(owner, art.id, cc)).status).toBe(404); // đã xoá
    expect((await json(await comments(a, art.id))).comments).toHaveLength(0);
  });

  it("bình luận không lộ artifact riêng tư và không xoá chéo artifact", async () => {
    const { notebook, owner } = await createNotebookWithMembers([]);
    const pub = await publicArtifact(notebook.id, owner.id);
    const other = await publicArtifact(notebook.id, owner.id, { title: "Bài khác" });
    const a = await createTestUser("A");
    const cid = (await json(await comment(a, pub.id, "x"))).comment.id;
    // dùng id bình luận của artifact này trên artifact khác → 404
    expect((await delComment(a, other.id, cid)).status).toBe(404);
  });
});

describe("Explore", () => {
  it("chỉ liệt kê artifact công khai đã sẵn sàng, lọc loại/tìm kiếm/sắp xếp, ẩn tên sổ tay riêng", async () => {
    const { notebook, owner } = await createNotebookWithMembers([]);
    const viewer = await createTestUser("Khách xem");
    const tag = `exp${Date.now()}`;
    const quiz = await publicArtifact(notebook.id, owner.id, { type: "quiz", title: `Quiz ${tag}` });
    const report = await publicArtifact(notebook.id, owner.id, { type: "report", title: `Báo cáo ${tag}` });
    await insertArtifact(notebook.id, owner.id, { visibility: "notebook", title: `Nội bộ ${tag}` });
    await insertArtifact(notebook.id, owner.id, { visibility: "link", title: `Liên kết ${tag}` });
    await publicArtifact(notebook.id, owner.id, { title: `Đã xoá ${tag}`, deletedAt: new Date() });
    await publicArtifact(notebook.id, owner.id, { title: `Đang tạo ${tag}`, status: "generating" });
    await like(viewer, quiz.id);

    const get = async (qs: string, user: TestUser | null = viewer) => exploreArtifacts(makeRequest("/api/explore/artifacts", { user, query: qs }));
    expect((await get(`?q=${tag}`, null)).status).toBe(401);
    const all = await json(await get(`?q=${tag}`));
    expect(all.items.map((i: any) => i.title).sort()).toEqual([`Báo cáo ${tag}`, `Quiz ${tag}`]);
    const quizItem = all.items.find((i: any) => i.id === quiz.id);
    expect(quizItem).toMatchObject({ type: "quiz", likeCount: 1, commentCount: 0, notebook: null });
    expect(quizItem.author.name).toBe("Chủ sổ tay");

    const onlyQuiz = await json(await get(`?q=${tag}&type=quiz`));
    expect(onlyQuiz.items.map((i: any) => i.id)).toEqual([quiz.id]);
    const byLikes = await json(await get(`?q=${tag}&sort=likes`));
    expect(byLikes.items[0].id).toBe(quiz.id);
    const byNew = await json(await get(`?q=${tag}&sort=new`));
    expect(byNew.items[0].id).toBe(report.id);
    expect((await get("?type=khong-co")).status).toBe(400);

    // sổ tay công khai → tên hiện ra
    const slug = `explore-${tag.toLowerCase()}`;
    await patchPublish(makeRequest(`/api/notebooks/${notebook.id}/public`, { method: "PATCH", user: owner, body: { isPublic: true, slug } }), params({ id: notebook.id }));
    const after = await json(await get(`?q=${tag}&type=quiz`));
    expect(after.items[0].notebook).toEqual({ title: "Sổ tay test", slug });
  });

  it("phân trang 24 mục/trang", async () => {
    const { notebook, owner } = await createNotebookWithMembers([]);
    const viewer = await createTestUser("V");
    const tag = `pg${Date.now()}`;
    for (let i = 0; i < 26; i++) await insertArtifact(notebook.id, owner.id, { visibility: "public", title: `Trang ${tag} ${i}` });
    const get = async (page: number) => json(await exploreArtifacts(makeRequest("/api/explore/artifacts", { user: viewer, query: `?q=${tag}&page=${page}` })));
    const p1 = await get(1);
    expect(p1.items).toHaveLength(24);
    expect(p1.hasMore).toBe(true);
    const p2 = await get(2);
    expect(p2.items).toHaveLength(2);
    expect(p2.hasMore).toBe(false);
  });
});

describe("sổ tay công khai", () => {
  async function setup() {
    const fx = await createNotebookWithMembers(["admin", "editor"]);
    await insertSource(fx.notebook.id, fx.owner.id, { title: "Nguồn bí mật", rawText: "nội dung bí mật" });
    return fx;
  }
  const publish = (user: TestUser, id: string, body: Record<string, unknown>) =>
    patchPublish(makeRequest(`/api/notebooks/${id}/public`, { method: "PATCH", user, body }), params({ id }));

  it("chỉ owner bật công khai; tự sinh slug; slug trùng → 409; sai định dạng → 400", async () => {
    const { notebook, owner, members } = await setup();
    expect((await publish(members.admin, notebook.id, { isPublic: true })).status).toBe(403);
    expect((await publish(members.editor, notebook.id, { isPublic: true })).status).toBe(403);
    expect((await publish(await createTestUser("Lạ"), notebook.id, { isPublic: true })).status).toBe(404);

    const state = await json(await getPublishState(makeRequest(`/api/notebooks/${notebook.id}/public`, { user: owner }), params({ id: notebook.id })));
    expect(state).toMatchObject({ isPublic: false, slug: null });
    expect(state.suggestedSlug).toBe("so-tay-test");

    const res = await publish(owner, notebook.id, { isPublic: true });
    expect(res.status).toBe(200);
    const { slug } = await json(res);
    expect(slug).toMatch(/^so-tay-test/);

    const other = await createNotebookWithMembers([]);
    const conflict = await publish(other.owner, other.notebook.id, { isPublic: true, slug });
    expect(conflict.status).toBe(409);
    expect((await json(conflict)).error.code).toBe("slug_taken");
    expect((await publish(owner, notebook.id, { isPublic: true, slug: "Sai Định Dạng!" })).status).toBe(400);
    expect((await publish(owner, notebook.id, { isPublic: true, slug: "ab" })).status).toBe(400);
    // đổi slug của chính mình
    const mine = await publish(owner, notebook.id, { isPublic: true, slug: `moi-${Date.now()}` });
    expect(mine.status).toBe(200);
  });

  it("trang công khai KHÔNG lộ nguồn, ghi chú, chat, thành viên; chỉ artifact công khai", async () => {
    const { notebook, owner } = await setup();
    const slug = `cong-khai-${Date.now()}`;
    await publish(owner, notebook.id, { isPublic: true, slug });
    const pub = await publicArtifact(notebook.id, owner.id, { title: "Bài đã công khai" });
    await insertArtifact(notebook.id, owner.id, { visibility: "notebook", title: "Bài nội bộ" });

    const res = await getPublicNotebook(makeRequest(`/api/public/notebooks/${slug}`), params({ slug }));
    expect(res.status).toBe(200); // không cần đăng nhập
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.notebook).toMatchObject({ slug, title: "Sổ tay test", ownerName: "Chủ sổ tay" });
    expect(body.notebook.artifacts.map((a: any) => a.id)).toEqual([pub.id]);
    expect(Object.keys(body.notebook).sort()).toEqual(["artifacts", "coverColor", "description", "emoji", "id", "ownerName", "slug", "title"]);
    for (const secret of ["Nguồn bí mật", "nội dung bí mật", "Bài nội bộ", "members", "sources", "notes", "channels", "@test.local"]) {
      expect(raw).not.toContain(secret);
    }

    // tắt công khai → 404; slug sai → 404
    await publish(owner, notebook.id, { isPublic: false });
    expect((await getPublicNotebook(makeRequest(`/api/public/notebooks/${slug}`), params({ slug }))).status).toBe(404);
    expect((await getPublicNotebook(makeRequest("/api/public/notebooks/nope-nope"), params({ slug: "nope-nope" }))).status).toBe(404);
  });

  it("Explore liệt kê sổ tay công khai, không liệt kê sổ tay đã tắt / đã xoá", async () => {
    const { notebook, owner } = await setup();
    const viewer = await createTestUser("V");
    const slug = `lk-${Date.now()}`;
    await publish(owner, notebook.id, { isPublic: true, slug });
    const list = async () => json(await exploreNotebooks(makeRequest("/api/explore/notebooks", { user: viewer, query: "?q=Sổ tay test" })));
    expect((await list()).items.some((i: any) => i.slug === slug)).toBe(true);
    await publish(owner, notebook.id, { isPublic: false });
    expect((await list()).items.some((i: any) => i.slug === slug)).toBe(false);
  });
});

describe("yêu cầu tham gia", () => {
  const request = (user: TestUser | null, id: string, message?: string) =>
    postJoinRequest(makeRequest(`/api/notebooks/${id}/join-requests`, { method: "POST", user, body: message ? { message } : {} }), params({ id }));
  const pending = (user: TestUser, id: string) => listJoinRequests(makeRequest(`/api/notebooks/${id}/join-requests`, { user }), params({ id }));
  const decide = (route: typeof acceptRequest, user: TestUser, id: string, requestId: string) =>
    route(makeRequest(`/api/notebooks/${id}/join-requests/${requestId}`, { method: "POST", user }), params({ id, requestId }));

  async function publicNotebook() {
    const fx = await createNotebookWithMembers(["admin", "editor", "viewer"]);
    await patchPublish(makeRequest(`/api/notebooks/${fx.notebook.id}/public`, { method: "PATCH", user: fx.owner, body: { isPublic: true, slug: `jr-${Date.now()}` } }), params({ id: fx.notebook.id }));
    return fx;
  }

  it("sổ tay không công khai → 404; thành viên → 409; chưa đăng nhập → 401", async () => {
    const { notebook, members } = await createNotebookWithMembers(["viewer"]);
    const guest = await createTestUser("Khách");
    expect((await request(guest, notebook.id)).status).toBe(404);
    expect((await request(null, notebook.id)).status).toBe(401);
    const pubFx = await publicNotebook();
    expect((await request(pubFx.members.viewer, pubFx.notebook.id)).status).toBe(409);
    void members;
  });

  it("gửi → báo owner/admin → admin chấp nhận → thành viên viewer; xử lý lại 409", async () => {
    const fx = await publicNotebook();
    const guest = await createTestUser("Người xin vào");
    const res = await request(guest, fx.notebook.id, "Cho em vào học với ạ");
    expect(res.status).toBe(201);
    const reqId = (await json(res)).request.id;
    expect((await request(guest, fx.notebook.id)).status).toBe(409); // đang chờ

    // owner + admin nhận thông báo; editor/viewer thì không
    const ownerNotifs = (await json(await listNotifications(makeRequest("/api/notifications", { user: fx.owner }), params({})))).notifications;
    expect(ownerNotifs.find((n: any) => n.type === "join_request")).toMatchObject({ link: `/n/${fx.notebook.id}/members?requests=1`, body: "Cho em vào học với ạ" });
    expect(ownerNotifs.find((n: any) => n.type === "join_request").title).toContain("Người xin vào");
    const adminNotifs = (await json(await listNotifications(makeRequest("/api/notifications", { user: fx.members.admin }), params({})))).notifications;
    expect(adminNotifs.some((n: any) => n.type === "join_request")).toBe(true);
    const editorNotifs = (await json(await listNotifications(makeRequest("/api/notifications", { user: fx.members.editor }), params({})))).notifications;
    expect(editorNotifs.some((n: any) => n.type === "join_request")).toBe(false);

    // quyền duyệt: chỉ admin+
    expect((await pending(fx.members.editor, fx.notebook.id)).status).toBe(403);
    expect((await decide(acceptRequest, fx.members.editor, fx.notebook.id, reqId)).status).toBe(403);
    expect((await decide(acceptRequest, guest, fx.notebook.id, reqId)).status).toBe(404);
    const list = (await json(await pending(fx.members.admin, fx.notebook.id))).requests;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: reqId, user: { name: "Người xin vào" }, message: "Cho em vào học với ạ" });

    expect(await getNotebookRole(guest.id, fx.notebook.id)).toBeNull();
    const ok = await decide(acceptRequest, fx.members.admin, fx.notebook.id, reqId);
    expect(ok.status).toBe(200);
    expect(await getNotebookRole(guest.id, fx.notebook.id)).toBe("viewer");
    expect((await decide(acceptRequest, fx.owner, fx.notebook.id, reqId)).status).toBe(409);
    expect((await decide(rejectRequest, fx.owner, fx.notebook.id, reqId)).status).toBe(409);
    expect((await json(await pending(fx.owner, fx.notebook.id))).requests).toHaveLength(0);

    const guestNotifs = (await json(await listNotifications(makeRequest("/api/notifications", { user: guest }), params({})))).notifications;
    expect(guestNotifs.find((n: any) => n.type === "join_accepted")).toMatchObject({ link: `/n/${fx.notebook.id}` });
  });

  it("từ chối → không thêm thành viên, được gửi lại; yêu cầu của sổ tay khác không duyệt chéo được", async () => {
    const fx = await publicNotebook();
    const other = await publicNotebook();
    const guest = await createTestUser("Xin vào");
    const reqId = (await json(await request(guest, fx.notebook.id))).request.id;
    // admin của sổ tay khác không duyệt được yêu cầu này
    expect((await decide(acceptRequest, other.owner, other.notebook.id, reqId)).status).toBe(404);
    expect((await decide(rejectRequest, fx.owner, fx.notebook.id, reqId)).status).toBe(200);
    expect(await getNotebookRole(guest.id, fx.notebook.id)).toBeNull();
    const again = await request(guest, fx.notebook.id);
    expect(again.status).toBe(201);
    const guestNotifs = (await json(await listNotifications(makeRequest("/api/notifications", { user: guest }), params({})))).notifications;
    expect(guestNotifs.some((n: any) => n.type === "join_rejected")).toBe(true);
  });
});
