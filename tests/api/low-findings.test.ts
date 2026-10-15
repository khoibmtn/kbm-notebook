import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import { afterEach, describe, expect, it } from "vitest";
import { GET as getArtifact } from "@/app/api/artifacts/[artifactId]/route";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { DELETE as deleteMsg } from "@/app/api/channels/[channelId]/messages/[messageId]/route";
import { POST as toSource } from "@/app/api/channels/[channelId]/messages/[messageId]/to-source/route";
import { DELETE as deleteSourceRoute } from "@/app/api/notebooks/[id]/sources/[sourceId]/route";
import { renderUserPrompt } from "@/server/ai/prompts/defaults";
import { setIo } from "@/server/chat/realtime";
import { emitJobProgress } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { notebookMembers, sources } from "@/server/db/schema";
import { getStorage } from "@/server/storage/local";
import { transferOwnership } from "@/server/notebooks/service";
import { chatFixture, fetchMessages, json, openDm, send } from "../helpers/team-chat";
import { createNotebookWithMembers, insertSource } from "../helpers/fixtures";
import { makeRequest, params } from "../helpers/users";

afterEach(() => setIo(undefined as unknown as Server));

describe("L-6 · id không hợp lệ trả 404, không phải 500", () => {
  it("GET /api/artifacts/<chuỗi gạch ngang dài 36 ký tự> → 404", async () => {
    const { owner } = await createNotebookWithMembers();
    const id = "-".repeat(36);
    const res = await getArtifact(makeRequest(`/api/artifacts/${id}`, { user: owner }), params({ artifactId: id }));
    expect(res.status).toBe(404);
  });
});

describe("L-8 · chuyển quyền chủ sở hữu đồng thời không tạo hai owner", () => {
  it("hai yêu cầu song song từ cùng owner: một thành công, một 409 not_owner; còn đúng một owner", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["admin", "editor"]);
    const results = await Promise.allSettled([
      transferOwnership(notebook.id, owner.id, members.admin.id),
      transferOwnership(notebook.id, owner.id, members.editor.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: "not_owner" });
    const owners = (await db.select().from(notebookMembers).where(eq(notebookMembers.notebookId, notebook.id))).filter((m) => m.role === "owner");
    expect(owners).toHaveLength(1);
  });
});

describe("L-9 · admin không xoá hộ tin trong DM", () => {
  it("admin là một bên của DM không xoá được tin của người kia nhưng xoá được tin của mình; kênh chung vẫn cho admin kiểm duyệt", async () => {
    const { notebook, members, general } = await chatFixture();
    const dm = (await openDm(members.editor, notebook.id, members.admin.id)).body.channel.id as string;
    const theirs = (await send(members.editor, dm, { content: "lời của editor" })).body.message.id as string;
    const mine = (await send(members.admin, dm, { content: "lời của admin" })).body.message.id as string;
    const del = (user: typeof members.admin, channel: string, id: string) =>
      deleteMsg(makeRequest("/x", { method: "DELETE", user }), params({ channelId: channel, messageId: id }));

    expect((await del(members.admin, dm, theirs)).status).toBe(403);
    expect((await del(members.admin, dm, mine)).status).toBeLessThan(300);

    const generalMsg = (await send(members.editor, general, { content: "tin ở kênh chung" })).body.message.id as string;
    expect((await del(members.admin, general, generalMsg)).status).toBeLessThan(300);
  });
});

describe("L-10 · không lộ siêu dữ liệu nguồn riêng tư qua realtime", () => {
  it("xoá nguồn riêng tư chỉ báo cho chủ nguồn; xoá nguồn chia sẻ báo cả sổ tay; job:progress của nguồn riêng tư không tới phòng sổ tay", async () => {
    const { notebook, members } = await createNotebookWithMembers(["editor"]);
    const sent: { room: string; event: string }[] = [];
    setIo({ of: () => ({ to: (room: string) => ({ emit: (event: string) => sent.push({ room, event }) }) }) } as unknown as Server);
    const priv = await insertSource(notebook.id, members.editor.id, { visibility: "private", title: "Riêng" });
    const shared = await insertSource(notebook.id, members.editor.id, { visibility: "shared", title: "Chung" });
    const del = (id: string) =>
      deleteSourceRoute(makeRequest("/x", { method: "DELETE", user: members.editor }), params({ id: notebook.id, sourceId: id }));

    await del(priv.id);
    expect(sent.filter((s) => s.event === "source:status").map((s) => s.room)).toEqual([`user:${members.editor.id}`]);
    sent.length = 0;
    await del(shared.id);
    expect(sent.map((s) => s.room)).toContain(`notebook:${notebook.id}`);

    sent.length = 0;
    emitJobProgress({ sourceId: "s", notebookId: notebook.id, userId: members.editor.id, private: true }, { jobId: "j", type: "ingest_source", status: "failed", progress: 10, error: "lỗi" });
    expect(sent.map((s) => s.room)).toEqual([`user:${members.editor.id}`]);
    sent.length = 0;
    emitJobProgress({ sourceId: "s", notebookId: notebook.id, userId: members.editor.id }, { jobId: "j", type: "ingest_source", status: "done", progress: 100 });
    expect(sent.map((s) => s.room).sort()).toEqual([`notebook:${notebook.id}`, `user:${members.editor.id}`].sort());
  });

  it("thẻ tham chiếu của mục đã chuyển riêng tư không lộ tiêu đề cho người không còn quyền", async () => {
    const { notebook, members, owner, general } = await chatFixture();
    const src = await insertSource(notebook.id, owner.id, { title: "Tiêu đề nhạy cảm" });
    await send(owner, general, { kind: "source_ref", refs: { sourceId: src.id } });
    await db.update(sources).set({ visibility: "private" }).where(eq(sources.id, src.id));
    const ref = (await fetchMessages(members.viewer, general)).body.messages[0].refs[0];
    expect(ref).toMatchObject({ available: false, title: "" });
    expect((await fetchMessages(owner, general)).body.messages[0].refs[0]).toMatchObject({ available: true, title: "Tiêu đề nhạy cảm" });
  });
});

