/* eslint-disable @typescript-eslint/no-explicit-any -- phản hồi JSON được kiểm tra bằng expect */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as searchRoute } from "@/app/api/search/route";
import { db } from "@/server/db";
import { artifactVersions, artifacts, notes } from "@/server/db/schema";
import { insertReadySource } from "../helpers/artifacts";
import { createNotebookWithMembers, insertArtifact } from "../helpers/fixtures";
import { generalChannelId, openDm, send } from "../helpers/team-chat";
import { createTestUser, makeRequest, type TestUser } from "../helpers/users";

async function search(user: TestUser | null, q: string, extra = "") {
  const res = await searchRoute(makeRequest("/api/search", { user, query: `?q=${encodeURIComponent(q)}${extra}` }));
  return { res, body: (await res.json()) as any };
}

async function artifactWithText(notebookId: string, createdBy: string, over: Partial<typeof artifacts.$inferInsert>, md: string) {
  const art = await insertArtifact(notebookId, createdBy, over);
  const [v] = await db.insert(artifactVersions).values({ artifactId: art.id, versionNo: 1, content: { markdown: md, evidence: [] }, contentMd: md }).returning();
  await db.update(artifacts).set({ currentVersionId: v.id }).where(eq(artifacts.id, art.id));
  return art;
}

