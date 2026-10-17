import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { sourceChunks, sources } from "@/server/db/schema";
import { retrieve } from "@/server/knowledge/retrieve";
import { listReadySourceIds, privateSourceIdsAmong } from "@/server/knowledge/sources";
import type { Evidence, EvidenceLocator, RetrieveQuery } from "@/server/knowledge/providers/types";
import type { ArtifactTypeName } from "@/lib/artifacts/content";

/**
 * Chiến lược lấy bằng chứng cho Studio (khác Chat: Chat hỏi một câu, còn artifact phải PHỦ nội dung).
 *
 * 1. Phạm vi = giao của `scope.sourceIds` (nếu có) với nguồn `ready` mà người tạo được dùng; rỗng → lỗi `no_sources`.
 * 2. Nếu tổng token chunk của phạm vi ≤ ngân sách của loại → lấy TOÀN BỘ chunk theo thứ tự tài liệu
 *    (`strategy: "full"`): báo cáo dài, đề cương, quiz đều thấy hết tư liệu, không phụ thuộc truy vấn.
 * 3. Ngược lại (`strategy: "multi_query"`): chạy nhiều truy vấn hybrid (`retrieve`):
 *    - một truy vấn theo yêu cầu riêng của người dùng trên toàn phạm vi;
 *    - với MỖI nguồn: truy vấn theo tiêu đề + phần đầu tóm tắt, và theo từng `key_topics`
 *      (giới hạn tổng MAX_QUERIES, chia vòng tròn giữa các nguồn để nguồn nào cũng có đại diện);
 *    gộp theo chunk id (cộng điểm RRF các truy vấn → chunk xuất hiện nhiều lần được ưu tiên),
 *    chọn theo điểm đến hết ngân sách token rồi sắp lại theo thứ tự tài liệu (nguồn → vị trí) để ngữ cảnh đọc liền mạch.
 */
export type EvidenceProfile = { budget: number; perQueryTopK: number };

export const WHOLE_DOC_BUDGET = 60_000;

export const EVIDENCE_PROFILES: Record<ArtifactTypeName, EvidenceProfile> = {
  report: { budget: WHOLE_DOC_BUDGET, perQueryTopK: 8 },
  study_guide: { budget: WHOLE_DOC_BUDGET, perQueryTopK: 8 },
  timeline: { budget: WHOLE_DOC_BUDGET, perQueryTopK: 8 },
  slide_deck: { budget: WHOLE_DOC_BUDGET, perQueryTopK: 8 },
  infographic: { budget: 40_000, perQueryTopK: 6 },
  mindmap: { budget: 32_000, perQueryTopK: 6 },
  quiz: { budget: 40_000, perQueryTopK: 8 },
  flashcards: { budget: 40_000, perQueryTopK: 8 },
  faq: { budget: 32_000, perQueryTopK: 6 },
  data_table: { budget: 40_000, perQueryTopK: 8 },
  note: { budget: 16_000, perQueryTopK: 6 },
};

const MAX_QUERIES = 40;

/**
 * Bỏ phần văn bản (`text`) của bằng chứng thuộc nguồn riêng tư khỏi `content.evidence` — chỉ giữ id/nguồn/tiêu đề/vị trí.
 * Dùng khi nội dung sẽ nằm trong artifact không riêng tư; trích dẫn vẫn mở được trình xem nguồn (kiểm quyền theo người xem).
 */
export function stripPrivateEvidenceText<T>(content: T, privateSourceIds: Set<string>): T {
  if (privateSourceIds.size === 0 || !content || typeof content !== "object") return content;
  const obj = content as Record<string, unknown>;
  const ev = obj.evidence;
  if (!Array.isArray(ev)) return content;
  const next = ev.map((e) => {
    const item = e as { sourceId?: string | null };
    return item && typeof item === "object" && item.sourceId && privateSourceIds.has(item.sourceId) ? { ...item, text: "" } : e;
  });
  return { ...obj, evidence: next } as T;
}

