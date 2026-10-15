import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { POST as uploadImage } from "@/app/api/artifacts/[artifactId]/images/route";
import { POST as forkRoute } from "@/app/api/artifacts/[artifactId]/fork/route";
import { PATCH as patchArtifact } from "@/app/api/artifacts/[artifactId]/route";
import { addVersion, setVisibility } from "@/server/artifacts/service";
import { db } from "@/server/db";
import { artifactFiles, artifacts } from "@/server/db/schema";
import { canAccessFile } from "@/server/storage/files";
import { getStorage } from "@/server/storage/local";
import { createNotebookWithMembers, insertArtifact } from "../helpers/fixtures";
import { json } from "../helpers/team-chat";
import { makeRequest, params, type TestUser } from "../helpers/users";

const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const slides = (fileId: string) => ({
  theme: { palette: "indigo", font: "Inter" },
  slides: [{ id: "s1", layout: "image_text", title: "Ảnh", bullets: [], image: { prompt: "", fileId } }],
  evidence: [],
});

async function setup() {
  const base = await createNotebookWithMembers(["viewer", "editor"]);
  const artifact = await insertArtifact(base.notebook.id, base.owner.id, { type: "slide_deck", visibility: "notebook" });
  return { ...base, artifact };
}

async function upload(artifactId: string, user: TestUser, bytes: Buffer = PNG_1PX) {
  const body = new FormData();
  body.append("file", new File([new Uint8Array(bytes)], "a.png", { type: "image/png" }));
  const res = await uploadImage(new Request(`http://localhost:3000/api/artifacts/${artifactId}/images`, { method: "POST", headers: { cookie: user.cookie }, body }), params({ artifactId }));
  return { res, body: (await json(res)) as { fileId: string } };
}

const fileGet = (id: string, opts: { user?: TestUser | null; share?: string; ip?: string } = {}) => {
  const req = makeRequest(`/api/files/${id}`, { user: opts.user ?? null, query: opts.share ? `?share=${opts.share}` : "" });
  if (opts.ip) req.headers.set("x-real-ip", opts.ip);
  return getFile(req, params({ id }));
};

