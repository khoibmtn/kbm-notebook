import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DELETE as deleteNote, GET as getNote, PATCH as patchNote } from "@/app/api/notebooks/[id]/notes/[noteId]/route";
import { POST as toSource } from "@/app/api/notebooks/[id]/notes/[noteId]/to-source/route";
import { GET as listNotes, POST as createNote } from "@/app/api/notebooks/[id]/notes/route";
import { DELETE as deleteSource } from "@/app/api/notebooks/[id]/sources/[sourceId]/route";
import { db } from "@/server/db";
import { jobs, notes, sources } from "@/server/db/schema";
import { ingestSource } from "@/server/knowledge/ingest/pipeline";
import { RESYNC_DELAY_MS } from "@/server/notes/service";
import type { NoteDto, NoteListItem } from "@/lib/notes";
import type { SourceDto } from "@/lib/sources";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { makeRequest, params, type TestUser } from "../helpers/users";

const json = <T>(res: Response) => res.json() as Promise<T>;

async function create(nb: string, user: TestUser | null, body: Record<string, unknown> = {}) {
  return createNote(makeRequest(`/api/notebooks/${nb}/notes`, { method: "POST", user, body }), params({ id: nb }));
}
async function created(nb: string, user: TestUser, body: Record<string, unknown> = {}): Promise<NoteDto> {
  const res = await create(nb, user, body);
  expect(res.status).toBe(201);
  return (await json<{ note: NoteDto }>(res)).note;
}
const list = async (nb: string, user: TestUser | null, query = "") =>
  listNotes(makeRequest(`/api/notebooks/${nb}/notes`, { user, query }), params({ id: nb }));
const notesOf = async (nb: string, user: TestUser, query = "") => (await json<{ notes: NoteListItem[] }>(await list(nb, user, query))).notes;
const pp = (nb: string, id: string) => params({ id: nb, noteId: id });
const patch = (nb: string, id: string, user: TestUser, body: Record<string, unknown>) =>
  patchNote(makeRequest("/x", { method: "PATCH", user, body }), pp(nb, id));

