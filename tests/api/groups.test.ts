/* eslint-disable @typescript-eslint/no-explicit-any -- phản hồi JSON được kiểm tra bằng expect */
import { describe, expect, it } from "vitest";
import { GET as exploreGroups } from "@/app/api/explore/groups/route";
import { GET as getGroup, PATCH as patchGroup, DELETE as deleteGroupRoute } from "@/app/api/groups/[groupId]/route";
import { POST as joinGroup } from "@/app/api/groups/[groupId]/join/route";
import { POST as addMember } from "@/app/api/groups/[groupId]/members/route";
import { DELETE as removeMember, PATCH as patchMember } from "@/app/api/groups/[groupId]/members/[userId]/route";
import { POST as linkNotebook } from "@/app/api/groups/[groupId]/notebooks/route";
import { DELETE as unlinkNotebook } from "@/app/api/groups/[groupId]/notebooks/[notebookId]/route";
import { POST as createGroupRoute } from "@/app/api/groups/route";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { createTestUser, makeRequest, params, type TestUser } from "../helpers/users";

async function json(res: Response): Promise<any> {
  return res.json();
}

async function createGroup(user: TestUser, body: Record<string, unknown>) {
  const res = await createGroupRoute(makeRequest("/api/groups", { method: "POST", user, body }));
  return { res, body: await json(res) };
}
const get = (user: TestUser | null, groupId: string) => getGroup(makeRequest(`/api/groups/${groupId}`, { user }), params({ groupId }));
const join = (user: TestUser, groupId: string) => joinGroup(makeRequest(`/api/groups/${groupId}/join`, { method: "POST", user }), params({ groupId }));
const add = (user: TestUser, groupId: string, body: Record<string, unknown>) =>
  addMember(makeRequest(`/api/groups/${groupId}/members`, { method: "POST", user, body }), params({ groupId }));
const link = (user: TestUser, groupId: string, notebookId: string) =>
  linkNotebook(makeRequest(`/api/groups/${groupId}/notebooks`, { method: "POST", user, body: { notebookId } }), params({ groupId }));
const unlink = (user: TestUser, groupId: string, notebookId: string) =>
  unlinkNotebook(makeRequest(`/api/groups/${groupId}/notebooks/${notebookId}`, { method: "DELETE", user }), params({ groupId, notebookId }));