export type CollectedEvidence = {
  evidence: Evidence[];
  strategy: "full" | "multi_query";
  sourceIds: string[];
  queries: number;
};

export type CollectDeps = {
  retrieveFn?: (q: RetrieveQuery) => Promise<Evidence[]>;
};

const estimate = (text: string) => Math.ceil(text.length / 4);

function toLocator(c: { unit: string | null; page: number | null; section: string | null; startChar: number; endChar: number }): EvidenceLocator {
  const loc: EvidenceLocator = { startChar: c.startChar, endChar: c.endChar };
  if (c.page != null) {
    if (c.unit === "slide") loc.slide = c.page;
    else loc.page = c.page;
  }
  if (c.section) loc.section = c.section;
  return loc;
}

type SourceRow = { id: string; title: string; summary: string | null; keyTopics: string[] | null };

async function loadSources(ids: string[]): Promise<SourceRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: sources.id, title: sources.title, summary: sources.summary, keyTopics: sources.keyTopics })
    .from(sources)
    .where(and(inArray(sources.id, ids), isNull(sources.deletedAt)))
    .orderBy(asc(sources.createdAt), asc(sources.id));
  return rows;
}

/**
 * Nguồn dùng được = `scope.sourceIds` ∩ nguồn `ready` người tạo được xem (mặc định: tất cả).
 * `allowPrivate: false` (artifact đang chia sẻ cho sổ tay/liên kết) loại mọi nguồn riêng tư khỏi phạm vi (bất biến §3.4).
 */
export async function resolveScopeSourceIds(
  notebookId: string,
  userId: string,
  requested?: string[] | null,
  opts: { allowPrivate?: boolean } = {},
): Promise<string[]> {
  let ready = await listReadySourceIds(notebookId, userId);
  if (opts.allowPrivate === false) {
    const priv = await privateSourceIdsAmong(ready);
    ready = ready.filter((id) => !priv.has(id));
  }
  if (!requested || requested.length === 0) return ready;
  const allowed = new Set(ready);
  return requested.filter((id) => allowed.has(id));
}

