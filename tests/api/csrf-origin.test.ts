import { describe, expect, it } from "vitest";
import { POST as createConversation } from "@/app/api/notebooks/[id]/conversations/route";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { json } from "../helpers/team-chat";
import { params } from "../helpers/users";

describe("L-17 · route thay đổi trạng thái từ chối request từ site khác; L-7 JSON hỏng → 400", () => {
  it("Sec-Fetch-Site/Origin lạ → 403; cùng origin → qua", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const call = (headers: Record<string, string>, body = "{}") =>
      createConversation(
        new Request(`http://localhost:3000/api/notebooks/${notebook.id}/conversations`, {
          method: "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json", ...headers },
          body,
        }),
        params({ id: notebook.id }),
      );
    const blocked = await call({ "sec-fetch-site": "same-site" });
    expect(blocked.status).toBe(403);
    expect((await json(blocked)).error.code).toBe("forbidden_origin");
    expect((await call({ origin: "https://evil.example", host: "localhost:3000" })).status).toBe(403);
    expect((await call({ "sec-fetch-site": "same-origin", origin: "http://localhost:3000" })).status).toBe(201);
    expect((await call({})).status).toBe(201);
    // L-7: body không phải JSON → 400 thay vì 500
    const bad = await call({}, "{");
    expect(bad.status).toBe(400);
    expect((await json(bad)).error.code).toBe("invalid_json");
  });
});
