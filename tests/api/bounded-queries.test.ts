import { describe, expect, it } from "vitest";
import { GET as listNotesRoute } from "@/app/api/notebooks/[id]/notes/route";
import { db } from "@/server/db";
import { conversations, messages, notes } from "@/server/db/schema";
import { listRecentMessages } from "@/server/chat/conversations";
import type { NoteListItem } from "@/lib/notes";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { json } from "../helpers/team-chat";
import { makeRequest, params } from "../helpers/users";

describe("M-11 · truy vấn có giới hạn", () => {
  it("listRecentMessages chỉ trả N tin gần nhất, đúng thứ tự cũ → mới", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const [conv] = await db.insert(conversations).values({ notebookId: notebook.id, userId: owner.id }).returning();
    const base = Date.now() - 1_000_000;
    await db.insert(messages).values(
      Array.from({ length: 70 }, (_, i) => ({
        conversationId: conv.id,
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `tin ${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    );
    const recent = await listRecentMessages(conv.id, 60);
    expect(recent).toHaveLength(60);
    expect(recent[0].content).toBe("tin 10");
    expect(recent[59].content).toBe("tin 69");
    expect((await listRecentMessages(conv.id, 5)).map((m) => m.content)).toEqual(["tin 65", "tin 66", "tin 67", "tin 68", "tin 69"]);
  });

  it("danh sách ghi chú chỉ trả đoạn trích, không kéo cả nội dung dài; chi tiết vẫn đầy đủ", async () => {
    const { owner, notebook } = await createNotebookWithMembers();
    const long = "Mở đầu ngắn gọn. " + "x".repeat(200_000);
    const [row] = await db.insert(notes).values({ notebookId: notebook.id, createdBy: owner.id, title: "Dài", contentMd: long }).returning();
    const res = await listNotesRoute(makeRequest(`/api/notebooks/${notebook.id}/notes`, { user: owner }), params({ id: notebook.id }));
    const { notes: list } = (await json(res)) as { notes: NoteListItem[] };
    const item = list.find((n) => n.id === row.id)!;
    expect(item.excerpt.startsWith("Mở đầu ngắn gọn.")).toBe(true);
    expect(JSON.stringify(item).length).toBeLessThan(2000);
    expect("contentMd" in item).toBe(false);
  });
});
