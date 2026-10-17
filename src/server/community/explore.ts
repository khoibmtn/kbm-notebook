import "server-only";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, groupMembers, groupNotebooks, groups, notebookMembers, notebooks, users } from "@/server/db/schema";
import type { ArtifactTypeName } from "@/lib/artifacts/content";
import { EXPLORE_PAGE_SIZE, type ExploreArtifactDto, type ExploreNotebookDto, type ExploreSort, type GroupRole, type GroupSummaryDto, type Paged } from "@/lib/community";

export function escapeLike(q: string): string {
  return q.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export function likePattern(q: string): string {
  return `%${escapeLike(q.trim())}%`;
}

const likeCountSql = sql<number>`(select count(*)::int from artifact_likes l where l.artifact_id = ${artifacts.id})`;
const commentCountSql = sql<number>`(select count(*)::int from artifact_comments c where c.artifact_id = ${artifacts.id})`;

export const artifactLikeCount = (artifactId: SQL | typeof artifacts.id) => sql<number>`(select count(*)::int from artifact_likes l where l.artifact_id = ${artifactId})`;
export const artifactCommentCount = (artifactId: SQL | typeof artifacts.id) => sql<number>`(select count(*)::int from artifact_comments c where c.artifact_id = ${artifactId})`;

function paginate<T>(rows: T[], page: number): Paged<T> {
  return { items: rows.slice(0, EXPLORE_PAGE_SIZE), page, hasMore: rows.length > EXPLORE_PAGE_SIZE };
}

/**
 * Artifact công khai (`visibility='public'`, chưa xoá, đã `ready`, sổ tay chưa xoá) cho Explore.
 * Tên sổ tay chỉ lộ khi sổ tay đó cũng công khai.
 */
export async function listPublicArtifacts(opts: {
  q?: string;
  type?: ArtifactTypeName;
  sort: ExploreSort;
  page: number;
}): Promise<Paged<ExploreArtifactDto>> {
  const conds: (SQL | undefined)[] = [
    eq(artifacts.visibility, "public"),
    isNull(artifacts.deletedAt),
    eq(artifacts.status, "ready"),
    isNull(notebooks.deletedAt),
    opts.type ? eq(artifacts.type, opts.type) : undefined,
    opts.q?.trim() ? sql`${artifacts.title} ilike ${likePattern(opts.q)}` : undefined,
  ];
  const rows = await db
    .select({
      id: artifacts.id,
      type: artifacts.type,
      title: artifacts.title,
      createdAt: artifacts.createdAt,
      authorId: users.id,
      authorName: users.name,
      authorImage: users.image,
      nbTitle: notebooks.title,
      nbSlug: notebooks.publicSlug,
      nbPublic: notebooks.isPublic,
      likeCount: likeCountSql,
      commentCount: commentCountSql,
    })
    .from(artifacts)
    .innerJoin(notebooks, eq(notebooks.id, artifacts.notebookId))
    .innerJoin(users, eq(users.id, artifacts.createdBy))
    .where(and(...conds))
    .orderBy(...(opts.sort === "likes" ? [desc(likeCountSql), desc(artifacts.createdAt), desc(artifacts.id)] : [desc(artifacts.createdAt), desc(artifacts.id)]))
    .limit(EXPLORE_PAGE_SIZE + 1)
    .offset((opts.page - 1) * EXPLORE_PAGE_SIZE);
  const dtos: ExploreArtifactDto[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    author: { id: r.authorId, name: r.authorName, image: r.authorImage },
    notebook: r.nbPublic && r.nbSlug ? { title: r.nbTitle, slug: r.nbSlug } : null,
    likeCount: Number(r.likeCount),
    commentCount: Number(r.commentCount),
  }));
  return paginate(dtos, opts.page);
}

/** Sổ tay công khai (`is_public` + `public_slug`, chưa xoá). */
export async function listPublicNotebooks(opts: { q?: string; page: number }): Promise<Paged<ExploreNotebookDto>> {
  const conds: (SQL | undefined)[] = [
    eq(notebooks.isPublic, true),
    sql`${notebooks.publicSlug} is not null`,
    isNull(notebooks.deletedAt),
    opts.q?.trim() ? sql`(${notebooks.title} ilike ${likePattern(opts.q)} or ${notebooks.description} ilike ${likePattern(opts.q)})` : undefined,
  ];
  const rows = await db
    .select({
      id: notebooks.id,
      slug: notebooks.publicSlug,
      title: notebooks.title,
      description: notebooks.description,
      emoji: notebooks.emoji,
      coverColor: notebooks.coverColor,
      ownerName: users.name,
      updatedAt: notebooks.updatedAt,
      publicArtifactCount: sql<number>`(select count(*)::int from artifacts a where a.notebook_id = ${notebooks.id} and a.visibility = 'public' and a.deleted_at is null and a.status = 'ready')`,
    })
    .from(notebooks)
    .innerJoin(users, eq(users.id, notebooks.ownerId))
    .where(and(...conds))
    .orderBy(desc(notebooks.updatedAt), desc(notebooks.id))
    .limit(EXPLORE_PAGE_SIZE + 1)
    .offset((opts.page - 1) * EXPLORE_PAGE_SIZE);
  const dtos: ExploreNotebookDto[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug as string,
    title: r.title,
    description: r.description,
    emoji: r.emoji,
    coverColor: r.coverColor,
    ownerName: r.ownerName,
    publicArtifactCount: Number(r.publicArtifactCount),
    updatedAt: r.updatedAt.toISOString(),
  }));
  return paginate(dtos, opts.page);
}

export function toGroupRole(role: string | null | undefined): GroupRole | null {
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  return role ? "member" : null;
}

/** Nhóm công khai (mở tham gia) + nhóm riêng mà người xem là thành viên. */
export async function listGroupsForExplore(opts: { viewerId: string; q?: string; page: number }): Promise<Paged<GroupSummaryDto>> {
  const mine = sql`exists (select 1 from group_members gm where gm.group_id = ${groups.id} and gm.user_id = ${opts.viewerId})`;
  const conds: (SQL | undefined)[] = [
    sql`(${groups.visibility} = 'public' or ${mine})`,
    opts.q?.trim() ? sql`(${groups.name} ilike ${likePattern(opts.q)} or ${groups.description} ilike ${likePattern(opts.q)})` : undefined,
  ];
  const rows = await db
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      visibility: groups.visibility,
      memberCount: sql<number>`(select count(*)::int from ${groupMembers} gm where gm.group_id = ${groups.id})`,
      notebookCount: sql<number>`(select count(*)::int from ${groupNotebooks} gn where gn.group_id = ${groups.id})`,
      myRole: sql<string | null>`(select gm.role::text from ${groupMembers} gm where gm.group_id = ${groups.id} and gm.user_id = ${opts.viewerId})`,
    })
    .from(groups)
    .where(and(...conds))
    .orderBy(desc(groups.createdAt), desc(groups.id))
    .limit(EXPLORE_PAGE_SIZE + 1)
    .offset((opts.page - 1) * EXPLORE_PAGE_SIZE);
  const dtos: GroupSummaryDto[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    memberCount: Number(r.memberCount),
    notebookCount: Number(r.notebookCount),
    myRole: toGroupRole(r.myRole),
  }));
  return paginate(dtos, opts.page);
}

/** Vai trò của người dùng trong sổ tay (dùng cho trang công khai). */
export async function memberRoleOf(userId: string, notebookId: string): Promise<string | null> {
  const [r] = await db
    .select({ role: notebookMembers.role })
    .from(notebookMembers)
    .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, userId)))
    .limit(1);
  return r?.role ?? null;
}