describe("ghi chú: CRUD và phân quyền", () => {
  it("editor tạo/sửa/xoá; tiêu đề tự suy từ nội dung; viewer chỉ đọc; người ngoài 404; chưa đăng nhập 401", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer", "editor"]);
    const nb = notebook.id;
    const outsider = (await createNotebookWithMembers()).owner;

    expect((await create(nb, members.viewer, { title: "x" })).status).toBe(403);
    expect((await create(nb, outsider, { title: "x" })).status).toBe(404);
    expect((await create(nb, null, { title: "x" })).status).toBe(401);

    const n = await created(nb, members.editor, { title: "", contentMd: "# Ôn tập chương 3\n\nNội dung" });
    expect(n).toMatchObject({ title: "Ôn tập chương 3", origin: "manual", visibility: "shared", isSource: false, createdBy: members.editor.id, canManage: true });

    // viewer đọc được ghi chú shared nhưng không sửa/xoá
    const asViewer = await json<{ note: NoteDto }>(await getNote(makeRequest("/x", { user: members.viewer }), pp(nb, n.id)));
    expect(asViewer.note.contentMd).toContain("Nội dung");
    expect(asViewer.note.canManage).toBe(false);
    expect((await patch(nb, n.id, members.viewer, { title: "hack" })).status).toBe(403);
    expect((await deleteNote(makeRequest("/x", { method: "DELETE", user: members.viewer }), pp(nb, n.id))).status).toBe(403);

    // tác giả sửa: autosave nhiều lần
    const upd = await json<{ note: NoteDto }>(await patch(nb, n.id, members.editor, { contentMd: "# Ôn tập chương 3\n\nĐã sửa" }));
    expect(upd.note.contentMd).toContain("Đã sửa");
    expect((await patch(nb, n.id, members.editor, {})).status).toBe(400);

    // owner (admin+) sửa được ghi chú của người khác; editor khác thì không
    const other = (await createNotebookWithMembers()).owner;
    expect((await patch(nb, n.id, other, { title: "x" })).status).toBe(404);
    expect((await patch(nb, n.id, owner, { title: "Tiêu đề do chủ sổ tay đặt" })).status).toBe(200);

    const del = await deleteNote(makeRequest("/x", { method: "DELETE", user: owner }), pp(nb, n.id));
    expect(del.status).toBe(200);
    expect((await getNote(makeRequest("/x", { user: owner }), pp(nb, n.id))).status).toBe(404);
    expect(await notesOf(nb, owner)).toEqual([]);
  });

  it("editor không sửa/xoá ghi chú của editor khác (403); ghi chú riêng tư chỉ tác giả thấy", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["editor"]);
    const nb = notebook.id;
    const editor2 = (await createNotebookWithMembers()).owner;
    const { addMember } = await import("@/server/notebooks/service");
    await addMember(nb, editor2.id, "editor", owner.id);

    const shared = await created(nb, members.editor, { title: "Chung", contentMd: "a" });
    const secret = await created(nb, members.editor, { title: "Riêng", contentMd: "bí mật", visibility: "private" });

    expect((await patch(nb, shared.id, editor2, { title: "chiếm" })).status).toBe(403);
    expect((await deleteNote(makeRequest("/x", { method: "DELETE", user: editor2 }), pp(nb, shared.id))).status).toBe(403);

    // ghi chú riêng: người khác (kể cả owner) không thấy, không sửa, không xoá
    for (const u of [editor2, owner]) {
      expect((await notesOf(nb, u)).map((x) => x.id)).toEqual([shared.id]);
      expect((await getNote(makeRequest("/x", { user: u }), pp(nb, secret.id))).status).toBe(404);
      expect((await patch(nb, secret.id, u, { title: "x" })).status).toBe(404);
      expect((await deleteNote(makeRequest("/x", { method: "DELETE", user: u }), pp(nb, secret.id))).status).toBe(404);
    }
    expect((await notesOf(nb, members.editor)).map((x) => x.id).sort()).toEqual([shared.id, secret.id].sort());

    // chuyển sang shared thì người khác thấy
    await patch(nb, secret.id, members.editor, { visibility: "shared" });
    expect((await notesOf(nb, owner)).map((x) => x.id)).toContain(secret.id);
  });

  it("tìm kiếm theo tiêu đề / nội dung, không phân biệt hoa thường, an toàn với ký tự LIKE", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const nb = notebook.id;
    await created(nb, owner, { title: "Chu trình Calvin", contentMd: "Giai đoạn tối của quang hợp" });
    await created(nb, owner, { title: "Hô hấp", contentMd: "Ty thể tạo ATP — 100% hiệu suất_cao" });
    expect((await notesOf(nb, owner, "?q=calvin")).map((n) => n.title)).toEqual(["Chu trình Calvin"]);
    expect((await notesOf(nb, owner, "?q=" + encodeURIComponent("ty thể"))).map((n) => n.title)).toEqual(["Hô hấp"]);
    expect((await notesOf(nb, owner, "?q=" + encodeURIComponent("100%"))).map((n) => n.title)).toEqual(["Hô hấp"]);
    expect(await notesOf(nb, owner, "?q=%25")).toHaveLength(1); // "%" chỉ khớp ký tự % thật
    expect(await notesOf(nb, owner, "?q=khong-co")).toEqual([]);
    const all = await notesOf(nb, owner);
    expect(all[0].excerpt.length).toBeGreaterThan(0);
    expect(all.every((n) => !("contentMd" in n))).toBe(true);
  });
});