describe("tìm kiếm toàn cục", () => {
  it("yêu cầu đăng nhập và từ khoá hợp lệ", async () => {
    expect((await search(null, "abc")).res.status).toBe(401);
    const u = await createTestUser("U");
    expect((await search(u, "")).res.status).toBe(400);
    expect((await search(u, "abc", "&types=khac")).res.status).toBe(400);
    const empty = await search(u, "khongcogihetxyz");
    expect(empty.res.status).toBe(200);
    expect(Object.values(empty.body.groups).every((g: any) => g.length === 0)).toBe(true);
  });

  it("tìm đủ các loại trong sổ tay của mình, có snippet đánh dấu và liên kết sâu", async () => {
    const tag = `zebra${Date.now()}`;
    const fx = await createNotebookWithMembers(["editor"]);
    const { notebook, owner, members } = fx;
    const src = await insertReadySource(notebook.id, owner.id, { title: `Tài liệu ${tag}`, pages: [`Trang một nói về cây cối.`, `Đoạn này có từ khoá ${tag} nằm giữa câu để làm nổi bật.`] });
    await db.insert(notes).values({ notebookId: notebook.id, createdBy: owner.id, title: `Ghi chú ${tag}`, contentMd: `Nội dung ghi chú có ${tag} bên trong.` });
    const art = await artifactWithText(notebook.id, owner.id, { title: "Báo cáo cuối kỳ", visibility: "notebook" }, `# Kết luận\n\nTổng kết: ${tag} là điểm chính.`);
    const general = await generalChannelId(owner, notebook.id);
    const msg = await send(members.editor, general, { content: `Mọi người xem ${tag} nhé` });

    const { res, body } = await search(owner, tag);
    expect(res.status).toBe(200);
    const g = body.groups;

    const s = g.sources[0];
    expect(s).toMatchObject({ type: "sources", id: src.id, title: `Tài liệu ${tag}`, notebookId: notebook.id });
    expect(s.href).toMatch(new RegExp(`^/n/${notebook.id}/sources/${src.id}\\?chunk=[0-9a-f-]{36}$`));
    expect(s.snippet).toContain(`\u0001${tag}\u0002`);
    expect(s.meta.page).toBe(2);

    expect(g.notes[0]).toMatchObject({ title: `Ghi chú ${tag}`, href: expect.stringMatching(new RegExp(`^/n/${notebook.id}/notes\\?note=`)) });
    expect(g.notes[0].snippet).toContain(`\u0001${tag}\u0002`);
    expect(g.artifacts[0]).toMatchObject({ id: art.id, href: `/n/${notebook.id}/artifacts/${art.id}` });
    expect(g.artifacts[0].snippet).toContain(`\u0001${tag}\u0002`);
    expect(g.messages[0]).toMatchObject({ id: msg.body.message.id, href: `/n/${notebook.id}/team?channel=${general}&message=${msg.body.message.id}` });
    expect(g.messages[0].snippet).toContain(tag);

    // tiền tố: gõ dở từ vẫn khớp
    const prefix = await search(owner, tag.slice(0, -2));
    expect(prefix.body.groups.notes.length).toBe(1);

    // tìm theo tiêu đề sổ tay / types lọc
    const nb = await search(owner, "Sổ tay test", "&types=notebooks");
    expect(nb.body.groups.notebooks.some((n: any) => n.id === notebook.id)).toBe(true);
    expect(nb.body.groups.sources).toEqual([]);

    // thu hẹp theo sổ tay: không phải thành viên → 404
    const stranger = await createTestUser("Lạ");
    expect((await search(stranger, tag, `&notebookId=${notebook.id}`)).res.status).toBe(404);
    expect((await search(owner, tag, `&notebookId=${notebook.id}`)).res.status).toBe(200);
  });

  it("chỉ trong sổ tay mình là thành viên: người ngoài không thấy gì", async () => {
    const tag = `omega${Date.now()}`;
    const { notebook, owner } = await createNotebookWithMembers([]);
    await insertReadySource(notebook.id, owner.id, { title: `Bí mật ${tag}`, pages: [`nội dung ${tag}`] });
    await db.insert(notes).values({ notebookId: notebook.id, createdBy: owner.id, title: `Note ${tag}`, contentMd: tag });
    await artifactWithText(notebook.id, owner.id, { title: `Art ${tag}`, visibility: "notebook" }, tag);
    const outsider = await createTestUser("Người ngoài");
    const r = await search(outsider, tag);
    for (const key of ["notebooks", "sources", "notes", "artifacts", "messages", "public"]) expect(r.body.groups[key]).toEqual([]);
  });

  it("nguồn/ghi chú/artifact riêng tư và DM của người khác bị ẩn; của chính mình vẫn thấy", async () => {
    const tag = `priv${Date.now()}`;
    const fx = await createNotebookWithMembers(["editor", "viewer"]);
    const { notebook, owner, members } = fx;
    const editor = members.editor;
    const viewer = members.viewer;
    await insertReadySource(notebook.id, editor.id, { title: `Nguồn riêng ${tag}`, pages: [`riêng tư ${tag}`], visibility: "private" });
    await insertReadySource(notebook.id, owner.id, { title: `Nguồn chung ${tag}`, pages: [`dùng chung ${tag}`] });
    await db.insert(notes).values({ notebookId: notebook.id, createdBy: editor.id, title: `Note riêng ${tag}`, contentMd: tag, visibility: "private" });
    await artifactWithText(notebook.id, editor.id, { title: `Art riêng ${tag}`, visibility: "private" }, tag);
    const dm = await openDm(owner, notebook.id, editor.id);
    await send(owner, dm.body.channel.id, { content: `thì thầm ${tag}` });

    // viewer: chỉ thấy phần dùng chung
    const v = (await search(viewer, tag)).body.groups;
    expect(v.sources.map((s: any) => s.title)).toEqual([`Nguồn chung ${tag}`]);
    expect(v.notes).toEqual([]);
    expect(v.artifacts).toEqual([]);
    expect(v.messages).toEqual([]);
    // chủ nguồn/ghi chú/artifact riêng thấy của mình
    const e = (await search(editor, tag)).body.groups;
    expect(e.sources.map((s: any) => s.title).sort()).toEqual([`Nguồn chung ${tag}`, `Nguồn riêng ${tag}`]);
    expect(e.notes.map((n: any) => n.title)).toEqual([`Note riêng ${tag}`]);
    expect(e.artifacts.map((a: any) => a.title)).toEqual([`Art riêng ${tag}`]);
    expect(e.messages).toHaveLength(1); // DM giữa owner và editor
    // owner (không phải chủ nguồn riêng) không thấy nguồn/ghi chú/artifact riêng của editor nhưng thấy DM của mình
    const o = (await search(owner, tag)).body.groups;
    expect(o.sources.map((s: any) => s.title)).toEqual([`Nguồn chung ${tag}`]);
    expect(o.notes).toEqual([]);
    expect(o.artifacts).toEqual([]);
    expect(o.messages).toHaveLength(1);
    // người thứ ba trong sổ tay không thấy DM
    expect(v.messages).toEqual([]);
  });

  it("nhóm cộng đồng: artifact công khai của sổ tay khác hiện ra; riêng tư/nội bộ thì không", async () => {
    const tag = `pub${Date.now()}`;
    const other = await createNotebookWithMembers([]);
    const pub = await artifactWithText(other.notebook.id, other.owner.id, { title: `Công khai ${tag}`, visibility: "public" }, `nội dung ${tag}`);
    await artifactWithText(other.notebook.id, other.owner.id, { title: `Nội bộ ${tag}`, visibility: "notebook" }, tag);
    await artifactWithText(other.notebook.id, other.owner.id, { title: `Liên kết ${tag}`, visibility: "link" }, tag);
    const me = await createTestUser("Tôi");
    const r = (await search(me, tag)).body.groups;
    expect(r.public.map((p: any) => p.id)).toEqual([pub.id]);
    expect(r.public[0].href).toBe(`/a/${pub.id}`);
    expect(r.artifacts).toEqual([]);
    // chủ sổ tay thấy artifact của mình ở nhóm "artifacts", không lặp ở "public"
    const mine = (await search(other.owner, tag)).body.groups;
    expect(mine.artifacts.some((a: any) => a.id === pub.id)).toBe(true);
    expect(mine.public.some((a: any) => a.id === pub.id)).toBe(false);
    // tìm trong một sổ tay cụ thể không trộn kết quả công khai
    expect((await search(other.owner, tag, `&notebookId=${other.notebook.id}`)).body.groups.public).toEqual([]);
  });

  it("nguồn chưa sẵn sàng / đã xoá không lọt vào tìm kiếm đoạn", async () => {
    const tag = `del${Date.now()}`;
    const { notebook, owner } = await createNotebookWithMembers([]);
    const src = await insertReadySource(notebook.id, owner.id, { title: "Sẽ xoá", pages: [`nội dung ${tag}`] });
    expect((await search(owner, tag)).body.groups.sources).toHaveLength(1);
    const { sources } = await import("@/server/db/schema");
    await db.update(sources).set({ deletedAt: new Date() }).where(eq(sources.id, src.id));
    expect((await search(owner, tag)).body.groups.sources).toEqual([]);
  });
});