describe("L-12 · prompt riêng chứa ký tự thay thế đặc biệt", () => {
  it("`$&` và `` $` `` trong chỉ dẫn không bị diễn giải", () => {
    const tpl = { system: "s", user: "Yêu cầu: {{instructions}} (hết)", options: {} };
    expect(renderUserPrompt(tpl, "dùng $& và $` và $1 nguyên văn")).toBe("Yêu cầu: dùng $& và $` và $1 nguyên văn (hết)");
  });
});

describe("L-14 · khử trùng 'chuyển tệp chat vào Nguồn' không lộ nguồn riêng tư của người khác", () => {
  it("nguồn riêng tư của người khác cùng file không bị trả về; người dùng nhận nguồn riêng của mình", async () => {
    const { notebook, members, general } = await chatFixture();
    const up = await getStorage().put(Buffer.from("%PDF"), { ownerId: members.viewer.id, mime: "application/pdf", name: "t.pdf", notebookId: notebook.id, origin: "chat_upload" });
    // tin nhắn có tệp đính kèm
    const { messageAttachments, teamMessages } = await import("@/server/db/schema");
    const msg = (await send(members.viewer, general, { content: "tài liệu" })).body.message.id as string;
    await db.insert(messageAttachments).values({ messageId: msg, fileId: up.id, name: "t.pdf", mime: "application/pdf", size: 4 });
    await db.update(teamMessages).set({ kind: "file" }).where(eq(teamMessages.id, msg));

    // admin đã có nguồn RIÊNG TƯ dùng cùng tệp
    const secret = await insertSource(notebook.id, members.admin.id, { kind: "chat_attachment", fileId: up.id, visibility: "private", title: "Riêng của admin" });
    const res = await toSource(makeRequest("/x", { method: "POST", user: members.editor, body: {} }), params({ channelId: general, messageId: msg }));
    expect(res.status).toBe(201);
    const out = (await json(res)).sources as { id: string; title: string; existing: boolean }[];
    expect(out[0].id).not.toBe(secret.id);
    expect(out[0].existing).toBe(false);
    expect(JSON.stringify(out)).not.toContain("Riêng của admin");
  });
});

describe("L-16 · phục vụ tệp: chỉ MIME an toàn mới inline; MIME lạ không làm hỏng", () => {
  it("MIME lạ / HTML / SVG → attachment; MIME không ASCII → octet-stream thay vì 500; ảnh/PDF vẫn inline", async () => {
    const { owner } = await createNotebookWithMembers();
    const put = (mime: string, name: string) => getStorage().put(Buffer.from("x"), { ownerId: owner.id, mime, name });
    const get = async (id: string) => getFile(makeRequest(`/api/files/${id}`, { user: owner }), params({ id }));
    const weird = await get((await put("application/x-custom-thing", "a.bin")).id);
    expect(weird.status).toBe(200);
    expect(weird.headers.get("content-disposition")).toContain("attachment");
    const html = await get((await put("text/html", "a.html")).id);
    expect(html.headers.get("content-disposition")).toContain("attachment");
    const svg = await get((await put("image/svg+xml", "a.svg")).id);
    expect(svg.headers.get("content-disposition")).toContain("attachment");
    const nonAscii = await get((await put("áp dụng/tệp\u0001", "n.bin")).id);
    expect(nonAscii.status).toBe(200);
    expect(nonAscii.headers.get("content-type")).toBe("application/octet-stream");
    for (const [mime, name] of [["image/png", "a.png"], ["application/pdf", "a.pdf"], ["text/plain", "a.txt"]] as const) {
      const r = await get((await put(mime, name)).id);
      expect(r.headers.get("content-disposition"), mime).toContain("inline");
    }
  });
});
