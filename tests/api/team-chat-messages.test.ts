/* eslint-disable @typescript-eslint/no-explicit-any -- phản hồi JSON được kiểm tra bằng expect */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as search } from "@/app/api/channels/[channelId]/messages/search/route";
import { DELETE as deleteMsg, PATCH as editMsg } from "@/app/api/channels/[channelId]/messages/[messageId]/route";
import { POST as pinMsg } from "@/app/api/channels/[channelId]/messages/[messageId]/pin/route";
import { POST as recallMsg } from "@/app/api/channels/[channelId]/messages/[messageId]/recall/route";
import { POST as reactMsg } from "@/app/api/channels/[channelId]/messages/[messageId]/reactions/route";
import { GET as notebookSearch } from "@/app/api/notebooks/[id]/messages/search/route";
import { db } from "@/server/db";
import { messageReactions, notifications, teamMessages } from "@/server/db/schema";
import { insertArtifact, insertSource } from "../helpers/fixtures";
import { chatFixture, fetchMessages, json, openDm, send } from "../helpers/team-chat";
import { createTestUser, makeRequest, params } from "../helpers/users";

const mp = (channelId: string, messageId: string) => params({ channelId, messageId });

function patch(user: any, channelId: string, messageId: string, body: unknown) {
  return editMsg(makeRequest("/x", { method: "PATCH", user, body }), mp(channelId, messageId));
}
function del(user: any, channelId: string, messageId: string) {
  return deleteMsg(makeRequest("/x", { method: "DELETE", user }), mp(channelId, messageId));
}
function recall(user: any, channelId: string, messageId: string) {
  return recallMsg(makeRequest("/x", { method: "POST", user }), mp(channelId, messageId));
}
function react(user: any, channelId: string, messageId: string, emoji: string) {
  return reactMsg(makeRequest("/x", { method: "POST", user, body: { emoji } }), mp(channelId, messageId));
}
function pin(user: any, channelId: string, messageId: string) {
  return pinMsg(makeRequest("/x", { method: "POST", user }), mp(channelId, messageId));
}

describe("gửi tin nhắn", () => {
  it("viewer chat được; trả về người gửi, nội dung đã cắt khoảng trắng", async () => {
    const { members, general } = await chatFixture();
    const { res, body } = await send(members.viewer, general, { content: "  Xin chào cả nhóm  " });
    expect(res.status).toBe(201);
    expect(body.message).toMatchObject({ content: "Xin chào cả nhóm", kind: "text", pinned: false, recalledAt: null, editedAt: null });
    expect(body.message.sender.id).toBe(members.viewer.id);
  });

  it("401 khi chưa đăng nhập; tin trống → 400; nội dung quá dài → 400", async () => {
    const { members, general } = await chatFixture();
    const { POST } = await import("@/app/api/channels/[channelId]/messages/route");
    expect((await POST(makeRequest("/x", { method: "POST", body: { content: "a" } }), params({ channelId: general }))).status).toBe(401);
    expect((await send(members.editor, general, { content: "   " })).res.status).toBe(400);
    expect((await send(members.editor, general, { content: "a".repeat(8001) })).res.status).toBe(400);
  });

  it("trả lời: replyTo có snippet; reply tới tin ở kênh khác → 400", async () => {
    const { members, general } = await chatFixture();
    const root = (await send(members.editor, general, { content: "Câu hỏi gốc" })).body.message;
    const reply = await send(members.viewer, general, { content: "Trả lời đây", replyToId: root.id });
    expect(reply.res.status).toBe(201);
    expect(reply.body.message.replyTo).toMatchObject({ id: root.id, snippet: "Câu hỏi gốc", senderName: members.editor.name, unavailable: false });

    const other = await chatFixture();
    const foreign = (await send(other.owner, other.general, { content: "kênh khác" })).body.message;
    expect((await send(members.viewer, general, { content: "x", replyToId: foreign.id })).res.status).toBe(400);
  });

  it("thu hồi tin gốc thì replyTo của tin trả lời báo không còn", async () => {
    const { members, general } = await chatFixture();
    const root = (await send(members.editor, general, { content: "Sẽ thu hồi" })).body.message;
    await send(members.viewer, general, { content: "đáp", replyToId: root.id });
    await recall(members.editor, general, root.id);
    const page = (await fetchMessages(members.viewer, general)).body;
    const reply = page.messages.find((m: any) => m.content === "đáp");
    expect(reply.replyTo).toMatchObject({ unavailable: true, snippet: "" });
  });
});

