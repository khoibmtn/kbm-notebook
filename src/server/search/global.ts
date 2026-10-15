import "server-only";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, artifactVersions, notebookMembers, notebooks, notes, users } from "@/server/db/schema";
import { likePattern } from "@/server/community/explore";
import { searchMessagesAcross } from "@/server/team-chat/queries";
import { HL_END, HL_START, SEARCH_TYPES, type SearchResponseDto, type SearchResultDto, type SearchType } from "@/lib/community";
import { buildTsQuery, highlightTitle, makeSnippet } from "./snippet";

type Ctx = {
  userId: string;
  q: string;
  limit: number;
  /** Sổ tay (đã lọc theo thành viên) → tiêu đề. */
  nbTitles: Map<string, string>;
  nbIds: string[];
  tsq: string | null;
};

const inList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

const base = (c: Ctx, over: Partial<SearchResultDto> & Pick<SearchResultDto, "type" | "id" | "title" | "href">): SearchResultDto => ({
  snippet: null,
  titleHl: highlightTitle(over.title, c.q),
  notebookId: null,
  notebookTitle: null,
  meta: {},
  ...over,
});

/** Sổ tay mà user là thành viên (chưa xoá), tuỳ chọn thu hẹp về một sổ tay. */
async function memberNotebooks(userId: string, only?: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: notebooks.id, title: notebooks.title })
    .from(notebookMembers)
    .innerJoin(notebooks, eq(notebooks.id, notebookMembers.notebookId))
    .where(and(eq(notebookMembers.userId, userId), isNull(notebooks.deletedAt), only ? eq(notebooks.id, only) : undefined));
  return new Map(rows.map((r) => [r.id, r.title]));
}

async function searchNotebooks(c: Ctx): Promise<SearchResultDto[]> {
  if (c.nbIds.length === 0) return [];
  const like = likePattern(c.q);
  const rows = await db
    .select({ id: notebooks.id, title: notebooks.title, description: notebooks.description, emoji: notebooks.emoji })
    .from(notebooks)
    .where(and(inArray(notebooks.id, c.nbIds), sql`(${notebooks.title} ilike ${like} or ${notebooks.description} ilike ${like})`))
    .orderBy(desc(notebooks.updatedAt))
    .limit(c.limit);
  return rows.map((r) =>
    base(c, {
      type: "notebooks",
      id: r.id,
      title: r.title,
      snippet: makeSnippet(r.description, c.q),
      href: `/n/${r.id}`,
      notebookId: r.id,
      notebookTitle: r.title,
      meta: { kind: r.emoji ?? undefined },
    }),
  );
}

type SourceHit = { id: string; notebook_id: string; title: string; chunk_id: string | null; page: number | null; snippet: string | null };

/** Nguồn: tiêu đề (ILIKE) + nội dung đoạn (`tsv`, `ts_headline`); chỉ nguồn shared hoặc của chính mình (`canViewSource`). */
async function searchSources(c: Ctx): Promise<SearchResultDto[]> {
  if (c.nbIds.length === 0) return [];
  const visible = sql`s.deleted_at is null and (s.visibility = 'shared' or s.created_by = ${c.userId})`;
  const out: SourceHit[] = [];
  if (c.tsq) {
    const res = await db.execute<SourceHit>(sql`
      select * from (
        select distinct on (s.id) s.id, s.notebook_id, s.title, sc.id as chunk_id, sc.page,
          ts_headline('simple', sc.text, to_tsquery('simple', ${c.tsq}),
            ${`StartSel=${HL_START}, StopSel=${HL_END}, MaxFragments=1, MinWords=12, MaxWords=34`}) as snippet,
          ts_rank(sc.tsv, to_tsquery('simple', ${c.tsq})) as rank
        from source_chunks sc
        join sources s on s.id = sc.source_id
        where sc.notebook_id in (${inList(c.nbIds)}) and s.status = 'ready' and ${visible}
          and sc.tsv @@ to_tsquery('simple', ${c.tsq})
        order by s.id, rank desc
      ) x order by rank desc limit ${c.limit}
    `);
    out.push(...res.rows);
  }
  if (out.length < c.limit) {
    const res = await db.execute<SourceHit>(sql`
      select s.id, s.notebook_id, s.title, null::uuid as chunk_id, null::int as page, left(coalesce(s.summary, ''), 400) as snippet
      from sources s
      where s.notebook_id in (${inList(c.nbIds)}) and ${visible} and s.title ilike ${likePattern(c.q)}
      order by s.updated_at desc limit ${c.limit}
    `);
    const have = new Set(out.map((r) => r.id));
    for (const r of res.rows) if (!have.has(r.id) && out.length < c.limit) out.push({ ...r, snippet: r.snippet ? makeSnippet(r.snippet, c.q) : null });
  }
  return out.map((r) =>
    base(c, {
      type: "sources",
      id: r.id,
      title: r.title,
      snippet: r.snippet,
      href: `/n/${r.notebook_id}/sources/${r.id}${r.chunk_id ? `?chunk=${r.chunk_id}` : ""}`,
      notebookId: r.notebook_id,
      notebookTitle: c.nbTitles.get(r.notebook_id) ?? null,
      meta: { page: r.page },
    }),
  );
}

