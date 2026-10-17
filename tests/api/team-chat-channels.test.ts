/* eslint-disable @typescript-eslint/no-explicit-any -- phản hồi JSON được kiểm tra bằng expect */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PATCH as renameChannel } from "@/app/api/notebooks/[id]/channels/[channelId]/route";
import { POST as markRead } from "@/app/api/notebooks/[id]/channels/[channelId]/read/route";
import { POST as muteChannel } from "@/app/api/notebooks/[id]/channels/[channelId]/mute/route";
import { GET as listChannels, POST as createChannel } from "@/app/api/notebooks/[id]/channels/route";
import { DELETE as deleteMember } from "@/app/api/notebooks/[id]/members/[userId]/route";
import { GET as getMessages } from "@/app/api/channels/[channelId]/messages/route";
import { db } from "@/server/db";
import { channelMembers, channels } from "@/server/db/schema";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { chatFixture, fetchMessages, generalChannelId, getChannels, json, openDm, send } from "../helpers/team-chat";
import { createTestUser, makeRequest, params } from "../helpers/users";

describe("danh sách kênh", () => {
  it("401 khi chưa đăng nhập; người ngoài sổ tay nhận 404", async () => {
    const { notebook } = await chatFixture();
    const anon = await listChannels(makeRequest(`/api/notebooks/${notebook.id}/channels`), params({ id: notebook.id }));
    expect(anon.status).toBe(401);
    const outsider = await createTestUser("Người ngoài");
    const { res } = await getChannels(outsider, notebook.id);
    expect(res.status).toBe(404);
  });

  it("mọi thành viên (kể cả viewer) thấy kênh general; unread = 0 khi chưa có tin", async () => {
    const { notebook, members, owner } = await chatFixture();
    for (const u of [owner, members.viewer, members.editor, members.admin]) {
      const { res, body } = await getChannels(u, notebook.id);
      expect(res.status).toBe(200);
      const general = body.channels.filter((c: any) => c.type === "general");
      expect(general).toHaveLength(1);
      expect(general[0].unread).toBe(0);
      expect(general[0].lastMessage).toBeNull();
    }
  });

  it("tự phục hồi: thiếu channel_members hoặc thiếu kênh general đều được tạo lại khi liệt kê", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    await db.delete(channelMembers).where(and(eq(channelMembers.channelId, general), eq(channelMembers.userId, members.viewer.id)));
    const { body } = await getChannels(members.viewer, notebook.id);
    expect(body.channels.some((c: any) => c.id === general)).toBe(true);
    const [row] = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, general), eq(channelMembers.userId, members.viewer.id)));
    expect(row).toBeTruthy();

    // Notebook "bị sót" kênh general
    await db.delete(channels).where(eq(channels.id, general));
    const again = await getChannels(owner, notebook.id);
    const regenerated = again.body.channels.filter((c: any) => c.type === "general");
    expect(regenerated).toHaveLength(1);
    // và mọi thành viên đều thuộc kênh mới
    const memberRows = await db.select().from(channelMembers).where(eq(channelMembers.channelId, regenerated[0].id));
    expect(memberRows).toHaveLength(4);
  });

  it("thành viên mới thêm sau cũng nằm trong general và mọi chủ đề đã có", async () => {
    const { notebook, owner } = await chatFixture();
    const topic = await createChannel(
      makeRequest(`/api/notebooks/${notebook.id}/channels`, { method: "POST", user: owner, body: { type: "topic", name: "Chương 1" } }),
      params({ id: notebook.id }),
    );
    expect(topic.status).toBe(201);
    const { addMember } = await import("@/server/notebooks/service");
    const late = await createTestUser("Người vào sau");
    await addMember(notebook.id, late.id, "viewer", owner.id);
    const { body } = await getChannels(late, notebook.id);
    expect(body.channels.map((c: any) => c.type).sort()).toEqual(["general", "topic"]);
  });
});