describe("mention và thông báo", () => {
  it("mention @[Tên](id) tạo thông báo 'mention' cho đúng người; bỏ qua người ngoài sổ tay và chính mình", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const outsider = await createTestUser("Người ngoài");
    const content = `Chào @[${members.viewer.name}](${members.viewer.id}) và @[Ngoài](${outsider.id}) cùng @[Tôi](${members.editor.id})`;
    const { res, body } = await send(members.editor, general, { content });
    expect(res.status).toBe(201);
    expect(body.message.mentions).toEqual([members.viewer.id]);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, members.viewer.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "mention", readAt: null });
    expect(rows[0].title).toContain(members.editor.name);
    expect(rows[0].link).toBe(`/n/${notebook.id}/team?channel=${general}&message=${body.message.id}`);
    expect((rows[0].data as any).messageId).toBe(body.message.id);

    expect(await db.select().from(notifications).where(eq(notifications.userId, outsider.id))).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.userId, members.editor.id))).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.userId, owner.id))).toHaveLength(0);
  });

  it("mention qua mentions[] (không có token trong nội dung) cũng được ghi nhận", async () => {
    const { members, general } = await chatFixture();
    const { body } = await send(members.editor, general, { content: "nhờ bạn xem giúp", mentions: [members.admin.id] });
    expect(body.message.mentions).toEqual([members.admin.id]);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, members.admin.id));
    expect(rows.map((r) => r.type)).toEqual(["mention"]);
  });

  it("DM tạo thông báo 'dm' cho người nhận (mention ưu tiên, không trùng); kênh tắt tiếng thì không báo", async () => {
    const { notebook, members } = await chatFixture();
    const dm = (await openDm(members.editor, notebook.id, members.viewer.id)).body.channel.id as string;
    await send(members.editor, dm, { content: "chào bạn" });
    let rows = await db.select().from(notifications).where(eq(notifications.userId, members.viewer.id));
    expect(rows.map((r) => r.type)).toEqual(["dm"]);

    await send(members.editor, dm, { content: `@[${members.viewer.name}](${members.viewer.id}) xem nhé` });
    rows = await db.select().from(notifications).where(eq(notifications.userId, members.viewer.id));
    expect(rows.map((r) => r.type).sort()).toEqual(["dm", "mention"]);

    const { POST: mute } = await import("@/app/api/notebooks/[id]/channels/[channelId]/mute/route");
    await mute(makeRequest("/x", { method: "POST", user: members.viewer, body: { muted: true } }), params({ id: notebook.id, channelId: dm }));
    await send(members.editor, dm, { content: "tin thứ ba" });
    rows = await db.select().from(notifications).where(eq(notifications.userId, members.viewer.id));
    expect(rows).toHaveLength(2);
    // người gửi không tự nhận thông báo
    expect(await db.select().from(notifications).where(eq(notifications.userId, members.editor.id))).toHaveLength(0);
  });

  it("DM: không thể mention người ngoài cuộc trò chuyện", async () => {
    const { notebook, members } = await chatFixture();
    const dm = (await openDm(members.editor, notebook.id, members.viewer.id)).body.channel.id as string;
    const { body } = await send(members.editor, dm, { content: `lén @[Admin](${members.admin.id})` });
    expect(body.message.mentions).toEqual([]);
    expect(await db.select().from(notifications).where(eq(notifications.userId, members.admin.id))).toHaveLength(0);
  });
});