async function searchNotes(c: Ctx): Promise<SearchResultDto[]> {
  if (c.nbIds.length === 0) return [];
  const match: SQL[] = [sql`${notes.title} ilike ${likePattern(c.q)}`];
  if (c.tsq) match.push(sql`to_tsvector('simple', ${notes.title} || ' ' || ${notes.contentMd}) @@ to_tsquery('simple', ${c.tsq})`);
  const rows = await db
    .select({ id: notes.id, notebookId: notes.notebookId, title: notes.title, contentMd: notes.contentMd, updatedAt: notes.updatedAt })
    .from(notes)
    .where(
      and(
        inArray(notes.notebookId, c.nbIds),
        isNull(notes.deletedAt),
        sql`(${notes.visibility} = 'shared' or ${notes.createdBy} = ${c.userId})`,
        sql`(${sql.join(match, sql` or `)})`,
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(c.limit);
  return rows.map((r) =>
    base(c, {
      type: "notes",
      id: r.id,
      title: r.title,
      snippet: makeSnippet(r.contentMd, c.q),
      href: `/n/${r.notebookId}/notes?note=${r.id}`,
      notebookId: r.notebookId,
      notebookTitle: c.nbTitles.get(r.notebookId) ?? null,
      meta: { createdAt: r.updatedAt.toISOString() },
    }),
  );
}

/** Artifact trong sổ tay của mình mà mình được xem: của mình, hoặc chia sẻ cho sổ tay/liên kết/công khai, hoặc chia sẻ riêng cho mình. */
async function searchArtifacts(c: Ctx): Promise<SearchResultDto[]> {
  if (c.nbIds.length === 0) return [];
  const match: SQL[] = [sql`${artifacts.title} ilike ${likePattern(c.q)}`];
  if (c.tsq) match.push(sql`to_tsvector('simple', coalesce(${artifactVersions.contentMd}, '')) @@ to_tsquery('simple', ${c.tsq})`);
  const shared = sql`exists (select 1 from artifact_shares s left join users u on u.id = ${c.userId} where s.artifact_id = ${artifacts.id} and (s.user_id = ${c.userId} or (s.user_id is null and lower(s.email) = lower(u.email))))`;
  const rows = await db
    .select({ id: artifacts.id, notebookId: artifacts.notebookId, title: artifacts.title, type: artifacts.type, md: artifactVersions.contentMd, createdAt: artifacts.createdAt })
    .from(artifacts)
    .leftJoin(artifactVersions, eq(artifactVersions.id, artifacts.currentVersionId))
    .where(
      and(
        inArray(artifacts.notebookId, c.nbIds),
        isNull(artifacts.deletedAt),
        eq(artifacts.status, "ready"),
        sql`(${artifacts.createdBy} = ${c.userId} or ${artifacts.visibility} in ('notebook', 'link', 'public') or ${shared})`,
        sql`(${sql.join(match, sql` or `)})`,
      ),
    )
    .orderBy(desc(artifacts.updatedAt))
    .limit(c.limit);
  return rows.map((r) =>
    base(c, {
      type: "artifacts",
      id: r.id,
      title: r.title,
      snippet: makeSnippet(r.md, c.q),
      href: `/n/${r.notebookId}/artifacts/${r.id}`,
      notebookId: r.notebookId,
      notebookTitle: c.nbTitles.get(r.notebookId) ?? null,
      meta: { kind: r.type, createdAt: r.createdAt.toISOString() },
    }),
  );
}

async function searchTeamMessages(c: Ctx): Promise<SearchResultDto[]> {
  const hits = await searchMessagesAcross({ viewerId: c.userId, notebookIds: c.nbIds, q: c.q, limit: c.limit });
  return hits.map((h) =>
    base(c, {
      type: "messages",
      id: h.id,
      title: h.senderName,
      snippet: makeSnippet(h.content, c.q),
      href: `/n/${h.notebookId}/team?channel=${h.channelId}&message=${h.id}`,
      notebookId: h.notebookId,
      notebookTitle: c.nbTitles.get(h.notebookId) ?? null,
      meta: { channel: h.channelType === "dm" ? null : h.channelName, kind: h.channelType, createdAt: h.createdAt.toISOString() },
    }),
  );
}

/** Artifact công khai (Explore) — mọi người đều thấy, kể cả của sổ tay mình không tham gia. */
async function searchPublic(c: Ctx): Promise<SearchResultDto[]> {
  const match: SQL[] = [sql`${artifacts.title} ilike ${likePattern(c.q)}`];
  if (c.tsq) match.push(sql`to_tsvector('simple', coalesce(${artifactVersions.contentMd}, '')) @@ to_tsquery('simple', ${c.tsq})`);
  const rows = await db
    .select({ id: artifacts.id, title: artifacts.title, type: artifacts.type, md: artifactVersions.contentMd, createdAt: artifacts.createdAt, author: users.name })
    .from(artifacts)
    .innerJoin(notebooks, eq(notebooks.id, artifacts.notebookId))
    .innerJoin(users, eq(users.id, artifacts.createdBy))
    .leftJoin(artifactVersions, eq(artifactVersions.id, artifacts.currentVersionId))
    .where(and(eq(artifacts.visibility, "public"), eq(artifacts.status, "ready"), isNull(artifacts.deletedAt), isNull(notebooks.deletedAt), sql`(${sql.join(match, sql` or `)})`))
    .orderBy(desc(artifacts.createdAt))
    .limit(c.limit);
  return rows.map((r) =>
    base(c, {
      type: "public",
      id: r.id,
      title: r.title,
      snippet: makeSnippet(r.md, c.q),
      href: `/a/${r.id}`,
      meta: { kind: r.type, author: r.author, createdAt: r.createdAt.toISOString() },
    }),
  );
}

/**
 * Tìm kiếm toàn cục. Chỉ trong các sổ tay user là thành viên (trừ nhóm `public`):
 * nguồn riêng tư của người khác, ghi chú riêng, artifact riêng và DM của người khác không bao giờ xuất hiện.
 */
export async function globalSearch(opts: { userId: string; q: string; types?: SearchType[]; notebookId?: string; limit: number }): Promise<SearchResponseDto> {
  const nbTitles = await memberNotebooks(opts.userId, opts.notebookId);
  const q = opts.q.normalize("NFC");
  const ctx: Ctx = { userId: opts.userId, q, limit: opts.limit, nbTitles, nbIds: [...nbTitles.keys()], tsq: buildTsQuery(q) };
  const wanted = new Set<SearchType>(opts.types?.length ? opts.types : SEARCH_TYPES);
  // Tìm trong một sổ tay cụ thể thì không trộn artifact công khai của người lạ.
  if (opts.notebookId) wanted.delete("public");
  const run = async (type: SearchType, fn: (c: Ctx) => Promise<SearchResultDto[]>) => [type, wanted.has(type) ? await fn(ctx) : []] as const;
  const entries = await Promise.all([
    run("notebooks", searchNotebooks),
    run("sources", searchSources),
    run("notes", searchNotes),
    run("artifacts", searchArtifacts),
    run("messages", searchTeamMessages),
    run("public", searchPublic),
  ]);
  const groups = Object.fromEntries(entries) as Record<SearchType, SearchResultDto[]>;
  // Artifact công khai đã hiện ở nhóm "artifacts" (sổ tay của mình) thì không lặp ở "public".
  const mine = new Set(groups.artifacts.map((a) => a.id));
  groups.public = groups.public.filter((p) => !mine.has(p.id));
  return { query: q, groups };
}
