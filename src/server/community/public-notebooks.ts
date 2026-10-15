import "server-only";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { db } from "@/server/db";
import { artifacts, notebooks, users, type Notebook } from "@/server/db/schema";
import { SLUG_MAX, slugify, type PublicNotebookDto } from "@/lib/community";

async function slugTaken(slug: string, exceptNotebookId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: notebooks.id })
    .from(notebooks)
    .where(and(eq(notebooks.publicSlug, slug), exceptNotebookId ? ne(notebooks.id, exceptNotebookId) : undefined))
    .limit(1);
  return rows.length > 0;
}

/** Sinh slug duy nhất từ tiêu đề (thêm hậu tố ngẫu nhiên khi trùng / rỗng). */
export async function generateUniqueNotebookSlug(title: string, notebookId?: string): Promise<string> {
  const base = slugify(title).slice(0, SLUG_MAX - 7).replace(/-+$/g, "") || "so-tay";
  const candidates = [base.length >= 3 ? base : `${base}-sotay`];
  for (let i = 0; i < 6; i++) candidates.push(`${candidates[0]}-${Math.random().toString(36).slice(2, 6)}`);
  for (const c of candidates) if (!(await slugTaken(c, notebookId))) return c;
  return `${candidates[0]}-${Date.now().toString(36)}`;
}

/**
 * Bật/tắt công khai sổ tay (chỉ owner — route đã kiểm). Bật mà chưa có slug → tự sinh từ tiêu đề.
 * Slug nhập tay phải duy nhất (409 `slug_taken`). Tắt công khai vẫn giữ slug để bật lại về đúng địa chỉ cũ.
 */
export async function setNotebookPublic(notebook: Notebook, input: { isPublic: boolean; slug?: string }): Promise<Notebook> {
  let slug = input.slug ?? notebook.publicSlug ?? null;
  if (input.isPublic && !slug) slug = await generateUniqueNotebookSlug(notebook.title, notebook.id);
  if (slug && (await slugTaken(slug, notebook.id))) throw ApiError.conflict("Đường dẫn này đã được sử dụng", "slug_taken");
  try {
    const [row] = await db
      .update(notebooks)
      .set({ isPublic: input.isPublic, publicSlug: slug, updatedAt: new Date() })
      .where(and(eq(notebooks.id, notebook.id), isNull(notebooks.deletedAt)))
      .returning();
    if (!row) throw ApiError.notFound("Không tìm thấy sổ tay");
    return row;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw ApiError.conflict("Đường dẫn này đã được sử dụng", "slug_taken");
    throw e;
  }
}

/** Sổ tay công khai theo slug, hoặc null. Không bao giờ bao gồm nguồn, ghi chú, chat. */
export async function getPublicNotebookBySlug(slug: string): Promise<PublicNotebookDto | null> {
  const [nb] = await db
    .select({
      id: notebooks.id,
      slug: notebooks.publicSlug,
      title: notebooks.title,
      description: notebooks.description,
      emoji: notebooks.emoji,
      coverColor: notebooks.coverColor,
      ownerName: users.name,
    })
    .from(notebooks)
    .innerJoin(users, eq(users.id, notebooks.ownerId))
    .where(and(eq(notebooks.publicSlug, slug), eq(notebooks.isPublic, true), isNull(notebooks.deletedAt)))
    .limit(1);
  if (!nb || !nb.slug) return null;
  const rows = await db
    .select({
      id: artifacts.id,
      type: artifacts.type,
      title: artifacts.title,
      createdAt: artifacts.createdAt,
      likeCount: sql<number>`(select count(*)::int from artifact_likes l where l.artifact_id = ${artifacts.id})`,
      commentCount: sql<number>`(select count(*)::int from artifact_comments c where c.artifact_id = ${artifacts.id})`,
    })
    .from(artifacts)
    .where(and(eq(artifacts.notebookId, nb.id), eq(artifacts.visibility, "public"), eq(artifacts.status, "ready"), isNull(artifacts.deletedAt)))
    .orderBy(desc(artifacts.createdAt))
    .limit(100);
  return {
    id: nb.id,
    slug: nb.slug,
    title: nb.title,
    description: nb.description,
    emoji: nb.emoji,
    coverColor: nb.coverColor,
    ownerName: nb.ownerName,
    artifacts: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      likeCount: Number(r.likeCount),
      commentCount: Number(r.commentCount),
    })),
  };
}
