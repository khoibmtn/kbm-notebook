import { describe, expect, it } from "vitest";
import { buildQueries, collectEvidence, EVIDENCE_PROFILES, resolveScopeSourceIds, WHOLE_DOC_BUDGET } from "@/server/artifacts/evidence";
import type { Evidence, RetrieveQuery } from "@/server/knowledge/providers/types";
import { createNotebookWithMembers } from "../helpers/fixtures";
import { insertReadySource } from "../helpers/artifacts";

const para = (topic: string, i: number) =>
  `${topic} đoạn số ${i}: ` + `nội dung chi tiết về ${topic} gồm nhiều câu mô tả khác nhau để đủ dài cho một đoạn tài liệu thực tế. `.repeat(6);

describe("chiến lược lấy bằng chứng cho artifact", () => {
  it("hồ sơ ngân sách: tài liệu dài 60k token, báo cáo/đề cương dùng ngân sách lớn nhất", () => {
    expect(WHOLE_DOC_BUDGET).toBe(60_000);
    for (const t of ["report", "study_guide", "timeline", "slide_deck"] as const) expect(EVIDENCE_PROFILES[t].budget).toBe(60_000);
    expect(EVIDENCE_PROFILES.note.budget).toBeLessThan(EVIDENCE_PROFILES.quiz.budget);
  });

  it("nguồn vừa ngân sách → lấy TOÀN BỘ chunk theo thứ tự tài liệu (strategy full), không cần truy vấn", async () => {
    const { owner, notebook } = await createNotebookWithMembers([]);
    const a = await insertReadySource(notebook.id, owner.id, { title: "A", pages: [para("quang hợp", 1), para("hô hấp", 2)] });
    const b = await insertReadySource(notebook.id, owner.id, { title: "B", pages: [para("di truyền", 3)] });
    let calls = 0;
    const res = await collectEvidence(
      { type: "report", notebookId: notebook.id, userId: owner.id },
      { retrieveFn: async () => { calls++; return []; } },
    );
    expect(res.strategy).toBe("full");
    expect(calls).toBe(0);
    expect(res.evidence.map((e) => e.sourceTitle)).toEqual(["A", "A", "B"]);
    expect(res.evidence.map((e) => e.locator.page)).toEqual([1, 2, 1]);
    expect(res.sourceIds.sort()).toEqual([a.id, b.id].sort());
  });

  it("vượt ngân sách → nhiều truy vấn (theo yêu cầu + tóm tắt/chủ đề từng nguồn), gộp/loại trùng, trong ngân sách, đúng thứ tự tài liệu", async () => {
    const { owner, notebook } = await createNotebookWithMembers([]);
    const a = await insertReadySource(notebook.id, owner.id, {
      title: "Sinh học",
      summary: "Tổng quan sinh học tế bào",
      keyTopics: ["quang hợp", "hô hấp"],
      pages: [1, 2, 3, 4].map((i) => para("sinh học", i)),
    });
    const b = await insertReadySource(notebook.id, owner.id, {
      title: "Hoá học",
      summary: "Tổng quan hoá hữu cơ",
      keyTopics: ["cacbon"],
      pages: [5, 6, 7, 8].map((i) => para("hoá học", i)),
    });

    const seen: RetrieveQuery[] = [];
    // retrieve giả: trả mọi chunk của nguồn được hỏi, điểm giảm dần theo vị trí → kiểm tra gộp/loại trùng/ngân sách
    const { db } = await import("@/server/db");
    const { sourceChunks, sources } = await import("@/server/db/schema");
    const { eq, inArray } = await import("drizzle-orm");
    const retrieveFn = async (q: RetrieveQuery): Promise<Evidence[]> => {
      seen.push(q);
      const rows = await db
        .select({ id: sourceChunks.id, sourceId: sourceChunks.sourceId, title: sources.title, page: sourceChunks.page, text: sourceChunks.text, start: sourceChunks.startChar, end: sourceChunks.endChar })
        .from(sourceChunks)
        .innerJoin(sources, eq(sources.id, sourceChunks.sourceId))
        .where(inArray(sourceChunks.sourceId, q.sourceIds!));
      return rows
        .sort((x, y) => (x.page ?? 0) - (y.page ?? 0))
        .slice(0, q.topK)
        .map((r, i) => ({ id: r.id, provider: "local" as const, sourceId: r.sourceId, sourceTitle: r.title, locator: { page: r.page ?? undefined, startChar: r.start, endChar: r.end }, text: r.text, score: 1 / (i + 1) }));
    };

    // mỗi chunk ≈ 150 token; ngân sách 700 token → khoảng 4 chunk
    const res = await collectEvidence({ type: "report", notebookId: notebook.id, userId: owner.id, instructions: "Nhấn mạnh năng lượng", budget: 700 }, { retrieveFn });
    expect(res.strategy).toBe("multi_query");
    expect(res.queries).toBe(seen.length);
    // truy vấn đầu là yêu cầu riêng trên toàn phạm vi; sau đó là truy vấn theo từng nguồn (tóm tắt + chủ đề)
    expect(seen[0].query).toBe("Nhấn mạnh năng lượng");
    expect(seen[0].sourceIds!.sort()).toEqual([a.id, b.id].sort());
    expect(seen.slice(1).every((q) => q.sourceIds!.length === 1)).toBe(true);
    expect(seen.some((q) => q.query.includes("Tổng quan sinh học tế bào"))).toBe(true);
    expect(seen.some((q) => q.query.includes("cacbon"))).toBe(true);
    // kết quả: không trùng id, trong ngân sách, cả hai nguồn đều có đại diện, theo thứ tự nguồn → vị trí
    const ids = res.evidence.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tokens = res.evidence.reduce((s, e) => s + Math.ceil(e.text.length / 4) + 24, 0);
    expect(tokens).toBeLessThanOrEqual(700);
    expect(new Set(res.evidence.map((e) => e.sourceTitle))).toEqual(new Set(["Sinh học", "Hoá học"]));
    const titles = res.evidence.map((e) => e.sourceTitle);
    expect(titles).toEqual([...titles].sort((x, y) => (x === "Sinh học" ? 0 : 1) - (y === "Sinh học" ? 0 : 1)));
  });

  it("dùng retrieve thật (hybrid) khi vượt ngân sách và vẫn trả bằng chứng", async () => {
    const { owner, notebook } = await createNotebookWithMembers([]);
    await insertReadySource(notebook.id, owner.id, { title: "Sinh học", summary: "Tế bào sinh học", keyTopics: ["ty thể"], pages: [1, 2, 3].map((i) => para("ty thể", i)) });
    const res = await collectEvidence({ type: "quiz", notebookId: notebook.id, userId: owner.id, instructions: "ty thể", budget: 400 });
    expect(res.strategy).toBe("multi_query");
    expect(res.evidence.length).toBeGreaterThan(0);
    expect(res.evidence.every((e) => e.provider === "local")).toBe(true);
  });

  it("phạm vi: chỉ nguồn ready + được dùng; nguồn private của người khác bị loại; rỗng → 400 no_sources", async () => {
    const { owner, notebook, members } = await createNotebookWithMembers(["editor"]);
    const shared = await insertReadySource(notebook.id, owner.id, { title: "Chung", pages: [para("chung", 1)] });
    const priv = await insertReadySource(notebook.id, owner.id, { title: "Riêng của chủ", pages: [para("riêng", 1)], visibility: "private" });
    expect((await resolveScopeSourceIds(notebook.id, members.editor.id)).sort()).toEqual([shared.id]);
    expect((await resolveScopeSourceIds(notebook.id, members.editor.id, [priv.id, shared.id])).sort()).toEqual([shared.id]);
    expect((await resolveScopeSourceIds(notebook.id, owner.id, [priv.id])).sort()).toEqual([priv.id]);
    await expect(collectEvidence({ type: "report", notebookId: notebook.id, userId: members.editor.id, sourceIds: [priv.id] })).rejects.toMatchObject({ status: 400, code: "no_sources" });
    const empty = await createNotebookWithMembers([]);
    await expect(collectEvidence({ type: "report", notebookId: empty.notebook.id, userId: empty.owner.id })).rejects.toMatchObject({ code: "no_sources" });
  });
});

