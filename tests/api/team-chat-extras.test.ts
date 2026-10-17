/* eslint-disable @typescript-eslint/no-explicit-any -- phản hồi JSON được kiểm tra bằng expect */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { POST as uploadRoute } from "@/app/api/channels/[channelId]/upload/route";
import { POST as toSource } from "@/app/api/channels/[channelId]/messages/[messageId]/to-source/route";
import { POST as recallMsg } from "@/app/api/channels/[channelId]/messages/[messageId]/recall/route";
import { POST as notesFromMessages } from "@/app/api/notebooks/[id]/notes/from-messages/route";
import { GET as listNotifications } from "@/app/api/notifications/route";
import { POST as markNotifications } from "@/app/api/notifications/read/route";
import { db } from "@/server/db";
import { jobs, notes, sources } from "@/server/db/schema";
import { chatFixture, fetchMessages, json, openDm, send } from "../helpers/team-chat";
import { createTestUser, makeRequest, params, type TestUser } from "../helpers/users";

function uploadRequest(user: TestUser | null, channelId: string, files: { name: string; type: string; data: BlobPart }[]) {
  const form = new FormData();
  for (const f of files) form.append("files", new File([f.data], f.name, { type: f.type }));
  const headers = new Headers();
  if (user) headers.set("cookie", user.cookie);
  return new Request(`http://localhost:3000/api/channels/${channelId}/upload`, { method: "POST", headers, body: form });
}

async function upload(user: TestUser, channelId: string, files: { name: string; type: string; data: BlobPart }[]) {
  const res = await uploadRoute(uploadRequest(user, channelId, files), params({ channelId }));
  return { res, body: await json(res) };
}

const fileGet = (user: TestUser, id: string) => getFile(makeRequest(`/api/files/${id}`, { user }), params({ id }));