describe("nhóm học tập", () => {
  it("tạo nhóm: chủ nhóm là owner, slug tự sinh duy nhất, slug trùng → 409", async () => {
    const owner = await createTestUser("Chủ nhóm");
    const tag = Date.now();
    const a = await createGroup(owner, { name: `Nhóm Sinh học ${tag}`, visibility: "public" });
    expect(a.res.status).toBe(201);
    expect(a.body.group).toMatchObject({ slug: `nhom-sinh-hoc-${tag}`, memberCount: 1, myRole: "owner", visibility: "public" });
    const b = await createGroup(owner, { name: `Nhóm Sinh học ${tag}` });
    expect(b.res.status).toBe(201);
    expect(b.body.group.slug).not.toBe(a.body.group.slug);
    const dup = await createGroup(owner, { name: "Khác", slug: a.body.group.slug });
    expect(dup.res.status).toBe(409);
    expect((await createGroup(owner, { name: "x" })).res.status).toBe(400);
    expect((await createGroupRoute(makeRequest("/api/groups", { method: "POST", user: null, body: { name: "Không đăng nhập" } }))).status).toBe(401);
  });

  it("nhóm mở: ai cũng xem và tham gia; nhóm kín: người ngoài 404, không tự tham gia được", async () => {
    const owner = await createTestUser("Chủ");
    const guest = await createTestUser("Khách");
    const open = (await createGroup(owner, { name: "Nhóm mở", visibility: "public" })).body.group;
    const closed = (await createGroup(owner, { name: "Nhóm kín", visibility: "private" })).body.group;

    expect((await get(guest, open.id)).status).toBe(200);
    expect((await json(await get(guest, open.id))).group.myRole).toBeNull();
    expect((await get(guest, closed.id)).status).toBe(404);
    expect((await join(guest, closed.id)).status).toBe(404);

    const joined = await join(guest, open.id);
    expect(joined.status).toBe(200);
    expect((await json(joined)).group).toMatchObject({ myRole: "member", memberCount: 2 });
    expect((await join(guest, open.id)).status).toBe(200); // idempotent
    expect((await json(await get(guest, open.id))).group.memberCount).toBe(2);

    // Explore: nhóm mở hiện ra, nhóm kín chỉ thành viên thấy
    const list = async (u: TestUser) => json(await exploreGroups(makeRequest("/api/explore/groups", { user: u, query: "?q=Nhóm" })));
    const guestIds = (await list(guest)).items.map((g: any) => g.id);
    expect(guestIds).toContain(open.id);
    expect(guestIds).not.toContain(closed.id);
    expect((await list(owner)).items.map((g: any) => g.id)).toContain(closed.id);
  });

  it("nhóm kín: chủ nhóm thêm bằng email; thành viên thường không thêm được; email lạ → 404", async () => {
    const owner = await createTestUser("Chủ");
    const member = await createTestUser("Thành viên");
    const outsider = await createTestUser("Người ngoài");
    const g = (await createGroup(owner, { name: "Kín", visibility: "private" })).body.group;

    expect((await add(owner, g.id, { email: "khong-ton-tai@test.local" })).status).toBe(404);
    expect((await add(outsider, g.id, { email: member.email })).status).toBe(404); // nhóm kín: không lộ sự tồn tại
    const ok = await add(owner, g.id, { email: member.email });
    expect(ok.status).toBe(201);
    expect((await add(owner, g.id, { email: member.email })).status).toBe(409);
    expect((await add(member, g.id, { email: outsider.email })).status).toBe(403);
    expect((await get(member, g.id)).status).toBe(200);
    // thành viên thường không thấy email của người khác
    const detail = await json(await get(member, g.id));
    expect(detail.members.every((m: any) => m.email === null)).toBe(true);
    const ownerView = await json(await get(owner, g.id));
    expect(ownerView.members.some((m: any) => m.email === member.email)).toBe(true);
  });

  it("vai trò: chỉ owner đặt admin, admin sửa nhóm nhưng không xoá nhóm; owner không rời được; rời nhóm", async () => {
    const owner = await createTestUser("Chủ");
    const admin = await createTestUser("QTV");
    const member = await createTestUser("TV");
    const g = (await createGroup(owner, { name: "Vai trò", visibility: "public" })).body.group;
    await join(admin, g.id);
    await join(member, g.id);

    const setRole = (actor: TestUser, target: TestUser, role: string) =>
      patchMember(makeRequest(`/api/groups/${g.id}/members/${target.id}`, { method: "PATCH", user: actor, body: { role } }), params({ groupId: g.id, userId: target.id }));
    expect((await setRole(admin, member, "admin")).status).toBe(403);
    expect((await setRole(owner, admin, "admin")).status).toBe(200);
    expect((await json(await get(admin, g.id))).group.myRole).toBe("admin");

    const edit = (u: TestUser) => patchGroup(makeRequest(`/api/groups/${g.id}`, { method: "PATCH", user: u, body: { description: "Mô tả mới" } }), params({ groupId: g.id }));
    expect((await edit(member)).status).toBe(403);
    expect((await edit(admin)).status).toBe(200);
    const del = (u: TestUser) => deleteGroupRoute(makeRequest(`/api/groups/${g.id}`, { method: "DELETE", user: u }), params({ groupId: g.id }));
    expect((await del(admin)).status).toBe(403);

    const remove = (actor: TestUser, target: TestUser) =>
      removeMember(makeRequest(`/api/groups/${g.id}/members/${target.id}`, { method: "DELETE", user: actor }), params({ groupId: g.id, userId: target.id }));
    expect((await remove(member, admin)).status).toBe(403);
    expect((await remove(owner, owner)).status).toBe(409); // owner không rời được
    expect((await remove(admin, owner)).status).toBe(409);
    expect((await remove(admin, member)).status).toBe(200); // admin xoá thành viên
    expect((await remove(admin, admin)).status).toBe(200); // tự rời
    expect((await del(owner)).status).toBe(200);
    expect((await get(owner, g.id)).status).toBe(404);
  });

  it("liên kết sổ tay: cần là thành viên nhóm VÀ admin+ của sổ tay; người xem chỉ thấy sổ tay truy cập được (còn lại là ổ khoá)", async () => {
    const owner = await createTestUser("Chủ nhóm");
    const g = (await createGroup(owner, { name: "Liên kết", visibility: "public" })).body.group;
    const mine = await createNotebookWithMembers(["editor"]);
    const nbOwner = mine.owner;
    await join(nbOwner, g.id);
    await join(mine.members.editor, g.id);

    // editor của sổ tay (không phải admin) → 403; người không ở trong nhóm → 403
    expect((await link(mine.members.editor, g.id, mine.notebook.id)).status).toBe(403);
    const lonely = await createTestUser("Ngoài nhóm");
    expect((await link(lonely, g.id, mine.notebook.id)).status).toBe(403);
    // sổ tay không tồn tại với người gọi → 404
    expect((await link(owner, g.id, mine.notebook.id)).status).toBe(404);
    const ok = await link(nbOwner, g.id, mine.notebook.id);
    expect(ok.status).toBe(201);
    expect((await json(ok)).notebooks).toHaveLength(1);
    expect((await link(nbOwner, g.id, mine.notebook.id)).status).toBe(201); // idempotent

    // thành viên nhóm không thuộc sổ tay: thấy tiêu đề + khoá, không thấy mô tả/emoji
    const locked = (await json(await get(owner, g.id))).notebooks;
    expect(locked).toEqual([expect.objectContaining({ id: mine.notebook.id, title: "Sổ tay test", accessible: false, emoji: null, description: null })]);
    // thành viên sổ tay thấy bình thường
    const open = (await json(await get(mine.members.editor, g.id))).notebooks;
    expect(open[0]).toMatchObject({ accessible: true });
    // người ngoài nhóm (nhóm mở) không thành viên sổ tay: không thấy danh sách
    expect((await json(await get(lonely, g.id))).notebooks).toEqual([]);

    // gỡ liên kết: editor sổ tay (không admin, không admin nhóm) → 403; admin nhóm / admin sổ tay được
    expect((await unlink(mine.members.editor, g.id, mine.notebook.id)).status).toBe(403);
    expect((await unlink(owner, g.id, mine.notebook.id)).status).toBe(200);
    expect((await json(await get(owner, g.id))).notebooks).toEqual([]);
  });
});
