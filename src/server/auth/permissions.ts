import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { ApiError, isUuid } from "@/server/api/errors";
import { db } from "@/server/db";
import { artifactShares, notebookMembers, notebooks, users } from "@/server/db/schema";
import type { Artifact, Role, Source } from "@/server/db/schema";
import { hasRole } from "@/lib/roles";

export type { Role };

export { ROLE_ORDER, roleRank, hasRole, assignableRoles, canAssignRole } from "@/lib/roles";

/** Vai trò của user trong notebook (null nếu không phải thành viên hoặc notebook đã xoá). */
export async function getNotebookRole(userId: string, notebookId: string): Promise<Role | null> {
  if (!isUuid(notebookId) || !isUuid(userId)) return null;
  const rows = await db
    .select({ role: notebookMembers.role })
    .from(notebookMembers)
    .innerJoin(notebooks, eq(notebooks.id, notebookMembers.notebookId))
    .where(
      and(
        eq(notebookMembers.notebookId, notebookId),
        eq(notebookMembers.userId, userId),
        isNull(notebooks.deletedAt),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

/** Sổ tay còn tồn tại và chưa bị xoá mềm. */
export async function isNotebookActive(notebookId: string): Promise<boolean> {
  if (!isUuid(notebookId)) return false;
  const rows = await db
    .select({ id: notebooks.id })
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), isNull(notebooks.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Bắt buộc user có vai trò >= min trong notebook.
 * - Notebook không tồn tại / đã xoá / user không phải thành viên → 404 (không lộ sự tồn tại).
 * - Là thành viên nhưng thiếu quyền → 403.
 * Trả về vai trò thực của user.
 */
export async function requireNotebookRole(
  userId: string,
  notebookId: string,
  min: Role,
): Promise<Role> {
  const role = await getNotebookRole(userId, notebookId);
  if (!role) throw ApiError.notFound("Không tìm thấy sổ tay");
  if (!hasRole(role, min)) throw ApiError.forbidden();
  return role;
}

/**
 * Nguồn: phải là thành viên notebook; nguồn `private` chỉ chủ nguồn thấy. Nguồn đã xoá thì không thấy.
 */
export async function canViewSource(
  userId: string,
  source: Pick<Source, "notebookId" | "visibility" | "createdBy" | "deletedAt">,
): Promise<boolean> {
  if (source.deletedAt) return false;
  const role = await getNotebookRole(userId, source.notebookId);
  if (!role) return false;
  if (source.visibility === "shared") return true;
  return source.createdBy === userId;
}

type ArtifactForView = Pick<
  Artifact,
  "id" | "notebookId" | "createdBy" | "visibility" | "shareToken" | "deletedAt"
>;

/**
 * Artifact theo docs/02 §3.4:
 * - private: chủ artifact hoặc người được chia sẻ rõ ràng (artifact_shares)
 * - notebook: mọi thành viên notebook (+ người được chia sẻ)
 * - link: thành viên notebook, hoặc bất kỳ ai (kể cả chưa đăng nhập) có đúng share_token
 * - public: bất kỳ ai
 * `userId` có thể null (khách).
 */
export async function canViewArtifact(
  userId: string | null,
  artifact: ArtifactForView,
  opts: { shareToken?: string | null } = {},
): Promise<boolean> {
  if (artifact.deletedAt) return false;
  // Sổ tay đã xoá (mềm) → artifact không còn xem được bởi bất kỳ ai, kể cả liên kết/công khai (H-6).
  if (!(await isNotebookActive(artifact.notebookId))) return false;
  if (artifact.visibility === "public") return true;
  if (artifact.visibility === "link" && opts.shareToken && artifact.shareToken) {
    if (safeEqual(opts.shareToken, artifact.shareToken)) return true;
  }
  if (!userId) return false;
  if (artifact.createdBy === userId) return true;

  // chia sẻ trực tiếp
  const shared = await db
    .select({ id: artifactShares.id })
    .from(artifactShares)
    .leftJoin(users, eq(users.id, userId))
    .where(
      and(
        eq(artifactShares.artifactId, artifact.id),
        or(
          eq(artifactShares.userId, userId),
          and(isNull(artifactShares.userId), sql`lower(${artifactShares.email}) = lower(${users.email})`),
        ),
      ),
    )
    .limit(1);
  if (shared.length > 0) return true;

  if (artifact.visibility === "notebook" || artifact.visibility === "link") {
    const role = await getNotebookRole(userId, artifact.notebookId);
    return role != null;
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
