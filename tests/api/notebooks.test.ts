import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as getNotebook, PATCH as patchNotebook, DELETE as deleteNotebook } from "@/app/api/notebooks/[id]/route";
import { GET as listNotebooks, POST as createNotebook } from "@/app/api/notebooks/route";
import { GET as listMembers, POST as inviteMember } from "@/app/api/notebooks/[id]/members/route";
import { PATCH as patchMember, DELETE as deleteMember } from "@/app/api/notebooks/[id]/members/[userId]/route";
import { POST as transfer } from "@/app/api/notebooks/[id]/transfer/route";
import { DELETE as revokeInvite } from "@/app/api/notebooks/[id]/invites/[inviteId]/route";
import { GET as getInvite } from "@/app/api/invites/[token]/route";
import { POST as acceptInvite } from "@/app/api/invites/[token]/accept/route";
import { db } from "@/server/db";
import { channelMembers, channels, notebookInvites, notebookMembers } from "@/server/db/schema";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { createTestUser, makeRequest, params, type TestUser } from "../helpers/users";

async function json<T = Record<string, any>>(res: Response): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (await res.json()) as T;
}

describe("POST/GET /api/notebooks", () => {
  it("401 khi chưa đăng nhập", async () => {
    const res = await listNotebooks(makeRequest("/api/notebooks"));
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("unauthorized");
  });

  it("tạo notebook: owner được thêm làm thành viên, có kênh general và channel_members", async () => {
    const u = await createTestUser();
    const res = await createNotebook(makeRequest("/api/notebooks", { method: "POST", user: u, body: { title: "  Giải tích 1  ", emoji: "🧪" } }));
    expect(res.status).toBe(201);
    const { notebook } = await json(res);
    expect(notebook.title).toBe("Giải tích 1");
    expect(notebook.emoji).toBe("🧪");
    expect(notebook.ownerId).toBe(u.id);

    const [member] = await db.select().from(notebookMembers).where(eq(notebookMembers.notebookId, notebook.id));
    expect(member).toMatchObject({ userId: u.id, role: "owner" });
    const chans = await db.select().from(channels).where(eq(channels.notebookId, notebook.id));
    expect(chans).toHaveLength(1);
    expect(chans[0].type).toBe("general");
    const cm = await db.select().from(channelMembers).where(eq(channelMembers.channelId, chans[0].id));
    expect(cm.map((c) => c.userId)).toEqual([u.id]);
  });

  it("validate input (title rỗng, màu ngoài bảng màu) → 400", async () => {
    const u = await createTestUser();
    const a = await createNotebook(makeRequest("/api/notebooks", { method: "POST", user: u, body: { title: "   " } }));
    expect(a.status).toBe(400);
    expect((await json(a)).error.code).toBe("validation_error");
    const b = await createNotebook(makeRequest("/api/notebooks", { method: "POST", user: u, body: { title: "ok", coverColor: "#123456" } }));
    expect(b.status).toBe(400);
  });

  it("liệt kê chỉ notebook của mình, kèm vai trò, số thành viên, lọc theo ?q=", async () => {
    const { owner, members } = await createNotebookWithMembers(["editor"]);
    await createNotebook(makeRequest("/api/notebooks", { method: "POST", user: owner, body: { title: "Hoá hữu cơ đặc biệt" } }));
    const other = await createTestUser();
    await createNotebook(makeRequest("/api/notebooks", { method: "POST", user: other, body: { title: "Của người khác" } }));

    const mine = await json(await listNotebooks(makeRequest("/api/notebooks", { user: owner })));
    expect(mine.notebooks.map((n: { title: string }) => n.title).sort()).toEqual(["Hoá hữu cơ đặc biệt", "Sổ tay test"]);
    const shared = mine.notebooks.find((n: { title: string }) => n.title === "Sổ tay test");
    expect(shared.role).toBe("owner");
    expect(shared.memberCount).toBe(2);

    const asEditor = await json(await listNotebooks(makeRequest("/api/notebooks", { user: members.editor })));
    expect(asEditor.notebooks).toHaveLength(1);
    expect(asEditor.notebooks[0].role).toBe("editor");

    const filtered = await json(await listNotebooks(makeRequest("/api/notebooks", { user: owner, query: "?q=hữu cơ" })));
    expect(filtered.notebooks).toHaveLength(1);
  });
});