describe("tệp đính kèm", () => {
  it("tải lên → gửi kèm attachmentFileIds → thành viên kênh tải được, người ngoài thì không", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const up = await upload(members.viewer, general, [
      { name: "ảnh.png", type: "image/png", data: "PNGDATA" },
      { name: "báo cáo.pdf", type: "application/pdf", data: "%PDF-1.4" },
    ]);
    expect(up.res.status).toBe(201);
    expect(up.body.files).toHaveLength(2);
    expect(up.body.files[0]).toMatchObject({ name: "ảnh.png", mime: "image/png", size: 7 });

    const fileIds = up.body.files.map((f: any) => f.fileId);
    // Chưa gắn vào tin: chỉ chủ tệp đọc được
    expect((await fileGet(members.viewer, fileIds[0])).status).toBe(200);
    expect((await fileGet(owner, fileIds[0])).status).toBe(404);

    const sent = await send(members.viewer, general, { content: "đây là tài liệu", attachmentFileIds: fileIds });
    expect(sent.res.status).toBe(201);
    expect(sent.body.message.kind).toBe("file");
    expect(sent.body.message.attachments.map((a: any) => a.name)).toEqual(expect.arrayContaining(["ảnh.png", "báo cáo.pdf"]));

    expect((await fileGet(owner, fileIds[0])).status).toBe(200);
    expect(await (await fileGet(owner, fileIds[1])).text()).toBe("%PDF-1.4");
    const outsider = await createTestUser("Ngoài");
    expect((await fileGet(outsider, fileIds[0])).status).toBe(404);
    void notebook;
  });

  it("tệp trong DM chỉ hai người tải được; người khác 404", async () => {
    const { notebook, members, owner } = await chatFixture();
    const dm = (await openDm(members.editor, notebook.id, members.viewer.id)).body.channel.id as string;
    const up = await upload(members.editor, dm, [{ name: "riêng.txt", type: "text/plain", data: "hello" }]);
    const fileId = up.body.files[0].fileId as string;
    await send(members.editor, dm, { content: "", attachmentFileIds: [fileId] });
    expect((await fileGet(members.viewer, fileId)).status).toBe(200);
    expect((await fileGet(members.admin, fileId)).status).toBe(404);
    expect((await fileGet(owner, fileId)).status).toBe(404);
  });

  it("không đính kèm được tệp của người khác hoặc tệp đã dùng; upload kiểm tra quyền kênh và dung lượng", async () => {
    const { notebook, members, general } = await chatFixture();
    const dm = (await openDm(members.editor, notebook.id, members.viewer.id)).body.channel.id as string;

    const mine = (await upload(members.editor, general, [{ name: "a.txt", type: "text/plain", data: "a" }])).body.files[0].fileId as string;
    // người khác không dùng được fileId của tôi
    expect((await send(members.viewer, general, { content: "ăn cắp", attachmentFileIds: [mine] })).res.status).toBe(400);
    expect((await send(members.editor, general, { content: "ok", attachmentFileIds: [mine] })).res.status).toBe(201);
    // dùng lại lần hai
    expect((await send(members.editor, general, { content: "lần 2", attachmentFileIds: [mine] })).res.status).toBe(400);
    // fileId không tồn tại
    expect((await send(members.editor, general, { content: "x", attachmentFileIds: ["00000000-0000-4000-8000-000000000000"] })).res.status).toBe(400);

    // quyền upload
    expect((await upload(members.admin, dm, [{ name: "x.txt", type: "text/plain", data: "x" }])).res.status).toBe(404);
    const anon = await uploadRoute(uploadRequest(null, general, [{ name: "x.txt", type: "text/plain", data: "x" }]), params({ channelId: general }));
    expect(anon.status).toBe(401);
    // dung lượng (MAX_UPLOAD_MB=1 trong môi trường test)
    const big = await upload(members.editor, general, [{ name: "lớn.bin", type: "application/octet-stream", data: new Uint8Array(1.5 * 1024 * 1024) }]);
    expect(big.res.status).toBe(413);
    // không có tệp
    const empty = await uploadRoute(uploadRequest(members.editor, general, []), params({ channelId: general }));
    expect(empty.status).toBe(400);
  });

  it("thu hồi tin có tệp: tệp không còn truy cập qua chat với người khác", async () => {
    const { members, owner, general } = await chatFixture();
    const up = await upload(members.editor, general, [{ name: "nhạy cảm.txt", type: "text/plain", data: "secret" }]);
    const fileId = up.body.files[0].fileId as string;
    const msg = (await send(members.editor, general, { content: "", attachmentFileIds: [fileId] })).body.message;
    expect((await fileGet(owner, fileId)).status).toBe(200);
    await recallMsg(makeRequest("/x", { method: "POST", user: members.editor }), params({ channelId: general, messageId: msg.id }));
    expect((await fileGet(owner, fileId)).status).toBe(404);
    expect((await fileGet(members.editor, fileId)).status).toBe(200); // chủ tệp vẫn giữ
  });
});