describe("sửa / xoá / thu hồi", () => {
  it("chỉ sửa được tin của chính mình; đặt editedAt; nội dung trống → 400; mention mới sinh thông báo", async () => {
    const { members, general } = await chatFixture();
    const msg = (await send(members.editor, general, { content: "bản đầu" })).body.message;
    expect((await patch(members.admin, general, msg.id, { content: "chiếm" })).status).toBe(403);
    expect((await patch(members.editor, general, msg.id, { content: "  " })).status).toBe(400);
    const ok = await patch(members.editor, general, msg.id, { content: `bản sửa @[V](${members.viewer.id})` });
    expect(ok.status).toBe(200);
    const edited = (await json(ok)).message;
    expect(edited.content).toBe(`bản sửa @[V](${members.viewer.id})`);
    expect(edited.editedAt).toBeTruthy();
    expect(edited.mentions).toEqual([members.viewer.id]);
    expect(await db.select().from(notifications).where(eq(notifications.userId, members.viewer.id))).toHaveLength(1);

    // sửa lại cùng mention không báo lần nữa
    await patch(members.editor, general, msg.id, { content: `lại sửa @[V](${members.viewer.id})` });
    expect(await db.select().from(notifications).where(eq(notifications.userId, members.viewer.id))).toHaveLength(1);
  });

  it("xoá mềm: ẩn với mọi người, chỉ chủ tin hoặc admin+; viewer không xoá được tin người khác", async () => {
    const { members, owner, general } = await chatFixture();
    const mine = (await send(members.viewer, general, { content: "của viewer" })).body.message;
    const theirs = (await send(members.editor, general, { content: "của editor" })).body.message;
    expect((await del(members.viewer, general, theirs.id)).status).toBe(403);
    expect((await del(members.editor, general, theirs.id)).status).toBe(200);
    expect((await del(members.admin, general, mine.id)).status).toBe(200); // admin xoá tin người khác
    const page = (await fetchMessages(owner, general)).body;
    expect(page.messages).toHaveLength(0);
    // hàng vẫn còn trong DB với deleted_at
    const [row] = await db.select().from(teamMessages).where(eq(teamMessages.id, theirs.id));
    expect(row.deletedAt).not.toBeNull();
    expect((await del(members.editor, general, theirs.id)).status).toBe(404);
  });

  it("thu hồi khác xoá: còn dấu 'đã thu hồi' nhưng nội dung/tệp/reaction mất khỏi DB; chỉ chủ tin thu hồi", async () => {
    const { members, general } = await chatFixture();
    const msg = (await send(members.editor, general, { content: "nội dung nhạy cảm" })).body.message;
    await react(members.viewer, general, msg.id, "👍");
    await pin(members.editor, general, msg.id);

    expect((await recall(members.admin, general, msg.id)).status).toBe(403);
    const res = await recall(members.editor, general, msg.id);
    expect(res.status).toBe(200);
    expect((await json(res)).message).toMatchObject({ content: "", pinned: false, reactions: [], attachments: [] });

    const page = (await fetchMessages(members.viewer, general)).body;
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ id: msg.id, content: "" });
    expect(page.messages[0].recalledAt).toBeTruthy();
    expect(page.pinned).toEqual([]);

    const [row] = await db.select().from(teamMessages).where(eq(teamMessages.id, msg.id));
    expect(row.content).toBe("");
    expect(row.recalledAt).not.toBeNull();
    expect(await db.select().from(messageReactions).where(eq(messageReactions.messageId, msg.id))).toHaveLength(0);

    // đã thu hồi thì không sửa/react/ghim nữa
    expect((await patch(members.editor, general, msg.id, { content: "sửa" })).status).toBe(409);
    expect((await react(members.viewer, general, msg.id, "👍")).status).toBe(409);
    expect((await pin(members.editor, general, msg.id)).status).toBe(409);
    // thu hồi lại là idempotent
    expect((await recall(members.editor, general, msg.id)).status).toBe(200);
  });
});

