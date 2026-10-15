import { and, cosineDistance, eq, isNotNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { sourceChunks } from "@/server/db/schema";
import { EMBEDDING_DIM } from "@/server/ai/provider";
import { withVectorSearchTx } from "@/server/knowledge/providers/local";
import { createNotebookWithMembers, insertSource } from "../helpers/fixtures";

/** Vector đơn vị gần trục `axis` (0 = trục truy vấn), lệch nhẹ theo `jitter`. */
function vec(axis: number, jitter = 0): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[axis] = 1;
  v[(axis + 1 + (jitter % 50)) % EMBEDDING_DIM] = 0.001 * (1 + jitter);
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0));
  return v.map((x) => x / norm);
}

describe("M-10 · truy vấn vector nhiều sổ tay", () => {
  it("withVectorSearchTx đặt ef_search và iterative_scan chỉ trong transaction", async () => {
    const inside = await withVectorSearchTx(async (tx) => {
      const r = await tx.execute<{ ef: string; it: string | null }>(sql`select current_setting('hnsw.ef_search') as ef, current_setting('hnsw.iterative_scan', true) as it`);
      return r.rows[0];
    });
    expect(inside.ef).toBe("100");
    expect(inside.it).toBe("relaxed_order"); // pgvector >= 0.8 (môi trường test)
    const outside = await db.execute<{ ef: string }>(sql`select current_setting('hnsw.ef_search') as ef`);
    expect(outside.rows[0].ef).not.toBe("100");
  });

  it("sổ tay nhỏ vẫn có kết quả vector dù 150 chunk của sổ tay khác gần truy vấn hơn (quét chỉ mục, bộ lọc sau)", async () => {
    const big = await createNotebookWithMembers();
    const small = await createNotebookWithMembers();
    const srcBig = await insertSource(big.notebook.id, big.owner.id, { status: "ready" });
    const srcSmall = await insertSource(small.notebook.id, small.owner.id, { status: "ready" });
    const rows = (nb: string, src: string, n: number, axis: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({
        sourceId: src,
        notebookId: nb,
        idx: i,
        text: `chunk ${offset + i}`,
        tokenCount: 3,
        startChar: i * 10,
        endChar: i * 10 + 9,
        embedding: vec(axis, i),
      }));
    await db.insert(sourceChunks).values(rows(big.notebook.id, srcBig.id, 150, 0, 0)); // rất gần truy vấn
    await db.insert(sourceChunks).values(rows(small.notebook.id, srcSmall.id, 3, 5, 1000)); // xa hơn

    const query = vec(0);
    const found = await withVectorSearchTx(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`); // ép dùng chỉ mục HNSW như khi bảng lớn
      const distance = cosineDistance(sourceChunks.embedding, query);
      return tx
        .select({ id: sourceChunks.id, d: distance })
        .from(sourceChunks)
        .where(and(eq(sourceChunks.notebookId, small.notebook.id), isNotNull(sourceChunks.embedding)))
        .orderBy(distance)
        .limit(30);
    });
    expect(found).toHaveLength(3);
  });
});