describe("tạo chủ đề", () => {
  it("viewer bị 403; editor tạo được; tên trùng → 409; mọi thành viên thấy chủ đề", async () => {
    const { notebook, members } = await chatFixture();
    const post = (user: any, name: string) =>
      createChannel(makeRequest(`/api/notebooks/${notebook.id}/channels`, { method: "POST", user, body: { type: "topic", name } }), params({ id: notebook.id }));
    expect((await post(members.viewer, "Không được")).status).toBe(403);
    const ok = await post(members.editor, "Báo cáo tuần");
    expect(ok.status).toBe(201);
    expect((await post(members.admin, "báo cáo TUẦN")).status).toBe(409);
    const { body } = await getChannels(members.viewer, notebook.id);
    expect(body.channels.find((c: any) => c.type === "topic")?.name).toBe("Báo cáo tuần");
  });

  it("validate: tên rỗng → 400", async () => {
    const { notebook, members } = await chatFixture();
    const res = await createChannel(
      makeRequest(`/api/notebooks/${notebook.id}/channels`, { method: "POST", user: members.editor, body: { type: "topic", name: "   " } }),
      params({ id: notebook.id }),
    );
    expect(res.status).toBe(400);
  });

  it("đổi tên: người tạo hoặc admin+; editor khác 403; general không đổi tên được", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const created = await createChannel(
      makeRequest(`/api/notebooks/${notebook.id}/channels`, { method: "POST", user: members.editor, body: { type: "topic", name: "Cũ" } }),
      params({ id: notebook.id }),
    );
    const topicId = (await json(created)).channel.id as string;
    const rename = (user: any, channelId: string, name: string) =>
      renameChannel(
        makeRequest(`/api/notebooks/${notebook.id}/channels/${channelId}`, { method: "PATCH", user, body: { name } }),
        params({ id: notebook.id, channelId }),
      );
    expect((await rename(members.viewer, topicId, "X")).status).toBe(403);
    const byCreator = await rename(members.editor, topicId, "Mới");
    expect(byCreator.status).toBe(200);
    expect((await json(byCreator)).channel.name).toBe("Mới");
    expect((await rename(members.admin, topicId, "Do admin")).status).toBe(200);
    expect((await rename(owner, general, "x")).status).toBe(400);

    // editor khác (không phải người tạo)
    const other = await createTestUser("Editor khác");
    const { addMember } = await import("@/server/notebooks/service");
    await addMember(notebook.id, other.id, "editor", owner.id);
    expect((await rename(other, topicId, "Chiếm quyền")).status).toBe(403);
  });
});

