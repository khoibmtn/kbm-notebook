/* eslint-disable @typescript-eslint/no-explicit-any -- payload sự kiện được kiểm tra bằng expect */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { channelMembers } from "@/server/db/schema";
import { attachSocketServer } from "@/server/realtime/socket";
import { chatFixture, fetchMessages, openDm, send } from "../helpers/team-chat";
import type { TestUser } from "../helpers/users";

let http: HttpServer;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  http = createServer();
  attachSocketServer(http);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/rt`;
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

function open(user: TestUser | null): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { transports: ["websocket"], extraHeaders: user ? { cookie: user.cookie } : {}, reconnection: false });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}

/** Ghi lại mọi sự kiện nhận được để kiểm tra sau. */
function recorder(s: Socket) {
  const log: { event: string; payload: any }[] = [];
  s.onAny((event, payload) => log.push({ event, payload }));
  return (event: string) => log.filter((l) => l.event === event).map((l) => l.payload);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await wait(25);
  }
  throw new Error("hết thời gian chờ sự kiện");
}

describe("Socket.IO /rt cho chat nhóm", () => {
  it("từ chối kết nối khi chưa đăng nhập", async () => {
    await expect(open(null)).rejects.toThrow("unauthorized");
  });

  it("message:new tới mọi thành viên kênh chung (đã tự vào phòng) và kèm payload đầy đủ", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const sViewer = await open(members.viewer);
    const sOwner = await open(owner);
    const viewerEvents = recorder(sViewer);
    const ownerEvents = recorder(sOwner);
    await wait(300); // chờ tự vào các phòng kênh

    const { body } = await send(members.editor, general, { content: "xin chào realtime" });
    const got = await until(() => viewerEvents("message:new")[0]);
    expect(got).toMatchObject({ notebookId: notebook.id, channelId: general });
    expect(got.message).toMatchObject({ id: body.message.id, content: "xin chào realtime" });
    await until(() => ownerEvents("message:new")[0]);

    // sửa/ phản ứng / ghim / thu hồi / xoá đều có sự kiện riêng
    const { PATCH, DELETE } = await import("@/app/api/channels/[channelId]/messages/[messageId]/route");
    const { POST: react } = await import("@/app/api/channels/[channelId]/messages/[messageId]/reactions/route");
    const { POST: pin } = await import("@/app/api/channels/[channelId]/messages/[messageId]/pin/route");
    const { POST: recall } = await import("@/app/api/channels/[channelId]/messages/[messageId]/recall/route");
    const { makeRequest, params } = await import("../helpers/users");
    const p = params({ channelId: general, messageId: body.message.id });
    await PATCH(makeRequest("/x", { method: "PATCH", user: members.editor, body: { content: "đã sửa" } }), p);
    await react(makeRequest("/x", { method: "POST", user: members.viewer, body: { emoji: "👍" } }), p);
    await pin(makeRequest("/x", { method: "POST", user: members.editor }), p);
    await until(() => viewerEvents("message:edit")[0]);
    expect((await until(() => viewerEvents("message:reaction")[0])).reactions[0]).toMatchObject({ emoji: "👍", count: 1 });
    expect((await until(() => viewerEvents("message:pin")[0])).pinned).toBe(true);
    await recall(makeRequest("/x", { method: "POST", user: members.editor }), p);
    const recalled = await until(() => viewerEvents("message:recall")[0]);
    expect(recalled.message).toMatchObject({ content: "", recalledAt: expect.any(String) });

    const second = (await send(members.editor, general, { content: "sẽ xoá" })).body.message;
    await DELETE(makeRequest("/x", { method: "DELETE", user: members.editor }), params({ channelId: general, messageId: second.id }));
    expect((await until(() => viewerEvents("message:delete")[0])).messageId).toBe(second.id);
  });

  it("DM: chỉ hai người nhận message:new / typing / read; người thứ ba và join:channel bị chặn", async () => {
    const { notebook, members } = await chatFixture();
    const sEditor = await open(members.editor);
    const sViewer = await open(members.viewer);
    const sAdmin = await open(members.admin);
    const editorEv = recorder(sEditor);
    const viewerEv = recorder(sViewer);
    const adminEv = recorder(sAdmin);
    await wait(200);

    const dm = (await openDm(members.editor, notebook.id, members.viewer.id)).body.channel.id as string;
    // cả hai người trong cuộc nhận channel:new; admin thì không
    await until(() => editorEv("channel:new")[0]);
    await until(() => viewerEv("channel:new")[0]);

    await send(members.editor, dm, { content: "chuyện riêng" });
    await until(() => viewerEv("message:new")[0]);

    // admin xin vào phòng DM → bị từ chối
    const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) => sAdmin.emit("join:channel", { channelId: dm }, resolve));
    expect(ack).toMatchObject({ ok: false, error: "forbidden" });

    // typing: người kia nhận, chính mình không nhận, người thứ ba không nhận; giới hạn tần suất
    sEditor.emit("typing", { channelId: dm });
    sEditor.emit("typing", { channelId: dm });
    sEditor.emit("typing", { channelId: dm });
    const typing = await until(() => viewerEv("typing")[0]);
    expect(typing).toMatchObject({ channelId: dm, userId: members.editor.id, name: members.editor.name });
    await wait(200);
    expect(viewerEv("typing")).toHaveLength(1); // throttle 1.5s
    expect(editorEv("typing")).toHaveLength(0);
    // admin không thuộc DM nên socket không ở trong phòng → typing gửi từ admin bị bỏ qua
    sAdmin.emit("typing", { channelId: dm });
    await wait(200);
    expect(viewerEv("typing")).toHaveLength(1);

    // read: cập nhật DB + phát cho cả kênh
    const latest = (await fetchMessages(members.viewer, dm)).body.messages[0];
    const readAck = await new Promise<{ ok: boolean }>((resolve) => sViewer.emit("read", { channelId: dm, messageId: latest.id }, resolve));
    expect(readAck.ok).toBe(true);
    const readEv = await until(() => editorEv("read").find((r: any) => r.userId === members.viewer.id));
    expect(readEv).toMatchObject({ channelId: dm, messageId: latest.id });
    const [row] = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, dm), eq(channelMembers.userId, members.viewer.id)));
    expect(row.lastReadMessageId).toBe(latest.id);
    expect(row.lastReadAt).not.toBeNull();

    // admin không nhận bất kỳ sự kiện nào của DM, và không thể đọc-mốc DM
    expect(adminEv("message:new")).toHaveLength(0);
    expect(adminEv("read")).toHaveLength(0);
    expect(adminEv("typing")).toHaveLength(0);
    const deny = await new Promise<{ ok: boolean; error?: string }>((resolve) => sAdmin.emit("read", { channelId: dm, messageId: latest.id }, resolve));
    expect(deny).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("notification được đẩy tới phòng user của người được nhắc tên / nhận DM", async () => {
    const { notebook, members, general } = await chatFixture();
    const sViewer = await open(members.viewer);
    const viewerEv = recorder(sViewer);
    await wait(200);
    await send(members.editor, general, { content: `nhờ @[V](${members.viewer.id}) xem`, mentions: [members.viewer.id] });
    const n = (await until(() => viewerEv("notification")[0])).notification;
    expect(n).toMatchObject({ type: "mention", readAt: null });
    expect(n.link).toBe(`/n/${notebook.id}/team?channel=${general}&message=${n.data.messageId}`);
  });

  it("kênh chủ đề mới: mọi thành viên (đã ở phòng notebook) nhận channel:new và message:new", async () => {
    const { notebook, members, owner } = await chatFixture();
    const sViewer = await open(members.viewer);
    const viewerEv = recorder(sViewer);
    await new Promise((resolve) => sViewer.emit("join:notebook", { notebookId: notebook.id }, resolve));
    const { POST } = await import("@/app/api/notebooks/[id]/channels/route");
    const { makeRequest, params } = await import("../helpers/users");
    const res = await POST(
      makeRequest("/x", { method: "POST", user: owner, body: { type: "topic", name: "Realtime" } }),
      params({ id: notebook.id }),
    );
    const topic = (await res.json()).channel.id as string;
    await until(() => viewerEv("channel:new").find((e: any) => e.channel.id === topic));
    await send(owner, topic, { content: "chủ đề mới" });
    await until(() => viewerEv("message:new").find((e: any) => e.channelId === topic));
  });
});
