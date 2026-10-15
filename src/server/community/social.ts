import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { enforceRateLimit } from "@/server/api/rate-limit";
import { getNotebookRole, hasRole } from "@/server/auth/permissions";
import { loadArtifactAccess, type ArtifactAccess } from "@/server/artifacts/service";
import { db } from "@/server/db";
import { artifactComments, artifactLikes, users } from "@/server/db/schema";
import type { CommentDto, SocialSummaryDto } from "@/lib/community";

export const COMMENT_RATE = { limit: 20, windowMs: 60_000 } as const;

/** Artifact mà người gọi xem được (404 nếu không) — nền tảng cho thích/bình luận. */
export async function loadViewableArtifact(userId: string | null, artifactId: string, shareToken?: string | null): Promise<ArtifactAccess> {
  return loadArtifactAccess(userId, artifactId, { shareToken });
}

async function counts(artifactId: string): Promise<{ likeCount: number; commentCount: number }> {
  const [row] = await db.execute<{ likes: number; comments: number }>(sql`
    select
      (select count(*)::int from artifact_likes where artifact_id = ${artifactId}) as likes,
      (select count(*)::int from artifact_comments where artifact_id = ${artifactId}) as comments
  `).then((r) => r.rows);
  return { likeCount: Number(row?.likes ?? 0), commentCount: Number(row?.comments ?? 0) };
}

export async function getSocialSummary(artifactId: string, userId: string | null): Promise<SocialSummaryDto> {
  const c = await counts(artifactId);
  let liked = false;
  if (userId) {
    const [r] = await db
      .select({ u: artifactLikes.userId })
      .from(artifactLikes)
      .where(and(eq(artifactLikes.artifactId, artifactId), eq(artifactLikes.userId, userId)))
      .limit(1);
    liked = Boolean(r);
  }
  return { ...c, liked, canInteract: userId != null };
}

export async function likeArtifact(artifactId: string, userId: string): Promise<SocialSummaryDto> {
  await db.insert(artifactLikes).values({ artifactId, userId }).onConflictDoNothing();
  return getSocialSummary(artifactId, userId);
}

export async function unlikeArtifact(artifactId: string, userId: string): Promise<SocialSummaryDto> {
  await db.delete(artifactLikes).where(and(eq(artifactLikes.artifactId, artifactId), eq(artifactLikes.userId, userId)));
  return getSocialSummary(artifactId, userId);
}

/** Bình luận theo thứ tự cũ → mới; `canDelete` = của chính mình hoặc admin+ của sổ tay chứa artifact. */
export async function listComments(access: ArtifactAccess, viewerId: string | null, limit: number): Promise<CommentDto[]> {
  const rows = await db
    .select({
      id: artifactComments.id,
      body: artifactComments.body,
      createdAt: artifactComments.createdAt,
      userId: users.id,
      name: users.name,
      image: users.image,
    })
    .from(artifactComments)
    .innerJoin(users, eq(users.id, artifactComments.userId))
    .where(eq(artifactComments.artifactId, access.artifact.id))
    .orderBy(desc(artifactComments.createdAt), desc(artifactComments.id))
    .limit(limit);
  const admin = hasRole(access.role, "admin");
  return rows.reverse().map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    author: { id: r.userId, name: r.name, image: r.image },
    canDelete: viewerId != null && (r.userId === viewerId || admin),
  }));
}

export async function addComment(access: ArtifactAccess, user: { id: string; name: string; image?: string | null }, body: string): Promise<CommentDto> {
  await enforceRateLimit(`comment:${user.id}`, COMMENT_RATE.limit, COMMENT_RATE.windowMs, "Bạn bình luận quá nhanh. Thử lại sau ít phút.");
  const [row] = await db.insert(artifactComments).values({ artifactId: access.artifact.id, userId: user.id, body }).returning();
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: { id: user.id, name: user.name, image: user.image ?? null },
    canDelete: true,
  };
}

export async function deleteComment(access: ArtifactAccess, userId: string, commentId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(commentId)) throw ApiError.notFound("Không tìm thấy bình luận");
  const [c] = await db
    .select({ id: artifactComments.id, userId: artifactComments.userId })
    .from(artifactComments)
    .where(and(eq(artifactComments.id, commentId), eq(artifactComments.artifactId, access.artifact.id)))
    .limit(1);
  if (!c) throw ApiError.notFound("Không tìm thấy bình luận");
  if (c.userId !== userId) {
    // Quyền kiểm duyệt: admin+ của sổ tay chứa artifact (không dùng `access.role` đã nạp cho người khác).
    const role = await getNotebookRole(userId, access.artifact.notebookId);
    if (!hasRole(role, "admin")) throw ApiError.forbidden("Bạn chỉ có thể xoá bình luận của mình");
  }
  await db.delete(artifactComments).where(eq(artifactComments.id, commentId));
}
