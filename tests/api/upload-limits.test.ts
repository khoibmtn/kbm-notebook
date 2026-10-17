import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { POST as chatUpload } from "@/app/api/channels/[channelId]/upload/route";
import { POST as rawSourceUpload } from "@/app/api/notebooks/[id]/sources/upload/route";
import { db } from "@/server/db";
import { files, jobs, rateLimits } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { enqueueCleanupOrphanFiles } from "@/server/jobs/handlers/cleanup-files";
import { claimJob, runJob } from "@/server/jobs/worker";
import { registerCleanupFilesHandler } from "@/server/jobs/handlers/cleanup-files";
import { cleanupOrphanFiles } from "@/server/storage/files";
import { notebookStorageBytes } from "@/server/storage/quota";
import { getStorage } from "@/server/storage/local";
import { parkJobs } from "../helpers/artifacts";
import { createNotebookWithMembers, insertSource } from "../helpers/fixtures";
import { chatFixture, json } from "../helpers/team-chat";
import { createTestUser, params, type TestUser } from "../helpers/users";

const ENV_KEYS = ["UPLOAD_MAX_FILES_PER_10MIN", "UPLOAD_MAX_MB_PER_HOUR", "MAX_NOTEBOOK_STORAGE_MB", "MAX_UPLOAD_REQUEST_MB"] as const;
function setEnv(over: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const [k, v] of Object.entries(over)) process.env[k] = v;
  resetEnvCache();
}
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  resetEnvCache();
});

/** Gọi route upload rồi "đỗ" job ingest để test song song khác không nhặt nhầm. */
async function sourceUpload(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const res = await rawSourceUpload(req, ctx);
  await parkJobs((await ctx.params).id);
  return res;
}

function form(files: { name: string; type: string; data: BlobPart }[], extra: Record<string, string> = {}) {
  const f = new FormData();
  for (const x of files) f.append("files", new File([x.data], x.name, { type: x.type }));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}

function srcReq(nb: string, user: TestUser, body: FormData, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/notebooks/${nb}/sources/upload`, { method: "POST", headers: { cookie: user.cookie, ...headers }, body });
}
const txt = (name: string, size = 20) => ({ name, type: "text/plain", data: "x".repeat(size) });

describe("H-1 · giới hạn kích thước trước khi đọc body", () => {
  it("Content-Length vượt trần → 413 và KHÔNG đọc body", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(new Uint8Array(10));
        },
      },
      { highWaterMark: 0 }, // chỉ gọi pull() khi có người đọc
    );
    const req = new Request(`http://localhost:3000/api/notebooks/${notebook.id}/sources/upload`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "multipart/form-data; boundary=xxx", "content-length": String(10 * 1024 * 1024 * 1024) },
      body,
      duplex: "half",
    } as RequestInit);
    const res = await sourceUpload(req, params({ id: notebook.id }));
    expect(res.status).toBe(413);
    expect((await json(res)).error.code).toBe("payload_too_large");
    expect(pulled).toBe(false);
  });

  it("body chunked (không có Content-Length) vẫn bị cắt khi vượt trần", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    setEnv({ MAX_UPLOAD_REQUEST_MB: "1" }); // trần = min(1MB, 50 × 1MB) + 1MB = 2MB
    const boundary = "----b";
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(head));
      },
      pull(c) {
        if (sent > 8 * 1024 * 1024) return c.close();
        sent += 1024 * 1024;
        c.enqueue(new Uint8Array(1024 * 1024).fill(97));
      },
    });
    const req = new Request(`http://localhost:3000/api/notebooks/${notebook.id}/sources/upload`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: "half",
    } as RequestInit);
    const res = await sourceUpload(req, params({ id: notebook.id }));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(8 * 1024 * 1024 + 1);
  });

  it("tệp quá MAX_UPLOAD_MB bị cắt và xoá khỏi đĩa; không để lại dòng files", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const before = await notebookStorageBytes(notebook.id);
    const res = await sourceUpload(srcReq(notebook.id, owner, form([{ name: "lớn.txt", type: "text/plain", data: new Uint8Array(1.5 * 1024 * 1024) }])), params({ id: notebook.id }));
    expect(res.status).toBe(413);
    expect(await notebookStorageBytes(notebook.id)).toBe(before);
  });
});