describe("GET/PATCH/DELETE /api/notebooks/[id]", () => {
  it("GET: thành viên 200, người ngoài 404", async () => {
    const { notebook, members } = await createNotebookWithMembers(["viewer"]);
    const outsider = await createTestUser();
    const ok = await getNotebook(makeRequest(`/api/notebooks/${notebook.id}`, { user: members.viewer }), params({ id: notebook.id }));
    expect(ok.status).toBe(200);
    expect((await json(ok)).role).toBe("viewer");
    const no = await getNotebook(makeRequest(`/api/notebooks/${notebook.id}`, { user: outsider }), params({ id: notebook.id }));
    expect(no.status).toBe(404);
  });

  it("PATCH: viewer/editor 403, admin/owner 200 và dữ liệu đổi thật", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin", "editor", "viewer"]);
    const call = (user: typeof owner, body: unknown) =>
      patchNotebook(makeRequest(`/api/notebooks/${notebook.id}`, { method: "PATCH", user, body }), params({ id: notebook.id }));

    expect((await call(members.viewer, { title: "x" })).status).toBe(403);
    expect((await call(members.editor, { title: "x" })).status).toBe(403);
    const adminRes = await call(members.admin, { title: "Đổi bởi admin", systemInstruction: "Trả lời ngắn", allowWeb: true });
    expect(adminRes.status).toBe(200);
    const { notebook: updated } = await json(adminRes);
    expect(updated).toMatchObject({ title: "Đổi bởi admin", systemInstruction: "Trả lời ngắn", allowWeb: true });
    expect((await call(owner, { description: "mô tả" })).status).toBe(200);
  });

  it("PATCH: body rỗng/không hợp lệ → 400; admin không được đặt visibility public", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin"]);
    const call = (user: typeof owner, body: unknown) =>
      patchNotebook(makeRequest(`/api/notebooks/${notebook.id}`, { method: "PATCH", user, body }), params({ id: notebook.id }));
    expect((await call(owner, {})).status).toBe(400);
    expect((await call(owner, { defaultArtifactVisibility: "everyone" })).status).toBe(400);
    expect((await call(members.admin, { defaultArtifactVisibility: "public" })).status).toBe(403);
    expect((await call(members.admin, { defaultArtifactVisibility: "link" })).status).toBe(200);
    expect((await call(owner, { defaultArtifactVisibility: "public" })).status).toBe(200);
  });

  it("DELETE: chỉ owner; xoá mềm → biến mất khỏi danh sách và GET 404", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin"]);
    const del = (user: typeof owner) =>
      deleteNotebook(makeRequest(`/api/notebooks/${notebook.id}`, { method: "DELETE", user }), params({ id: notebook.id }));
    expect((await del(members.admin)).status).toBe(403);
    expect((await del(owner)).status).toBe(200);
    const get = await getNotebook(makeRequest(`/api/notebooks/${notebook.id}`, { user: owner }), params({ id: notebook.id }));
    expect(get.status).toBe(404);
    const list = await json(await listNotebooks(makeRequest("/api/notebooks", { user: owner })));
    expect(list.notebooks.find((n: { id: string }) => n.id === notebook.id)).toBeUndefined();
  });
});

