import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as acceptInvite } from "@/app/api/invites/[token]/accept/route";
import { db } from "@/server/db";
import { notebookConnections, notebookInvites, notebookMembers } from "@/server/db/schema";
import { changeMemberRole, inviteMember, removeMember } from "@/server/notebooks/service";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { json } from "../helpers/team-chat";
import { createTestUser, makeRequest, params } from "../helpers/users";

async function invite(notebookId: string, actorId: string, actorRole: "owner" | "admin", role: "viewer" | "editor" | "admin") {
  const target = await createTestUser("Khách mời");
  // email chưa có tài khoản khác → luôn tạo lời mời có token (dùng email của tài khoản này nhưng tạo qua service với email khác)
  const res = await inviteMember({ notebookId, actorId, actorRole, email: `moi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`, role });
  if (res.status !== "invited") throw new Error("expected invite");
  return { target, token: res.invite.token, inviteId: res.invite.id };
}

describe("M-6 · xoá thành viên dọn credential và lời mời của họ", () => {
  it("xoá kết nối ngoài (kể cả đã chia sẻ cho thành viên) và lời mời chưa chấp nhận do người đó tạo; kết nối của người khác giữ nguyên", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin", "editor"]);
    const nb = notebook.id;
    const mkConn = (ownerUserId: string, shared: boolean) =>
      db
        .insert(notebookConnections)
        .values({ notebookId: nb, ownerUserId, provider: "notebooklm-bridge", label: "NB", sharedWithMembers: shared, credentialEnc: "v1:x:y:z", status: "ready" })
        .returning();
    const [adminConn] = await mkConn(members.admin.id, true);
    const [ownerConn] = await mkConn(owner.id, true);
    const pending = await invite(nb, members.admin.id, "admin", "editor");
    const ownerInvite = await invite(nb, owner.id, "owner", "viewer");

    await removeMember({ notebookId: nb, actorId: owner.id, actorRole: "owner", targetUserId: members.admin.id });

    expect(await db.select().from(notebookConnections).where(eq(notebookConnections.id, adminConn.id))).toHaveLength(0);
    expect(await db.select().from(notebookConnections).where(eq(notebookConnections.id, ownerConn.id))).toHaveLength(1);
    expect(await db.select().from(notebookInvites).where(eq(notebookInvites.id, pending.inviteId))).toHaveLength(0);
    expect(await db.select().from(notebookInvites).where(eq(notebookInvites.id, ownerInvite.inviteId))).toHaveLength(1);
    expect(await db.select().from(notebookMembers).where(and(eq(notebookMembers.notebookId, nb), eq(notebookMembers.userId, members.admin.id)))).toHaveLength(0);
  });

  it("tự rời sổ tay cũng dọn kết nối của mình", async () => {
    const { notebook, members } = await createNotebookWithMembers(["editor"]);
    const [conn] = await db
      .insert(notebookConnections)
      .values({ notebookId: notebook.id, ownerUserId: members.editor.id, provider: "notebooklm-bridge", label: "NB", sharedWithMembers: true })
      .returning();
    await removeMember({ notebookId: notebook.id, actorId: members.editor.id, actorRole: "editor", targetUserId: members.editor.id });
    expect(await db.select().from(notebookConnections).where(eq(notebookConnections.id, conn.id))).toHaveLength(0);
  });
});

describe("M-6 · lời mời do admin đã bị hạ vai trò không còn cấp vai trò cũ", () => {
  it("admin bị hạ xuống editor: lời mời admin/editor của họ vô hiệu (409 invite_revoked); lời mời của owner vẫn dùng được", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin"]);
    const nb = notebook.id;
    const viaAdmin = await invite(nb, members.admin.id, "admin", "editor");
    const adminRoleInvite = await invite(nb, owner.id, "owner", "admin");
    const ownerInvite = await invite(nb, owner.id, "owner", "viewer");
    // đưa token của lời mời vào đúng email của người nhận để qua bước khớp email
    const recipient = await createTestUser("Người nhận");
    await db.update(notebookInvites).set({ email: recipient.email.toLowerCase() }).where(eq(notebookInvites.id, viaAdmin.inviteId));
    await db.update(notebookInvites).set({ email: recipient.email.toLowerCase() }).where(eq(notebookInvites.id, ownerInvite.inviteId));
    void adminRoleInvite;

    await changeMemberRole({ notebookId: nb, actorId: owner.id, actorRole: "owner", targetUserId: members.admin.id, role: "viewer" });

    const bad = await acceptInvite(makeRequest("/x", { method: "POST", user: recipient }), params({ token: viaAdmin.token }));
    expect(bad.status).toBe(409);
    expect((await json(bad)).error.code).toBe("invite_revoked");
    expect(await db.select().from(notebookMembers).where(eq(notebookMembers.userId, recipient.id))).toHaveLength(0);

    const good = await acceptInvite(makeRequest("/x", { method: "POST", user: recipient }), params({ token: ownerInvite.token }));
    expect(good.status).toBe(200);
  });
});