describe("tin nhắn riêng (DM)", () => {
  it("tạo idempotent, đúng 2 channel_members, người nhận thấy DM còn người thứ ba thì không", async () => {
    const { notebook, members, owner } = await chatFixture();
    const first = await openDm(members.editor, notebook.id, members.viewer.id);
    expect(first.res.status).toBe(201);
    const dmId = first.body.channel.id as string;
    expect(first.body.channel.type).toBe("dm");
    expect(first.body.channel.members.map((m: any) => m.id).sort()).toEqual([members.editor.id, members.viewer.id].sort());

    const again = await openDm(members.viewer, notebook.id, members.editor.id);
    expect(again.res.status).toBe(200);
    expect(again.body.channel.id).toBe(dmId);

    const rows = await db.select().from(channelMembers).where(eq(channelMembers.channelId, dmId));
    expect(rows).toHaveLength(2);

    const seenByViewer = await getChannels(members.viewer, notebook.id);
    expect(seenByViewer.body.channels.some((c: any) => c.id === dmId)).toBe(true);
    const seenByOwner = await getChannels(owner, notebook.id);
    expect(seenByOwner.body.channels.some((c: any) => c.id === dmId)).toBe(false);
  });

  it("DM chỉ giữa hai thành viên của sổ tay; không nhắn cho chính mình; người ngoài 404", async () => {
    const { notebook, members } = await chatFixture();
    const outsider = await createTestUser("Người ngoài");
    expect((await openDm(members.editor, notebook.id, outsider.id)).res.status).toBe(400);
    expect((await openDm(members.editor, notebook.id, members.editor.id)).res.status).toBe(400);
    expect((await openDm(outsider, notebook.id, members.editor.id)).res.status).toBe(404);
  });

  it("DM không rò rỉ: người thứ ba, admin, owner và người ngoài đều bị chặn mọi thao tác", async () => {
    const { notebook, members, owner } = await chatFixture();
    const { body } = await openDm(members.editor, notebook.id, members.viewer.id);
    const dmId = body.channel.id as string;
    const secret = await send(members.editor, dmId, { content: "bí mật về kế hoạch" });
    expect(secret.res.status).toBe(201);
    const messageId = secret.body.message.id as string;

    const outsider = await createTestUser("Người ngoài");
    for (const intruder of [members.admin, owner, outsider]) {
      expect((await fetchMessages(intruder, dmId)).res.status).toBe(404);
      expect((await send(intruder, dmId, { content: "chen ngang" })).res.status).toBe(404);

      const { PATCH: patchMsg, DELETE: delMsg } = await import("@/app/api/channels/[channelId]/messages/[messageId]/route");
      const p = params({ channelId: dmId, messageId });
      expect((await patchMsg(makeRequest("/x", { method: "PATCH", user: intruder, body: { content: "sửa" } }), p)).status).toBe(404);
      expect((await delMsg(makeRequest("/x", { method: "DELETE", user: intruder }), p)).status).toBe(404);
      const { POST: react } = await import("@/app/api/channels/[channelId]/messages/[messageId]/reactions/route");
      expect((await react(makeRequest("/x", { method: "POST", user: intruder, body: { emoji: "👍" } }), p)).status).toBe(404);
      const { POST: pin } = await import("@/app/api/channels/[channelId]/messages/[messageId]/pin/route");
      expect((await pin(makeRequest("/x", { method: "POST", user: intruder }), p)).status).toBe(404);
      const { POST: recall } = await import("@/app/api/channels/[channelId]/messages/[messageId]/recall/route");
      expect((await recall(makeRequest("/x", { method: "POST", user: intruder }), p)).status).toBe(404);
      const { GET: search } = await import("@/app/api/channels/[channelId]/messages/search/route");
      expect((await search(makeRequest("/x", { user: intruder, query: "?q=bí" }), params({ channelId: dmId }))).status).toBe(404);

      const read = await markRead(
        makeRequest("/x", { method: "POST", user: intruder, body: { messageId } }),
        params({ id: notebook.id, channelId: dmId }),
      );
      expect(read.status).toBe(404);
      const mute = await muteChannel(makeRequest("/x", { method: "POST", user: intruder, body: {} }), params({ id: notebook.id, channelId: dmId }));
      expect(mute.status).toBe(404);
    }

    // Tìm kiếm toàn sổ tay của người thứ ba không thấy tin trong DM
    const { GET: nbSearch } = await import("@/app/api/notebooks/[id]/messages/search/route");
    const thirdSearch = await nbSearch(makeRequest("/x", { user: members.admin, query: `?q=${encodeURIComponent("bí mật")}` }), params({ id: notebook.id }));
    expect((await json(thirdSearch)).results).toHaveLength(0);
    const ownSearch = await nbSearch(makeRequest("/x", { user: members.viewer, query: `?q=${encodeURIComponent("bí mật")}` }), params({ id: notebook.id }));
    expect((await json(ownSearch)).results).toHaveLength(1);

    // Người trong cuộc vẫn đọc được
    expect((await fetchMessages(members.viewer, dmId)).body.messages).toHaveLength(1);
  });

  it("kênh của sổ tay khác: thành viên sổ tay A không đọc được kênh general của sổ tay B", async () => {
    const a = await chatFixture();
    const b = await chatFixture();
    expect((await fetchMessages(a.owner, b.general)).res.status).toBe(404);
    expect((await send(a.owner, b.general, { content: "xâm nhập" })).res.status).toBe(404);
  });

  it("bị xoá khỏi sổ tay thì mất quyền vào mọi kênh, kể cả DM", async () => {
    const { notebook, members, owner } = await chatFixture();
    const { body } = await openDm(members.editor, notebook.id, members.viewer.id);
    const dmId = body.channel.id as string;
    const gen = await generalChannelId(owner, notebook.id);
    await send(members.editor, dmId, { content: "xin chào" });
    expect((await fetchMessages(members.viewer, dmId)).res.status).toBe(200);

    const removed = await deleteMember(
      makeRequest(`/api/notebooks/${notebook.id}/members/${members.viewer.id}`, { method: "DELETE", user: owner }),
      params({ id: notebook.id, userId: members.viewer.id }),
    );
    expect(removed.status).toBe(200);
    expect((await fetchMessages(members.viewer, dmId)).res.status).toBe(404);
    expect((await fetchMessages(members.viewer, gen)).res.status).toBe(404);
  });
});