describe("members API", () => {
  const invite = (nbId: string, user: TestUser, body: unknown) =>
    inviteMember(makeRequest(`/api/notebooks/${nbId}/members`, { method: "POST", user, body }), params({ id: nbId }));

  it("mời email đã có tài khoản → thêm ngay và vào kênh general", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const target = await createTestUser();
    const res = await invite(notebook.id, owner, { email: target.email.toUpperCase(), role: "editor" });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ status: "added", member: { userId: target.id, role: "editor" } });

    const [general] = await db.select().from(channels).where(eq(channels.notebookId, notebook.id));
    const cm = await db.select().from(channelMembers).where(eq(channelMembers.channelId, general.id));
    expect(cm.map((c) => c.userId)).toContain(target.id);

    // mời lại → 409
    const again = await invite(notebook.id, owner, { email: target.email, role: "viewer" });
    expect(again.status).toBe(409);
  });

  it("mời email chưa có tài khoản → tạo lời mời có token & link /invite/[token]", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const res = await invite(notebook.id, owner, { email: "chua-co@test.local", role: "viewer" });
    const body = await json(res);
    expect(body.status).toBe("invited");
    expect(body.invite.link).toBe(`/invite/${body.invite.token}`);
    expect(body.invite.token.length).toBeGreaterThanOrEqual(20);

    const list = await json(await listMembers(makeRequest(`/api/notebooks/${notebook.id}/members`, { user: owner }), params({ id: notebook.id })));
    expect(list.invites).toHaveLength(1);
    expect(list.invites[0].email).toBe("chua-co@test.local");
  });

  it("quy tắc gán vai trò: admin không gán admin/owner; editor/viewer không mời được", async () => {
    const { notebook, members } = await createNotebookWithMembers(["admin", "editor"]);
    expect((await invite(notebook.id, members.admin, { email: "a@test.local", role: "admin" })).status).toBe(403);
    expect((await invite(notebook.id, members.admin, { email: "a@test.local", role: "owner" })).status).toBe(400);
    expect((await invite(notebook.id, members.admin, { email: "a@test.local", role: "editor" })).status).toBe(201);
    expect((await invite(notebook.id, members.editor, { email: "b@test.local", role: "viewer" })).status).toBe(403);
  });

  it("viewer xem được danh sách nhưng không thấy lời mời đang chờ", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer"]);
    await invite(notebook.id, owner, { email: "cho@test.local", role: "viewer" });
    const res = await json(await listMembers(makeRequest(`/api/notebooks/${notebook.id}/members`, { user: members.viewer }), params({ id: notebook.id })));
    expect(res.members).toHaveLength(2);
    expect(res.invites).toEqual([]);
  });

  it("đổi vai trò: owner đổi được; admin không đổi admin khác/owner; không tự đổi", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin", "editor"]);
    const other = await createTestUser();
    await invite(notebook.id, owner, { email: other.email, role: "admin" });
    const patch = (user: typeof owner, target: string, role: string) =>
      patchMember(makeRequest(`/api/notebooks/${notebook.id}/members/${target}`, { method: "PATCH", user, body: { role } }), params({ id: notebook.id, userId: target }));

    expect((await patch(owner, members.editor.id, "viewer")).status).toBe(200);
    expect((await patch(members.admin, members.editor.id, "editor")).status).toBe(200);
    expect((await patch(members.admin, other.id, "viewer")).status).toBe(403); // admin khác
    expect((await patch(members.admin, owner.id, "viewer")).status).toBe(409); // owner bất biến
    expect((await patch(members.admin, members.admin.id, "viewer")).status).toBe(400); // tự đổi
    expect((await patch(members.editor, members.admin.id, "viewer")).status).toBe(403);
    const [row] = await db.select().from(notebookMembers).where(eq(notebookMembers.userId, members.editor.id));
    expect(row.role).toBe("editor");
  });

  it("xoá thành viên: owner không bị xoá; admin xoá được editor nhưng không xoá admin; tự rời được", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin", "editor", "viewer"]);
    const del = (user: typeof owner, target: string) =>
      deleteMember(makeRequest(`/api/notebooks/${notebook.id}/members/${target}`, { method: "DELETE", user }), params({ id: notebook.id, userId: target }));

    expect((await del(members.admin, owner.id)).status).toBe(409);
    expect((await del(owner, owner.id)).status).toBe(409);
    expect((await del(members.editor, members.viewer.id)).status).toBe(403);
    expect((await del(members.admin, members.editor.id)).status).toBe(200);
    // sau khi bị xoá, editor mất quyền và khỏi kênh general
    const get = await getNotebook(makeRequest(`/api/notebooks/${notebook.id}`, { user: members.editor }), params({ id: notebook.id }));
    expect(get.status).toBe(404);
    const [general] = await db.select().from(channels).where(eq(channels.notebookId, notebook.id));
    const cm = await db.select().from(channelMembers).where(eq(channelMembers.channelId, general.id));
    expect(cm.map((c) => c.userId)).not.toContain(members.editor.id);

    expect((await del(members.viewer, members.viewer.id)).status).toBe(200); // tự rời
    expect((await del(owner, members.admin.id)).status).toBe(200);
  });

  it("chuyển quyền sở hữu: chỉ owner, người nhận phải là thành viên; owner cũ thành admin", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin", "editor"]);
    const outsider = await createTestUser();
    const call = (user: typeof owner, userId: string) =>
      transfer(makeRequest(`/api/notebooks/${notebook.id}/transfer`, { method: "POST", user, body: { userId } }), params({ id: notebook.id }));

    expect((await call(members.admin, members.editor.id)).status).toBe(403);
    expect((await call(owner, outsider.id)).status).toBe(400);
    expect((await call(owner, owner.id)).status).toBe(400);
    expect((await call(owner, members.admin.id)).status).toBe(200);

    const rows = await db.select().from(notebookMembers).where(eq(notebookMembers.notebookId, notebook.id));
    const roleOf = (id: string) => rows.find((r) => r.userId === id)?.role;
    expect(roleOf(members.admin.id)).toBe("owner");
    expect(roleOf(owner.id)).toBe("admin");
    // chủ cũ không còn xoá được notebook
    const del = await deleteNotebook(makeRequest(`/api/notebooks/${notebook.id}`, { method: "DELETE", user: owner }), params({ id: notebook.id }));
    expect(del.status).toBe(403);
  });
});