describe("chuyển tệp chat vào Nguồn", () => {
  it("editor tạo sources(kind=chat_attachment, pending) và xếp job ingest_source; viewer 403; gọi lại không nhân đôi", async () => {
    const { notebook, members, general } = await chatFixture();
    const up = await upload(members.viewer, general, [{ name: "tài liệu.pdf", type: "application/pdf", data: "%PDF" }]);
    const msg = (
      await send(members.viewer, general, { content: "", attachmentFileIds: [up.body.files[0].fileId] })
    ).body.message;
    const call = (user: TestUser, body: unknown = {}) =>
      toSource(makeRequest("/x", { method: "POST", user, body }), params({ channelId: general, messageId: msg.id }));

    expect((await call(members.viewer)).status).toBe(403);
    const res = await call(members.editor);
    expect(res.status).toBe(201);
    const { sources: created } = await json(res);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: "tài liệu.pdf", status: "pending", existing: false });

    const [row] = await db.select().from(sources).where(eq(sources.id, created[0].id));
    expect(row).toMatchObject({
      kind: "chat_attachment",
      status: "pending",
      notebookId: notebook.id,
      createdBy: members.editor.id,
      fileId: up.body.files[0].fileId,
      visibility: "shared",
    });
    const queued = (await db.select().from(jobs).where(eq(jobs.type, "ingest_source"))).filter((j) => (j.payload as any).sourceId === row.id);
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("queued");

    const again = await call(members.admin);
    expect(again.status).toBe(200);
    expect((await json(again)).sources[0]).toMatchObject({ id: row.id, existing: true });
    expect((await db.select().from(jobs).where(eq(jobs.type, "ingest_source"))).filter((j) => (j.payload as any).sourceId === row.id)).toHaveLength(1);

    // attachmentId lạ → 400
    expect((await call(members.editor, { attachmentId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
  });

  it("tin không có tệp → 400; nguồn tạo từ DM là private", async () => {
    const { notebook, members, general } = await chatFixture();
    const plain = (await send(members.editor, general, { content: "chỉ chữ" })).body.message;
    const r = await toSource(makeRequest("/x", { method: "POST", user: members.editor, body: {} }), params({ channelId: general, messageId: plain.id }));
    expect(r.status).toBe(400);

    const dm = (await openDm(members.editor, notebook.id, members.viewer.id)).body.channel.id as string;
    const up = await upload(members.editor, dm, [{ name: "dm.txt", type: "text/plain", data: "dm" }]);
    const msg = (await send(members.editor, dm, { content: "", attachmentFileIds: [up.body.files[0].fileId] })).body.message;
    const res = await toSource(makeRequest("/x", { method: "POST", user: members.editor, body: {} }), params({ channelId: dm, messageId: msg.id }));
    const { sources: created } = await json(res);
    const [row] = await db.select().from(sources).where(eq(sources.id, created[0].id));
    expect(row.visibility).toBe("private");
    // người thứ ba không dùng được route này với DM
    const intruder = await toSource(makeRequest("/x", { method: "POST", user: members.admin, body: {} }), params({ channelId: dm, messageId: msg.id }));
    expect(intruder.status).toBe(404);
  });
});

describe("tạo note từ tin nhắn", () => {
  it("editor tạo note origin=team_chat với bản ghi 'Tên (hh:mm): nội dung'; viewer 403", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const m1 = (await send(members.editor, general, { content: "Họp lúc **9h** nhé" })).body.message;
    const m2 = (await send(members.viewer, general, { content: `ok @[${owner.name}](${owner.id})` })).body.message;
    const post = (user: TestUser, body: unknown) =>
      notesFromMessages(makeRequest("/x", { method: "POST", user, body }), params({ id: notebook.id }));

    expect((await post(members.viewer, { messageIds: [m1.id] })).status).toBe(403);
    // gửi thứ tự đảo vẫn ra theo thời gian
    const res = await post(members.editor, { channelId: general, messageIds: [m2.id, m1.id], timeZone: "Asia/Ho_Chi_Minh" });
    expect(res.status).toBe(201);
    const { noteId } = await json(res);
    const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(note).toMatchObject({ origin: "team_chat", notebookId: notebook.id, createdBy: members.editor.id, visibility: "shared" });
    expect(note.originRef).toEqual({ channelId: general, messageIds: [m1.id, m2.id] });
    expect(note.title).toContain("#general");
    const lines = note.contentMd.split("\n\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(new RegExp(`^\\*\\*${members.editor.name}\\*\\* \\(\\d{2}:\\d{2}\\): Họp lúc \\*\\*9h\\*\\* nhé$`));
    expect(lines[1]).toMatch(new RegExp(`^\\*\\*${members.viewer.name}\\*\\* \\(\\d{2}:\\d{2}\\): ok @${owner.name}$`));
  });

  it("từ chối: tin ở sổ tay/kênh khác, tin DM của người khác; tin thu hồi bị bỏ; DM → note private", async () => {
    const { notebook, members, general } = await chatFixture();
    const other = await chatFixture();
    const foreign = (await send(other.owner, other.general, { content: "khác sổ tay" })).body.message;
    const post = (user: TestUser, body: unknown) =>
      notesFromMessages(makeRequest("/x", { method: "POST", user, body }), params({ id: notebook.id }));
    expect((await post(members.editor, { messageIds: [foreign.id] })).status).toBe(404);
    expect((await post(members.editor, { messageIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(404);
    expect((await post(members.editor, { messageIds: [] })).status).toBe(400);

    const dm = (await openDm(members.viewer, notebook.id, members.admin.id)).body.channel.id as string;
    const secret = (await send(members.viewer, dm, { content: "chuyện riêng" })).body.message;
    // editor không thuộc DM → 404
    expect((await post(members.editor, { messageIds: [secret.id] })).status).toBe(404);

    // hai kênh khác nhau → 400
    const pub = (await send(members.admin, general, { content: "công khai" })).body.message;
    expect((await post(members.admin, { messageIds: [secret.id, pub.id] })).status).toBe(400);

    // người trong DM (admin) tạo note → riêng tư
    const ok = await post(members.admin, { messageIds: [secret.id] });
    expect(ok.status).toBe(201);
    const [note] = await db.select().from(notes).where(eq(notes.id, (await json(ok)).noteId));
    expect(note.visibility).toBe("private");

    // tin đã thu hồi bị loại; nếu tất cả bị thu hồi → 400
    const gone = (await send(members.admin, general, { content: "rồi thu hồi" })).body.message;
    await recallMsg(makeRequest("/x", { method: "POST", user: members.admin }), params({ channelId: general, messageId: gone.id }));
    expect((await post(members.admin, { messageIds: [gone.id] })).status).toBe(400);
    const mixed = await post(members.admin, { messageIds: [gone.id, pub.id] });
    expect(mixed.status).toBe(201);
    const [n2] = await db.select().from(notes).where(eq(notes.id, (await json(mixed)).noteId));
    expect(n2.contentMd).not.toContain("rồi thu hồi");
    expect(n2.contentMd).toContain("công khai");
  });
});

describe("API thông báo", () => {
  it("liệt kê (unread=1), đánh dấu theo ids hoặc tất cả, không đụng thông báo của người khác", async () => {
    const { members, general } = await chatFixture();
    await send(members.editor, general, { content: "một", mentions: [members.viewer.id] });
    await send(members.editor, general, { content: "hai", mentions: [members.viewer.id, members.admin.id] });

    const list = async (user: TestUser, q = "") => json(await listNotifications(makeRequest("/api/notifications", { user, query: q })));
    const anon = await listNotifications(makeRequest("/api/notifications"));
    expect(anon.status).toBe(401);

    const a = await list(members.viewer);
    expect(a.notifications).toHaveLength(2);
    expect(a.unreadCount).toBe(2);
    expect(a.notifications[0].createdAt >= a.notifications[1].createdAt).toBe(true);
    expect(a.notifications[0]).toMatchObject({ type: "mention", readAt: null });

    const mark = (user: TestUser, body: unknown) => markNotifications(makeRequest("/x", { method: "POST", user, body }));
    // người khác thử đánh dấu thông báo của viewer → không tác động
    await mark(members.admin, { ids: [a.notifications[0].id] });
    expect((await list(members.viewer)).unreadCount).toBe(2);

    const one = await json(await mark(members.viewer, { ids: [a.notifications[0].id] }));
    expect(one.unreadCount).toBe(1);
    expect((await list(members.viewer, "?unread=1")).notifications).toHaveLength(1);
    expect((await list(members.viewer)).notifications).toHaveLength(2);

    expect((await json(await mark(members.viewer, { all: true }))).unreadCount).toBe(0);
    expect((await list(members.viewer, "?unread=1")).notifications).toHaveLength(0);
    expect((await list(members.admin)).unreadCount).toBe(1);

    expect((await mark(members.viewer, {})).status).toBe(400);
  });

  it("đọc kênh đánh dấu đã đọc các thông báo mention/dm của kênh đó", async () => {
    const { notebook, members, general } = await chatFixture();
    const { POST: markRead } = await import("@/app/api/notebooks/[id]/channels/[channelId]/read/route");
    const sent = (await send(members.editor, general, { content: "xem giúp", mentions: [members.viewer.id] })).body.message;
    const count = async () => (await json(await listNotifications(makeRequest("/x", { user: members.viewer })))).unreadCount;
    expect(await count()).toBe(1);
    await markRead(makeRequest("/x", { method: "POST", user: members.viewer, body: { messageId: sent.id } }), params({ id: notebook.id, channelId: general }));
    expect(await count()).toBe(0);
    void fetchMessages;
  });
});
