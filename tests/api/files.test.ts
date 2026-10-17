import { describe, expect, it } from "vitest";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { getStorage } from "@/server/storage/local";
import { createNotebookWithMembers, insertSource } from "../helpers/fixtures";
import { createTestUser, makeRequest, params } from "../helpers/users";

describe("GET /api/files/[id]", () => {
  it("401 khi chưa đăng nhập", async () => {
    const res = await getFile(makeRequest("/api/files/x"), params({ id: "00000000-0000-4000-8000-000000000000" }));
    expect(res.status).toBe(401);
  });

  it("stream đúng nội dung + header cho chủ tệp; người lạ nhận 404", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const row = await getStorage().put(Buffer.from("Nội dung PDF giả"), { ownerId: owner.id, mime: "application/pdf", name: "bài giảng.pdf" });
    const res = await getFile(makeRequest(`/api/files/${row.id}`, { user: owner }), params({ id: row.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("content-disposition")).toContain(encodeURIComponent("bài giảng.pdf"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("Nội dung PDF giả");

    const denied = await getFile(makeRequest(`/api/files/${row.id}`, { user: stranger }), params({ id: row.id }));
    expect(denied.status).toBe(404);
  });

  it("thành viên notebook đọc được tệp của nguồn; ETag → 304", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["viewer"]);
    const row = await getStorage().put(Buffer.from("tài liệu"), { ownerId: owner.id, mime: "text/plain", name: "t.txt" });
    await insertSource(notebook.id, owner.id, { kind: "file", fileId: row.id });
    const res = await getFile(makeRequest(`/api/files/${row.id}`, { user: members.viewer }), params({ id: row.id }));
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag")!;
    const req = makeRequest(`/api/files/${row.id}`, { user: members.viewer });
    req.headers.set("if-none-match", etag);
    expect((await getFile(req, params({ id: row.id }))).status).toBe(304);
  });

  it("HTML/SVG luôn bị ép tải xuống (chống XSS)", async () => {
    const owner = await createTestUser();
    const row = await getStorage().put(Buffer.from("<script>alert(1)</script>"), { ownerId: owner.id, mime: "text/html", name: "x.html" });
    const res = await getFile(makeRequest(`/api/files/${row.id}`, { user: owner }), params({ id: row.id }));
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("id không hợp lệ → 404", async () => {
    const u = await createTestUser();
    const res = await getFile(makeRequest("/api/files/abc", { user: u }), params({ id: "abc" }));
    expect(res.status).toBe(404);
  });
});