describe("H-3 · khách mở ?share= chỉ tra cứu theo token → artifact → tệp", () => {
  it("tải ảnh lên đăng ký artifact_files; khách có token đọc được ảnh trong phiên bản hiện tại, không cần đăng nhập", async () => {
    const c = await setup();
    const { res, body } = await upload(c.artifact.id, c.members.editor);
    expect(res.status).toBe(201);
    expect(await db.select().from(artifactFiles).where(eq(artifactFiles.fileId, body.fileId))).toHaveLength(1);
    await addVersion(c.artifact.id, { content: slides(body.fileId), userId: c.owner.id, setStatusReady: true });
    const [fresh] = await db.select().from(artifacts).where(eq(artifacts.id, c.artifact.id));
    const linked = await setVisibility(fresh, { role: "owner" }, "link");

    const guest = await fileGet(body.fileId, { share: linked.shareToken! });
    expect(guest.status).toBe(200);
    expect(Buffer.from(await guest.arrayBuffer()).equals(PNG_1PX)).toBe(true);

    // token sai / quá ngắn / file khác → không đọc được (khách chưa đăng nhập nhận 401, không lộ tồn tại)
    expect((await fileGet(body.fileId, { share: "x".repeat(24) })).status).toBe(401);
    expect((await fileGet(body.fileId, { share: "ngan" })).status).toBe(401);
    const other = await getStorage().put(PNG_1PX, { ownerId: c.owner.id, mime: "image/png", name: "o.png" });
    expect((await fileGet(other.id, { share: linked.shareToken! })).status).toBe(401);
  });

  it("ảnh đã bị gỡ khỏi phiên bản hiện tại thì khách không còn đọc được; visibility hết link → khách bị chặn", async () => {
    const c = await setup();
    const { body } = await upload(c.artifact.id, c.members.editor);
    await addVersion(c.artifact.id, { content: slides(body.fileId), userId: c.owner.id, setStatusReady: true });
    let [row] = await db.select().from(artifacts).where(eq(artifacts.id, c.artifact.id));
    row = await setVisibility(row, { role: "owner" }, "link");
    expect((await fileGet(body.fileId, { share: row.shareToken! })).status).toBe(200);

    await addVersion(c.artifact.id, { content: { slides: [{ id: "s1", layout: "title", title: "Không ảnh", bullets: [] }], evidence: [] }, userId: c.owner.id });
    expect((await fileGet(body.fileId, { share: row.shareToken! })).status).toBe(401);

    await addVersion(c.artifact.id, { content: slides(body.fileId), userId: c.owner.id });
    expect((await fileGet(body.fileId, { share: row.shareToken! })).status).toBe(200);
    await setVisibility(row, { role: "owner" }, "notebook");
    expect((await fileGet(body.fileId, { share: row.shareToken! })).status).toBe(401);
  });

  it("truy cập ?share= chưa xác thực bị giới hạn tần suất theo IP (429)", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    let last = 0;
    for (let i = 0; i < 305; i++) {
      last = (await fileGet(id, { share: "y".repeat(24), ip: "203.0.113.77" })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
    // IP khác không bị ảnh hưởng
    expect((await fileGet(id, { share: "y".repeat(24), ip: "203.0.113.78" })).status).toBe(401);
  });
});

describe("M-3 · fileId trong JSON do client sửa không cấp quyền đọc tệp", () => {
  it("editor nhồi fileId của tệp khác vào slide → tệp đó vẫn không đọc được; ảnh server đăng ký thì đọc được", async () => {
    const c = await setup();
    const secret = await getStorage().put(Buffer.from("bí mật"), { ownerId: c.owner.id, mime: "text/plain", name: "secret.txt" });
    expect(await canAccessFile(c.members.viewer.id, secret.id)).toBe(false);

    const { body: mine } = await upload(c.artifact.id, c.members.editor);
    await addVersion(c.artifact.id, { content: slides(mine.fileId), userId: c.owner.id, setStatusReady: true });
    const [v] = await db.select({ cur: artifacts.currentVersionId }).from(artifacts).where(eq(artifacts.id, c.artifact.id));

    // PATCH nội dung chứa fileId của tệp bí mật
    const res = await patchArtifact(
      makeRequest(`/api/artifacts/${c.artifact.id}`, { method: "PATCH", user: c.members.editor, body: { content: slides(secret.id), baseVersionId: v.cur } }),
      params({ artifactId: c.artifact.id }),
    );
    expect(res.status).toBeLessThan(300);

    expect((await fileGet(secret.id, { user: c.members.viewer })).status).toBe(404);
    expect(await canAccessFile(c.members.viewer.id, secret.id)).toBe(false);
    expect(await canAccessFile(c.members.editor.id, secret.id)).toBe(false);
    // Ảnh hợp lệ do server đăng ký: thành viên xem được artifact đọc được
    expect((await fileGet(mine.fileId, { user: c.members.viewer })).status).toBe(200);
  });

  it("khách có token cũng không đọc được tệp chỉ có trong JSON mà server chưa đăng ký", async () => {
    const c = await setup();
    const secret = await getStorage().put(Buffer.from("bí mật"), { ownerId: c.owner.id, mime: "image/png", name: "s.png" });
    await addVersion(c.artifact.id, { content: slides(secret.id), userId: c.owner.id, setStatusReady: true });
    let [row] = await db.select().from(artifacts).where(eq(artifacts.id, c.artifact.id));
    row = await setVisibility(row, { role: "owner" }, "link");
    expect((await fileGet(secret.id, { share: row.shareToken! })).status).toBe(401);
  });

  it("nhân bản artifact sao chép liên kết ảnh để người xem bản sao đọc được ảnh", async () => {
    const c = await setup();
    const { body } = await upload(c.artifact.id, c.members.editor);
    await addVersion(c.artifact.id, { content: slides(body.fileId), userId: c.owner.id, setStatusReady: true });
    const res = await forkRoute(makeRequest("/x", { method: "POST", user: c.members.editor }), params({ artifactId: c.artifact.id }));
    expect(res.status).toBe(201);
    const forkId = ((await json(res)) as { artifact: { id: string } }).artifact.id;
    expect(await db.select().from(artifactFiles).where(eq(artifactFiles.artifactId, forkId))).toHaveLength(1);
  });
});
