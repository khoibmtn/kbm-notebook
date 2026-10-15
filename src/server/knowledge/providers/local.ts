import "server-only";
import { and, cosineDistance, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getAiProviderForUser } from "@/server/ai";
import { EMBEDDING_DIM, type AiProvider } from "@/server/ai/provider";
import { db } from "@/server/db";
import { sourceChunks, sources } from "@/server/db/schema";
import { rrfMerge } from "../rrf";
import type { Evidence, EvidenceLocator, KnowledgeProvider, RetrieveQuery } from "./types";

/** Số ứng viên lấy từ mỗi nhánh (vector, full-text) trước khi gộp RRF. */
export const CANDIDATES_PER_BRANCH = 30;
export const DEFAULT_TOP_K = 12;

type Candidate = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  unit: string | null;
  page: number | null;
  section: string | null;
  startChar: number;
  endChar: number;
  text: string;
  distance?: number;
};

const STOPWORDS = new Set(
  "và của là có cho các một những được trong với này khi để không đã sẽ cũng như từ theo về tại hoặc nhưng nên thì mà bị đến gì sao nào thế the and for that with this from are was were is of in to on at by be as an it have has had not but you your they their will can its into what when where how who which".split(
    " ",
  ),
);

/**
 * Chuyển câu hỏi tự nhiên thành chuỗi websearch với toán tử `or` giữa các từ khoá
 * (`websearch_to_tsquery` mặc định là AND nên câu hỏi dài hầu như không khớp).
 */
export function toWebSearchQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(tokens)].slice(0, 24).join(" or ");
}

function visibleChunkFilter(q: RetrieveQuery): SQL {
  const conds: (SQL | undefined)[] = [
    eq(sourceChunks.notebookId, q.notebookId),
    isNull(sources.deletedAt),
    eq(sources.status, "ready"),
    or(eq(sources.visibility, "shared"), eq(sources.createdBy, q.userId)),
  ];
  if (q.sourceIds) conds.push(q.sourceIds.length ? inArray(sourceChunks.sourceId, q.sourceIds) : sql`false`);
  return and(...conds)!;
}

const candidateColumns = {
  id: sourceChunks.id,
  sourceId: sourceChunks.sourceId,
  sourceTitle: sources.title,
  unit: sql<string | null>`${sources.metadata}->>'unit'`,
  page: sourceChunks.page,
  section: sourceChunks.section,
  startChar: sourceChunks.startChar,
  endChar: sourceChunks.endChar,
  text: sourceChunks.text,
};

function toLocator(c: Candidate): EvidenceLocator {
  const loc: EvidenceLocator = { startChar: c.startChar, endChar: c.endChar };
  if (c.page != null) {
    if (c.unit === "slide") loc.slide = c.page;
    else loc.page = c.page;
  }
  if (c.section) loc.section = c.section;
  return loc;
}

/** Kho tri thức cục bộ: hybrid search = pgvector cosine + full-text (tsvector), gộp bằng RRF. */
export class LocalKnowledgeProvider implements KnowledgeProvider {
  readonly kind = "local" as const;

  constructor(private readonly deps: { getProvider?: (userId: string) => Promise<AiProvider> } = {}) {}

  async retrieve(q: RetrieveQuery): Promise<Evidence[]> {
    const query = q.query.trim();
    if (!query) return [];
    if (q.sourceIds && q.sourceIds.length === 0) return [];
    const topK = Math.max(1, Math.min(q.topK ?? DEFAULT_TOP_K, 50));
    const where = visibleChunkFilter(q);

    const provider = await (this.deps.getProvider ?? getAiProviderForUser)(q.userId);
    const [embedding] = await provider.embed([query], { taskType: "RETRIEVAL_QUERY", dim: EMBEDDING_DIM });

    const distance = cosineDistance(sourceChunks.embedding, embedding);
    const vectorQuery = db
      .select({ ...candidateColumns, distance })
      .from(sourceChunks)
      .innerJoin(sources, eq(sources.id, sourceChunks.sourceId))
      .where(and(where, isNotNull(sourceChunks.embedding)))
      .orderBy(distance)
      .limit(CANDIDATES_PER_BRANCH);

    const ftsText = toWebSearchQuery(query);
    const ftsQuery = ftsText
      ? sql`websearch_to_tsquery('simple', ${ftsText})`
      : null;
    const textQuery = ftsQuery
      ? db
          .select({ ...candidateColumns, rank: sql<number>`ts_rank(${sourceChunks.tsv}, ${ftsQuery})` })
          .from(sourceChunks)
          .innerJoin(sources, eq(sources.id, sourceChunks.sourceId))
          .where(and(where, sql`${sourceChunks.tsv} @@ ${ftsQuery}`))
          .orderBy(sql`ts_rank(${sourceChunks.tsv}, ${ftsQuery}) DESC`)
          .limit(CANDIDATES_PER_BRANCH)
      : Promise.resolve([]);

    const [vectorRows, textRows] = await Promise.all([vectorQuery, textQuery]);
    const vec: Candidate[] = vectorRows.map((r) => ({ ...r, distance: Number(r.distance) }));
    const fts: Candidate[] = textRows.map((r) => ({ ...r }));

    const merged = rrfMerge([vec, fts], (c) => c.id).slice(0, topK);
    return merged.map(({ item, score }) => {
      const hit = vec.find((v) => v.id === item.id);
      const ev: Evidence = {
        id: item.id,
        provider: "local",
        sourceId: item.sourceId,
        sourceTitle: item.sourceTitle,
        locator: toLocator(item),
        text: item.text,
        score,
      };
      if (hit?.distance !== undefined) ev.similarity = Math.max(0, Math.min(1, 1 - hit.distance));
      return ev;
    });
  }
}

export const localKnowledgeProvider = new LocalKnowledgeProvider();
