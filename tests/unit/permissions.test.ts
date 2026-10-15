import { describe, expect, it } from "vitest";
import { ApiError } from "@/server/api/errors";
import {
  canViewArtifact,
  canViewSource,
  getNotebookRole,
  requireNotebookRole,
} from "@/server/auth/permissions";
import { db } from "@/server/db";
import { artifactShares, notebooks } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createNotebookWithMembers, insertArtifact, insertSource } from "../helpers/fixtures";
import { createTestUser } from "../helpers/users";

async function statusOf(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
}

describe("getNotebookRole / requireNotebookRole", () => {
  it("trả đúng vai trò của từng thành viên và null cho người ngoài", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin", "editor", "viewer"]);
    const outsider = await createTestUser();
    expect(await getNotebookRole(owner.id, notebook.id)).toBe("owner");
    expect(await getNotebookRole(members.admin.id, notebook.id)).toBe("admin");
    expect(await getNotebookRole(members.editor.id, notebook.id)).toBe("editor");
    expect(await getNotebookRole(members.viewer.id, notebook.id)).toBe("viewer");
    expect(await getNotebookRole(outsider.id, notebook.id)).toBeNull();
  });

  it("id không phải uuid → null, không ném lỗi SQL", async () => {
    const u = await createTestUser();
    expect(await getNotebookRole(u.id, "not-a-uuid")).toBeNull();
  });

  it("403 khi thiếu quyền, 404 khi không phải thành viên", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin", "editor", "viewer"]);
    const outsider = await createTestUser();

    expect(await statusOf(requireNotebookRole(owner.id, notebook.id, "owner"))).toBe(200);
    expect(await statusOf(requireNotebookRole(members.admin.id, notebook.id, "admin"))).toBe(200);
    expect(await statusOf(requireNotebookRole(members.admin.id, notebook.id, "owner"))).toBe(403);
    expect(await statusOf(requireNotebookRole(members.editor.id, notebook.id, "admin"))).toBe(403);
    expect(await statusOf(requireNotebookRole(members.editor.id, notebook.id, "editor"))).toBe(200);
    expect(await statusOf(requireNotebookRole(members.viewer.id, notebook.id, "editor"))).toBe(403);
    expect(await statusOf(requireNotebookRole(members.viewer.id, notebook.id, "viewer"))).toBe(200);
    expect(await statusOf(requireNotebookRole(outsider.id, notebook.id, "viewer"))).toBe(404);
  });

  it("notebook đã xoá mềm → 404 kể cả với owner", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    await db.update(notebooks).set({ deletedAt: new Date() }).where(eq(notebooks.id, notebook.id));
    expect(await getNotebookRole(owner.id, notebook.id)).toBeNull();
    expect(await statusOf(requireNotebookRole(owner.id, notebook.id, "viewer"))).toBe(404);
  });
});

describe("canViewSource", () => {
  it("nguồn shared: mọi thành viên thấy, người ngoài không", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer"]);
    const outsider = await createTestUser();
    const src = await insertSource(notebook.id, owner.id, { visibility: "shared" });
    expect(await canViewSource(owner.id, src)).toBe(true);
    expect(await canViewSource(members.viewer.id, src)).toBe(true);
    expect(await canViewSource(outsider.id, src)).toBe(false);
  });

  it("nguồn private: chỉ chủ nguồn, kể cả owner notebook cũng không thấy", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["editor"]);
    const src = await insertSource(notebook.id, members.editor.id, { visibility: "private" });
    expect(await canViewSource(members.editor.id, src)).toBe(true);
    expect(await canViewSource(owner.id, src)).toBe(false);
  });

  it("nguồn đã xoá mềm → không ai thấy", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const src = await insertSource(notebook.id, owner.id, { deletedAt: new Date() });
    expect(await canViewSource(owner.id, src)).toBe(false);
  });

  it("thành viên bị gỡ khỏi notebook thì mất quyền xem nguồn shared", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const src = await insertSource(notebook.id, owner.id);
    const stranger = await createTestUser();
    expect(await canViewSource(stranger.id, src)).toBe(false);
  });
});

describe("canViewArtifact", () => {
  it("private: chỉ người tạo", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["editor", "viewer"]);
    const a = await insertArtifact(notebook.id, members.editor.id, { visibility: "private" });
    expect(await canViewArtifact(members.editor.id, a)).toBe(true);
    expect(await canViewArtifact(owner.id, a)).toBe(false);
    expect(await canViewArtifact(members.viewer.id, a)).toBe(false);
    expect(await canViewArtifact(null, a)).toBe(false);
  });

  it("private + artifact_shares theo user/email: người được chia sẻ xem được", async () => {
    const { notebook, members } = await createNotebookWithMembers(["editor"]);
    const guest = await createTestUser();
    const other = await createTestUser();
    const a = await insertArtifact(notebook.id, members.editor.id, { visibility: "private" });
    await db.insert(artifactShares).values({ artifactId: a.id, userId: guest.id, role: "view" });
    await db.insert(artifactShares).values({ artifactId: a.id, email: other.email.toUpperCase(), role: "view" });
    expect(await canViewArtifact(guest.id, a)).toBe(true);
    expect(await canViewArtifact(other.id, a)).toBe(true);
    expect((await canViewArtifact((await createTestUser()).id, a))).toBe(false);
  });

  it("notebook: mọi thành viên, không phải người ngoài/khách", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer"]);
    const outsider = await createTestUser();
    const a = await insertArtifact(notebook.id, owner.id, { visibility: "notebook" });
    expect(await canViewArtifact(members.viewer.id, a)).toBe(true);
    expect(await canViewArtifact(outsider.id, a)).toBe(false);
    expect(await canViewArtifact(null, a)).toBe(false);
  });

  it("link: thành viên hoặc bất kỳ ai có đúng share_token", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer"]);
    const outsider = await createTestUser();
    const a = await insertArtifact(notebook.id, owner.id, { visibility: "link", shareToken: "tok-correct-123" });
    expect(await canViewArtifact(members.viewer.id, a)).toBe(true);
    expect(await canViewArtifact(outsider.id, a)).toBe(false);
    expect(await canViewArtifact(outsider.id, a, { shareToken: "tok-wrong-12345" })).toBe(false);
    expect(await canViewArtifact(outsider.id, a, { shareToken: "tok-correct-123" })).toBe(true);
    expect(await canViewArtifact(null, a, { shareToken: "tok-correct-123" })).toBe(true);
    expect(await canViewArtifact(null, a)).toBe(false);
  });

  it("share_token không có tác dụng khi visibility không phải link", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const outsider = await createTestUser();
    const a = await insertArtifact(notebook.id, owner.id, { visibility: "notebook", shareToken: "tok-abc-123456" });
    expect(await canViewArtifact(outsider.id, a, { shareToken: "tok-abc-123456" })).toBe(false);
  });

  it("public: ai cũng xem được kể cả khách; đã xoá thì không", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const a = await insertArtifact(notebook.id, owner.id, { visibility: "public" });
    expect(await canViewArtifact(null, a)).toBe(true);
    expect(await canViewArtifact((await createTestUser()).id, a)).toBe(true);
    const deleted = await insertArtifact(notebook.id, owner.id, { visibility: "public", deletedAt: new Date() });
    expect(await canViewArtifact(null, deleted)).toBe(false);
  });
});