describe("ghi chú → nguồn", () => {
  async function jobsFor(sourceId: string) {
    return db.select().from(jobs).where(and(eq(jobs.type, "ingest_source"), sql`${jobs.payload}->>'sourceId' = ${sourceId}`));
  }

  it("tạo nguồn text (metadata.note_id), xếp job ingest, is_source=true; gọi lại → 409; ghi chú trống → 400; viewer → 403", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer"]);
    const nb = notebook.id;
    const note = await created(nb, owner, { title: "Tóm tắt chương 1", contentMd: "Tế bào là đơn vị cơ bản của sự sống. Mọi sinh vật đều được cấu tạo từ tế bào." });

    expect((await toSource(makeRequest("/x", { method: "POST", user: members.viewer }), pp(nb, note.id))).status).toBe(403);
    const empty = await created(nb, owner, { title: "Trống", contentMd: "" });
    expect((await toSource(makeRequest("/x", { method: "POST", user: owner }), pp(nb, empty.id))).status).toBe(400);

    const res = await toSource(makeRequest("/x", { method: "POST", user: owner }), pp(nb, note.id));
    expect(res.status).toBe(201);
    const body = await json<{ note: NoteDto; source: SourceDto }>(res);
    expect(body.note.isSource).toBe(true);
    expect(body.source).toMatchObject({ kind: "text", title: "Tóm tắt chương 1", status: "pending", visibility: "shared" });
    const [row] = await db.select().from(sources).where(eq(sources.id, body.source.id));
    expect(row.metadata).toMatchObject({ note_id: note.id });
    expect(row.rawText).toBe(note.contentMd);
    expect(await jobsFor(row.id)).toHaveLength(1);

    expect((await toSource(makeRequest("/x", { method: "POST", user: owner }), pp(nb, note.id))).status).toBe(409);

    // xử lý nguồn → ready (gọi trực tiếp pipeline, không dùng hàng đợi dùng chung)
    await ingestSource(row.id);
    const [ready] = await db.select().from(sources).where(eq(sources.id, row.id));
    expect(ready.status).toBe("ready");
  });

  it("sửa ghi chú → nguồn được đồng bộ và xử lý lại (gộp: chỉ một job chờ); đổi quyền riêng tư và xoá nguồn được phản ánh", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const nb = notebook.id;
    const note = await created(nb, owner, { title: "Ghi chú động", contentMd: "Phiên bản đầu tiên của ghi chú về quang hợp." });
    const { source } = await json<{ source: SourceDto }>(await toSource(makeRequest("/x", { method: "POST", user: owner }), pp(nb, note.id)));
    await ingestSource(source.id);
    await db.delete(jobs).where(sql`${jobs.payload}->>'sourceId' = ${source.id}`); // dọn job ban đầu

    await patch(nb, note.id, owner, { contentMd: "Phiên bản thứ hai nói về chu trình Calvin." });
    await patch(nb, note.id, owner, { contentMd: "Phiên bản thứ ba nói về chu trình Calvin và diệp lục." });
    const [synced] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(synced.rawText).toBe("Phiên bản thứ ba nói về chu trình Calvin và diệp lục.");
    const pending = await jobsFor(source.id);
    expect(pending).toHaveLength(1); // hai lần sửa → một job
    expect(pending[0].status).toBe("queued");
    expect(pending[0].runAt.getTime()).toBeGreaterThan(Date.now() + RESYNC_DELAY_MS - 5_000);

    // job (khi chạy) xử lý lại với văn bản mới nhất
    await ingestSource(source.id);
    const [again] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(again.status).toBe("ready");

    // đổi tiêu đề / quyền riêng tư của ghi chú
    await patch(nb, note.id, owner, { title: "Tiêu đề mới", visibility: "private" });
    const [moved] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(moved).toMatchObject({ title: "Tiêu đề mới", visibility: "private" });

    // xoá nguồn → ghi chú không còn là nguồn và có thể thêm lại
    const del = await deleteSource(makeRequest("/x", { method: "DELETE", user: owner }), params({ id: nb, sourceId: source.id }));
    expect(del.status).toBe(200);
    const [n2] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(n2.isSource).toBe(false);
    const re = await toSource(makeRequest("/x", { method: "POST", user: owner }), pp(nb, note.id));
    expect(re.status).toBe(201);
    expect((await json<{ source: SourceDto }>(re)).source.visibility).toBe("private");
  });
});