describe("invites", () => {
  async function makeInvite(email: string, role = "editor") {
    const { owner, notebook } = await createNotebookWithMembers();
    const res = await inviteMember(
      makeRequest(`/api/notebooks/${notebook.id}/members`, { method: "POST", user: owner, body: { email, role } }),
      params({ id: notebook.id }),
    );
    const { invite } = await json(res);
    return { owner, notebook, invite };
  }

  it("GET /api/invites/[token] trả thông tin tối thiểu; token sai → 404", async () => {
    const { invite } = await makeInvite("nguoi-moi@test.local");
    const ok = await getInvite(makeRequest(`/api/invites/${invite.token}`), params({ token: invite.token }));
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(body.invite).toMatchObject({ role: "editor", email: "nguoi-moi@test.local", expired: false, used: false, emailMatches: null });
    const bad = await getInvite(makeRequest("/api/invites/nope"), params({ token: "nope" }));
    expect(bad.status).toBe(404);
  });

  it("chấp nhận lời mời: cần đăng nhập, đúng email → thành viên + vào kênh general; dùng lại → 409", async () => {
    const email = "dang-ky-sau@test.local";
    const { notebook, invite } = await makeInvite(email, "viewer");
    const anon = await acceptInvite(makeRequest(`/api/invites/${invite.token}/accept`, { method: "POST" }), params({ token: invite.token }));
    expect(anon.status).toBe(401);

    // người dùng đăng ký sau với đúng email
    const { getAuth } = await import("@/server/auth/auth");
    const su = await getAuth().api.signUpEmail({ body: { name: "Mới", email, password: "password-for-tests-123" } });
    const { headers } = await getAuth().api.signInEmail({ body: { email, password: "password-for-tests-123" }, returnHeaders: true });
    const user = { id: su.user.id, name: "Mới", email, cookie: headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };

    const res = await acceptInvite(makeRequest(`/api/invites/${invite.token}/accept`, { method: "POST", user }), params({ token: invite.token }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ notebookId: notebook.id, role: "viewer" });

    const [general] = await db.select().from(channels).where(eq(channels.notebookId, notebook.id));
    const cm = await db.select().from(channelMembers).where(eq(channelMembers.channelId, general.id));
    expect(cm.map((c) => c.userId)).toContain(user.id);

    const again = await acceptInvite(makeRequest(`/api/invites/${invite.token}/accept`, { method: "POST", user }), params({ token: invite.token }));
    expect(again.status).toBe(409);
  });

  it("sai email → 403; hết hạn → 400; thu hồi → 404", async () => {
    const { owner, notebook, invite } = await makeInvite("dung-email@test.local");
    const wrong = await createTestUser();
    const r1 = await acceptInvite(makeRequest(`/api/invites/${invite.token}/accept`, { method: "POST", user: wrong }), params({ token: invite.token }));
    expect(r1.status).toBe(403);

    await db.update(notebookInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(notebookInvites.token, invite.token));
    const r2 = await acceptInvite(makeRequest(`/api/invites/${invite.token}/accept`, { method: "POST", user: wrong }), params({ token: invite.token }));
    expect(r2.status).toBe(400);
    expect((await json(r2)).error.code).toBe("invite_expired");

    const revoke = await revokeInvite(
      makeRequest(`/api/notebooks/${notebook.id}/invites/${invite.id}`, { method: "DELETE", user: owner }),
      params({ id: notebook.id, inviteId: invite.id }),
    );
    expect(revoke.status).toBe(200);
    const r3 = await getInvite(makeRequest(`/api/invites/${invite.token}`), params({ token: invite.token }));
    expect(r3.status).toBe(404);
  });
});