/** Toàn bộ chunk của các nguồn theo thứ tự tài liệu → Evidence. */
async function loadAllChunks(sourceIds: string[], order: Map<string, number>): Promise<Evidence[]> {
  const rows = await db
    .select({
      id: sourceChunks.id,
      sourceId: sourceChunks.sourceId,
      sourceTitle: sources.title,
      unit: sql<string | null>`${sources.metadata}->>'unit'`,
      page: sourceChunks.page,
      section: sourceChunks.section,
      startChar: sourceChunks.startChar,
      endChar: sourceChunks.endChar,
      idx: sourceChunks.idx,
      text: sourceChunks.text,
    })
    .from(sourceChunks)
    .innerJoin(sources, eq(sources.id, sourceChunks.sourceId))
    .where(inArray(sourceChunks.sourceId, sourceIds));
  rows.sort((a, b) => (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.idx - b.idx);
  return rows.map((r) => ({
    id: r.id,
    provider: "local" as const,
    sourceId: r.sourceId,
    sourceTitle: r.sourceTitle,
    locator: toLocator(r),
    text: r.text,
    score: 1,
  }));
}

async function totalChunkTokens(sourceIds: string[]): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${sourceChunks.tokenCount}), 0)::int` })
    .from(sourceChunks)
    .where(inArray(sourceChunks.sourceId, sourceIds));
  return Number(row?.n ?? 0);
}

/** Dựng danh sách truy vấn (đã chia vòng tròn giữa các nguồn, tối đa MAX_QUERIES). */
export function buildQueries(srcs: SourceRow[], instructions: string): Array<{ query: string; sourceId: string | null }> {
  const out: Array<{ query: string; sourceId: string | null }> = [];
  const instr = instructions.trim();
  if (instr) out.push({ query: instr.slice(0, 600), sourceId: null });
  const perSource = srcs.map((s) => {
    const list: string[] = [];
    const head = [s.title, (s.summary ?? "").slice(0, 300)].filter(Boolean).join(". ");
    if (head) list.push(head);
    for (const topic of s.keyTopics ?? []) if (topic.trim()) list.push(`${topic.trim()} (${s.title})`);
    return list;
  });
  for (let round = 0; out.length < MAX_QUERIES; round++) {
    let added = false;
    for (let i = 0; i < srcs.length && out.length < MAX_QUERIES; i++) {
      const q = perSource[i][round];
      if (q) {
        out.push({ query: q, sourceId: srcs[i].id });
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

export async function collectEvidence(
  params: {
    type: ArtifactTypeName;
    notebookId: string;
    userId: string;
    sourceIds?: string[] | null;
    /** `false` = chỉ dùng nguồn chia sẻ (artifact không riêng tư). Mặc định `true`. */
    allowPrivate?: boolean;
    instructions?: string;
    budget?: number;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  },
  deps: CollectDeps = {},
): Promise<CollectedEvidence> {
  const profile = EVIDENCE_PROFILES[params.type];
  const budget = params.budget ?? profile.budget;
  const retrieveFn = deps.retrieveFn ?? ((q: RetrieveQuery) => retrieve(q));

  const sourceIds = await resolveScopeSourceIds(params.notebookId, params.userId, params.sourceIds, { allowPrivate: params.allowPrivate });
  if (sourceIds.length === 0) {
    throw new ApiError(400, "no_sources", "Chưa có nguồn nào sẵn sàng trong phạm vi đã chọn. Hãy thêm hoặc chọn nguồn đã xử lý xong.");
  }
  const srcs = await loadSources(sourceIds);
  const order = new Map(srcs.map((s, i) => [s.id, i]));
  const ids = srcs.map((s) => s.id);

  if ((await totalChunkTokens(ids)) <= budget) {
    const evidence = await loadAllChunks(ids, order);
    if (evidence.length === 0) {
      throw new ApiError(400, "no_sources", "Các nguồn đã chọn chưa có nội dung để tạo artifact.");
    }
    return { evidence, strategy: "full", sourceIds: ids, queries: 0 };
  }

  const queries = buildQueries(srcs, params.instructions ?? "");
  const pool = new Map<string, { ev: Evidence; score: number }>();
  let done = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    const batch = queries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((q) =>
        retrieveFn({
          query: q.query,
          notebookId: params.notebookId,
          userId: params.userId,
          sourceIds: q.sourceId ? [q.sourceId] : ids,
          topK: q.sourceId ? profile.perQueryTopK : profile.perQueryTopK * 2,
        }),
      ),
    );
    for (const list of results) {
      for (const ev of list) {
        const cur = pool.get(ev.id);
        if (cur) cur.score += ev.score;
        else pool.set(ev.id, { ev, score: ev.score });
      }
    }
    done += batch.length;
    await params.onProgress?.(done, queries.length);
  }

  const ranked = [...pool.values()].sort((a, b) => b.score - a.score);
  const picked: Evidence[] = [];
  let used = 0;
  for (const { ev, score } of ranked) {
    const cost = estimate(ev.text) + 24;
    if (used + cost > budget) continue; // bỏ chunk quá lớn, vẫn thử các chunk nhỏ hơn phía sau
    picked.push({ ...ev, score });
    used += cost;
  }
  picked.sort(
    (a, b) =>
      (order.get(a.sourceId ?? "") ?? 0) - (order.get(b.sourceId ?? "") ?? 0) ||
      (a.locator.startChar ?? 0) - (b.locator.startChar ?? 0),
  );
  if (picked.length === 0) {
    throw new ApiError(400, "no_sources", "Không tìm thấy nội dung phù hợp trong các nguồn đã chọn.");
  }
  return { evidence: picked, strategy: "multi_query", sourceIds: ids, queries: queries.length };
}