describe("buildQueries", () => {
  const src = (id: string, topics: string[]) => ({ id, title: `Nguồn ${id}`, summary: `Tóm tắt ${id}`, keyTopics: topics });

  it("yêu cầu riêng đứng đầu; chia vòng tròn giữa các nguồn; mỗi nguồn có truy vấn tiêu đề+tóm tắt", () => {
    const q = buildQueries([src("a", ["x1", "x2"]), src("b", ["y1"])], "Hãy tập trung");
    expect(q[0]).toEqual({ query: "Hãy tập trung", sourceId: null });
    expect(q.slice(1).map((x) => x.sourceId)).toEqual(["a", "b", "a", "b", "a"]);
    expect(q[1].query).toContain("Nguồn a. Tóm tắt a");
    expect(q.some((x) => x.query.startsWith("y1"))).toBe(true);
  });

  it("giới hạn 40 truy vấn kể cả khi có rất nhiều chủ đề; không có yêu cầu riêng thì không có truy vấn toàn cục", () => {
    const topics = Array.from({ length: 50 }, (_, i) => `chủ đề ${i}`);
    const q = buildQueries([src("a", topics), src("b", topics)], "   ");
    expect(q).toHaveLength(40);
    expect(q[0].sourceId).not.toBeNull();
    expect(q.filter((x) => x.sourceId === "a").length).toBe(20);
    expect(q.filter((x) => x.sourceId === "b").length).toBe(20);
  });
});