describe("đã đọc / chưa đọc", () => {
  it("đếm chưa đọc bỏ tin của mình; đọc đến một tin thì giảm; đọc hết về 0; không lùi mốc", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    await send(owner, general, { content: "của tôi" });
    const m1 = (await send(members.editor, general, { content: "một" })).body.message;
    const m2 = (await send(members.editor, general, { content: "hai" })).body.message;
    const m3 = (await send(members.editor, general, { content: "ba" })).body.message;

    const unreadOf = async (u: any) => (await getChannels(u, notebook.id)).body.channels.find((c: any) => c.id === general).unread;
    expect(await unreadOf(owner)).toBe(3);
    expect(await unreadOf(members.viewer)).toBe(4);
    // gửi tin coi như đã đọc mọi thứ trước đó
    expect(await unreadOf(members.editor)).toBe(0);

    const read = (user: any, messageId: string) =>
      markRead(makeRequest("/x", { method: "POST", user, body: { messageId } }), params({ id: notebook.id, channelId: general }));
    expect((await read(members.viewer, m2.id)).status).toBe(200);
    expect(await unreadOf(members.viewer)).toBe(1);
    // đọc lùi về tin cũ không làm tăng lại
    await read(members.viewer, m1.id);
    expect(await unreadOf(members.viewer)).toBe(1);
    await read(members.viewer, m3.id);
    expect(await unreadOf(members.viewer)).toBe(0);

    const summary = await listChannels(makeRequest("/x", { user: owner, query: "?summary=1" }), params({ id: notebook.id }));
    expect((await json(summary)).unread).toBe(3);
  });

  it("tin đã thu hồi hoặc xoá không tính là chưa đọc; kênh tắt tiếng không tính vào tổng", async () => {
    const { notebook, members, general } = await chatFixture();
    const { POST: recall } = await import("@/app/api/channels/[channelId]/messages/[messageId]/recall/route");
    const a = (await send(members.editor, general, { content: "sẽ thu hồi" })).body.message;
    await send(members.editor, general, { content: "giữ lại" });
    await recall(makeRequest("/x", { method: "POST", user: members.editor }), params({ channelId: general, messageId: a.id }));
    const list = await getChannels(members.viewer, notebook.id);
    expect(list.body.channels.find((c: any) => c.id === general).unread).toBe(1);
    expect(list.body.unread).toBe(1);

    const muted = await muteChannel(
      makeRequest("/x", { method: "POST", user: members.viewer, body: { muted: true } }),
      params({ id: notebook.id, channelId: general }),
    );
    expect((await json(muted)).muted).toBe(true);
    const after = await getChannels(members.viewer, notebook.id);
    expect(after.body.channels.find((c: any) => c.id === general).muted).toBe(true);
    expect(after.body.unread).toBe(0);
  });

  it("messageId không thuộc kênh → 400", async () => {
    const { notebook, members, general, owner } = await chatFixture();
    const other = await createNotebookWithMembers([]);
    const gen2 = await generalChannelId(other.owner, other.notebook.id);
    const foreign = (await send(other.owner, gen2, { content: "ở sổ tay khác" })).body.message;
    const res = await markRead(
      makeRequest("/x", { method: "POST", user: owner, body: { messageId: foreign.id } }),
      params({ id: notebook.id, channelId: general }),
    );
    expect(res.status).toBe(400);
    void members;
  });
});

describe("phân trang keyset", () => {
  it("trả mới nhất trước, before/after/around nhất quán và không trùng lặp", async () => {
    const { members, general } = await chatFixture();
    const ids: string[] = [];
    for (let i = 1; i <= 9; i++) ids.push((await send(members.editor, general, { content: `tin ${i}` })).body.message.id);

    const page1 = (await fetchMessages(members.viewer, general, "?limit=4")).body;
    expect(page1.messages.map((m: any) => m.content)).toEqual(["tin 9", "tin 8", "tin 7", "tin 6"]);
    expect(page1.hasMore).toBe(true);
    expect(page1.hasNewer).toBe(false);
    expect(page1.pinned).toEqual([]);
    expect(Array.isArray(page1.reads)).toBe(true);

    const page2 = (await fetchMessages(members.viewer, general, `?limit=4&before=${page1.messages[3].id}`)).body;
    expect(page2.messages.map((m: any) => m.content)).toEqual(["tin 5", "tin 4", "tin 3", "tin 2"]);
    expect(page2.hasMore).toBe(true);
    expect(page2.pinned).toBeUndefined();

    const page3 = (await fetchMessages(members.viewer, general, `?limit=4&before=${page2.messages[3].id}`)).body;
    expect(page3.messages.map((m: any) => m.content)).toEqual(["tin 1"]);
    expect(page3.hasMore).toBe(false);

    const newer = (await fetchMessages(members.viewer, general, `?limit=3&after=${ids[2]}`)).body;
    expect(newer.messages.map((m: any) => m.content)).toEqual(["tin 6", "tin 5", "tin 4"]);
    expect(newer.hasNewer).toBe(true);

    const around = (await fetchMessages(members.viewer, general, `?limit=4&around=${ids[4]}`)).body;
    expect(around.messages.map((m: any) => m.content)).toEqual(["tin 7", "tin 6", "tin 5", "tin 4"]);
    expect(around.hasMore).toBe(true);
    expect(around.hasNewer).toBe(true);
  });

  it("cursor sai hoặc thuộc kênh khác → 400; tham số xung đột → 400", async () => {
    const { members, general } = await chatFixture();
    const other = await chatFixture();
    const foreign = (await send(other.owner, other.general, { content: "x" })).body.message;
    expect((await fetchMessages(members.viewer, general, `?before=${foreign.id}`)).res.status).toBe(400);
    expect((await fetchMessages(members.viewer, general, "?before=abc")).res.status).toBe(400);
    expect((await fetchMessages(members.viewer, general, `?before=${foreign.id}&after=${foreign.id}`)).res.status).toBe(400);
    void getMessages;
  });
});