describe("reaction và ghim", () => {
  it("toggle reaction: thêm → gỡ; gom nhóm theo emoji; emoji không hợp lệ → 400", async () => {
    const { members, general } = await chatFixture();
    const msg = (await send(members.editor, general, { content: "react đi" })).body.message;

    const a = await json(await react(members.viewer, general, msg.id, "👍"));
    expect(a.active).toBe(true);
    expect(a.reactions).toEqual([{ emoji: "👍", count: 1, userIds: [members.viewer.id] }]);
    const b = await json(await react(members.editor, general, msg.id, "👍"));
    expect(b.reactions[0].count).toBe(2);
    await react(members.editor, general, msg.id, "❤️");

    const page = (await fetchMessages(members.admin, general)).body;
    expect(page.messages[0].reactions.map((r: any) => [r.emoji, r.count])).toEqual([
      ["👍", 2],
      ["❤️", 1],
    ]);

    const off = await json(await react(members.viewer, general, msg.id, "👍"));
    expect(off.active).toBe(false);
    expect(off.reactions.find((r: any) => r.emoji === "👍")).toMatchObject({ count: 1, userIds: [members.editor.id] });
    expect((await react(members.viewer, general, msg.id, "abc")).status).toBe(400);
    expect((await react(members.viewer, general, msg.id, "")).status).toBe(400);
  });

  it("ghim: viewer 403, editor bật/tắt; danh sách ghim xuất hiện ở trang đầu", async () => {
    const { members, general } = await chatFixture();
    const msg = (await send(members.viewer, general, { content: "quan trọng" })).body.message;
    expect((await pin(members.viewer, general, msg.id)).status).toBe(403);
    const on = await json(await pin(members.editor, general, msg.id));
    expect(on.message.pinned).toBe(true);
    const page = (await fetchMessages(members.viewer, general)).body;
    expect(page.pinned.map((m: any) => m.id)).toEqual([msg.id]);
    const off = await json(await pin(members.admin, general, msg.id));
    expect(off.message.pinned).toBe(false);
    expect((await fetchMessages(members.viewer, general)).body.pinned).toEqual([]);
  });
});

describe("tìm kiếm", () => {
  it("tìm theo từ khoá (tsv) và theo một phần từ (ILIKE); bỏ tin đã thu hồi/xoá", async () => {
    const { members, owner, general } = await chatFixture();
    await send(members.editor, general, { content: "Báo cáo tuần này đã xong" });
    await send(members.editor, general, { content: "Kế hoạch tháng sau" });
    const rec = (await send(members.editor, general, { content: "báo cáo bí mật" })).body.message;
    const gone = (await send(members.editor, general, { content: "báo cáo đã xoá" })).body.message;
    await recall(members.editor, general, rec.id);
    await del(members.editor, general, gone.id);

    const q = async (user: any, term: string) => {
      const res = await search(makeRequest("/x", { user, query: `?q=${encodeURIComponent(term)}` }), params({ channelId: general }));
      return (await json(res)).results as any[];
    };
    expect((await q(owner, "báo cáo")).map((r) => r.content)).toEqual(["Báo cáo tuần này đã xong"]);
    expect((await q(owner, "kế hoạch")).map((r) => r.content)).toEqual(["Kế hoạch tháng sau"]);
    expect((await q(owner, "ếu hoạc")).length).toBe(0);
    expect((await q(owner, "hoạch th")).map((r) => r.content)).toEqual(["Kế hoạch tháng sau"]); // ILIKE một phần
    expect((await q(owner, "không có từ này")).length).toBe(0);
    const bad = await search(makeRequest("/x", { user: owner, query: "?q=" }), params({ channelId: general }));
    expect(bad.status).toBe(400);
  });

  it("tìm toàn sổ tay chỉ trong các kênh của mình và có tên kênh", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const dm = (await openDm(members.editor, notebook.id, members.viewer.id)).body.channel.id as string;
    await send(members.editor, general, { content: "từ khoá chung xyz" });
    await send(members.editor, dm, { content: "từ khoá riêng xyz" });
    const run = async (user: any) => {
      const res = await notebookSearch(makeRequest("/x", { user, query: "?q=xyz" }), params({ id: notebook.id }));
      return (await json(res)).results as any[];
    };
    expect((await run(owner)).map((r) => r.content)).toEqual(["từ khoá chung xyz"]);
    const viewerResults = await run(members.viewer);
    expect(viewerResults).toHaveLength(2);
    expect(viewerResults.find((r) => r.channelType === "dm")?.content).toBe("từ khoá riêng xyz");
    expect(viewerResults.find((r) => r.channelType === "general")?.channelName).toBe("general");

    const outsider = await createTestUser("Ngoài");
    const res = await notebookSearch(makeRequest("/x", { user: outsider, query: "?q=xyz" }), params({ id: notebook.id }));
    expect(res.status).toBe(404);
  });
});