describe("H-1 · giới hạn tần suất tải lên", () => {
  it("quá số tệp / 10 phút → 429 rate_limited; tệp trong hạn mức vẫn được nhận", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    setEnv({ UPLOAD_MAX_FILES_PER_10MIN: "2" });
    const ok = await sourceUpload(srcReq(notebook.id, owner, form([txt("a.txt"), txt("b.txt")])), params({ id: notebook.id }));
    expect(ok.status).toBe(201);
    const limited = await sourceUpload(srcReq(notebook.id, owner, form([txt("c.txt")])), params({ id: notebook.id }));
    expect(limited.status).toBe(429);
    expect((await json(limited)).error.code).toBe("rate_limited");
  });

  it("một lần tải nhiều tệp vượt hạn mức: tệp vượt bị từ chối 429, tệp trước đó vẫn được tạo", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    setEnv({ UPLOAD_MAX_FILES_PER_10MIN: "2" });
    const res = await sourceUpload(srcReq(notebook.id, owner, form([txt("a.txt"), txt("b.txt"), txt("c.txt")])), params({ id: notebook.id }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.sources).toHaveLength(2);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ name: "c.txt", status: 429, code: "rate_limited" });
  });

  it("quá dung lượng / giờ → 429; hạn mức tính riêng từng người dùng", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["editor"]);
    setEnv({ UPLOAD_MAX_MB_PER_HOUR: "1" });
    const first = await sourceUpload(srcReq(notebook.id, owner, form([txt("a.txt", 800 * 1024)])), params({ id: notebook.id }));
    expect(first.status).toBe(201);
    const second = await sourceUpload(srcReq(notebook.id, owner, form([txt("b.txt", 400 * 1024)])), params({ id: notebook.id }));
    expect([201, 429]).toContain(second.status); // tệp b được ghi rồi mới tính → có thể vượt ngay ở lần này
    const third = await sourceUpload(srcReq(notebook.id, owner, form([txt("c.txt", 10)])), params({ id: notebook.id }));
    expect(third.status).toBe(429);
    // người khác không bị ảnh hưởng
    const other = await sourceUpload(srcReq(notebook.id, members.editor, form([txt("d.txt", 100)])), params({ id: notebook.id }));
    expect(other.status).toBe(201);
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, `upload:kib:${owner.id}`));
    expect(row.count).toBeGreaterThan(1024);
  });

  it("chat upload cũng bị giới hạn (429)", async () => {
    const { members, general } = await chatFixture();
    setEnv({ UPLOAD_MAX_FILES_PER_10MIN: "1" });
    const mk = () => {
      const f = new FormData();
      f.append("files", new File(["a"], "a.txt", { type: "text/plain" }));
      return new Request(`http://localhost:3000/api/channels/${general}/upload`, { method: "POST", headers: { cookie: members.editor.cookie }, body: f });
    };
    expect((await chatUpload(mk(), params({ channelId: general }))).status).toBe(201);
    expect((await chatUpload(mk(), params({ channelId: general }))).status).toBe(429);
  });
});

describe("H-1 · quota dung lượng theo sổ tay", () => {
  it("vượt MAX_NOTEBOOK_STORAGE_MB → 413 notebook_storage_full (nguồn và chat); xoá nguồn trả lại dung lượng", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["editor"]);
    setEnv({ MAX_NOTEBOOK_STORAGE_MB: "1" });
    const a = await sourceUpload(srcReq(notebook.id, owner, form([txt("a.txt", 700 * 1024)])), params({ id: notebook.id }));
    expect(a.status).toBe(201);
    const srcId = (await json(a)).sources[0].id as string;
    expect(await notebookStorageBytes(notebook.id)).toBe(700 * 1024);

    const b = await sourceUpload(srcReq(notebook.id, owner, form([txt("b.txt", 700 * 1024)])), params({ id: notebook.id }));
    // tệp thứ hai được ghi rồi bị gỡ khi phát hiện vượt quota → lỗi 413
    expect(b.status).toBe(413);
    expect((await json(b)).error.code).toBe("notebook_storage_full");
    expect(await notebookStorageBytes(notebook.id)).toBe(700 * 1024);

    // pre-check theo Content-Length: không cần ghi gì
    const c = await sourceUpload(
      srcReq(notebook.id, members.editor, form([txt("c.txt", 10)]), { "content-length": String(500 * 1024) }),
      params({ id: notebook.id }),
    );
    expect(c.status).toBe(413);
    expect((await json(c)).error.code).toBe("notebook_storage_full");

    // Xoá nguồn → tệp gốc được xoá → dung lượng được trả lại
    const { DELETE } = await import("@/app/api/notebooks/[id]/sources/[sourceId]/route");
    const del = await DELETE(new Request("http://localhost:3000/x", { method: "DELETE", headers: { cookie: owner.cookie } }), params({ id: notebook.id, sourceId: srcId }));
    expect(del.status).toBeLessThan(300);
    expect(await notebookStorageBytes(notebook.id)).toBe(0);
  });
});

describe("H-1 · dọn tệp mồ côi", () => {
  it("chỉ xoá tệp chat_upload quá 24 giờ mà không còn tham chiếu", async () => {
    const owner = await createTestUser();
    const { notebook } = await createNotebookWithMembers();
    const put = (name: string, origin: string) =>
      getStorage().put(Buffer.from(name), { ownerId: owner.id, mime: "text/plain", name, notebookId: notebook.id, origin });
    const oldOrphan = await put("old-orphan.txt", "chat_upload");
    const freshOrphan = await put("fresh-orphan.txt", "chat_upload");
    const oldReferenced = await put("old-referenced.txt", "chat_upload");
    const oldSourceUpload = await put("old-source.txt", "source_upload");
    await insertSource(notebook.id, owner.id, { kind: "file", fileId: oldReferenced.id });
    const longAgo = new Date(Date.now() - 25 * 3_600_000);
    for (const f of [oldOrphan, oldReferenced, oldSourceUpload]) await db.update(files).set({ createdAt: longAgo }).where(eq(files.id, f.id));

    const removed = await cleanupOrphanFiles();
    expect(removed).toBeGreaterThanOrEqual(1);
    const exists = async (id: string) => (await db.select().from(files).where(eq(files.id, id))).length === 1;
    expect(await exists(oldOrphan.id)).toBe(false);
    expect(await exists(freshOrphan.id)).toBe(true);
    expect(await exists(oldReferenced.id)).toBe(true);
    expect(await exists(oldSourceUpload.id)).toBe(true);
    await expect(getStorage().getStream(oldOrphan.storageKey)).rejects.toThrow();
  });

  it("job cleanup_orphan_files: xếp không trùng và handler chạy được", async () => {
    await db.delete(jobs).where(eq(jobs.type, "cleanup_orphan_files"));
    expect(await enqueueCleanupOrphanFiles()).toBe(true);
    expect(await enqueueCleanupOrphanFiles()).toBe(false); // đã có job đang chờ
    registerCleanupFilesHandler();
    const job = await claimJob("t", ["cleanup_orphan_files"]);
    expect(job).not.toBeNull();
    expect(await runJob(job!)).toBe("done");
  });
});