describe("thẻ tham chiếu (artifact / nguồn / note)", () => {
  it("chia sẻ nguồn chung; mục riêng tư bị từ chối; id lạ → 404; sai loại → 400", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const shared = await insertSource(notebook.id, owner.id, { title: "Giáo trình", visibility: "shared" });
    const secret = await insertSource(notebook.id, owner.id, { title: "Bí mật", visibility: "private" });
    const art = await insertArtifact(notebook.id, owner.id, { title: "Slide chương 1", type: "slide_deck", visibility: "notebook" });
    const privArt = await insertArtifact(notebook.id, owner.id, { title: "Nháp", visibility: "private" });

    const ok = await send(members.viewer, general, { kind: "source_ref", refs: { sourceId: shared.id } });
    expect(ok.res.status).toBe(201);
    expect(ok.body.message.kind).toBe("source_ref");
    expect(ok.body.message.refs[0]).toMatchObject({ type: "source", id: shared.id, title: "Giáo trình", available: true });

    const artRes = await send(members.editor, general, { kind: "artifact_ref", refs: { artifactId: art.id }, content: "xem giúp" });
    expect(artRes.body.message.refs[0]).toMatchObject({ type: "artifact", subtype: "slide_deck", title: "Slide chương 1" });

    expect((await send(owner, general, { kind: "source_ref", refs: { sourceId: secret.id } })).res.status).toBe(400);
    expect((await send(owner, general, { kind: "artifact_ref", refs: { artifactId: privArt.id } })).res.status).toBe(400);
    expect((await send(owner, general, { kind: "source_ref", refs: { sourceId: "00000000-0000-4000-8000-000000000000" } })).res.status).toBe(404);
    expect((await send(owner, general, { kind: "source_ref", refs: { artifactId: art.id } })).res.status).toBe(400);
    expect((await send(owner, general, { kind: "text", content: "x", refs: { sourceId: shared.id } })).res.status).toBe(400);
    expect((await send(owner, general, { kind: "source_ref" })).res.status).toBe(400);

    // Nguồn ở sổ tay khác không chia sẻ được
    const other = await chatFixture();
    const foreign = await insertSource(other.notebook.id, other.owner.id, { title: "Ngoài" });
    expect((await send(owner, general, { kind: "source_ref", refs: { sourceId: foreign.id } })).res.status).toBe(404);
  });

  it("nguồn bị chuyển riêng tư/xoá sau khi chia sẻ → thẻ báo không còn truy cập", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const { sources } = await import("@/server/db/schema");
    const src = await insertSource(notebook.id, owner.id, { title: "Sẽ ẩn" });
    await send(owner, general, { kind: "source_ref", refs: { sourceId: src.id } });
    await db.update(sources).set({ visibility: "private" }).where(and(eq(sources.id, src.id)));
    const page = (await fetchMessages(members.viewer, general)).body;
    expect(page.messages[0].refs[0].available).toBe(false);
    const mine = (await fetchMessages(owner, general)).body;
    expect(mine.messages[0].refs[0].available).toBe(true);
  });
});
