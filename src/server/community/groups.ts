import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { ApiError, isUuid } from "@/server/api/errors";
import { requireNotebookRole, getNotebookRole, hasRole } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { groupMembers, groupNotebooks, groups, notebooks, users, type Group } from "@/server/db/schema";
import { slugify, type GroupRole, type GroupSummaryDto } from "@/lib/community";
import { toGroupRole } from "./explore";

/** Vai trò trong nhóm lưu bằng enum `member_role`: owner / admin / viewer (= "Thành viên"). */
const toDbRole = (r: "admin" | "member") => (r === "admin" ? ("admin" as const) : ("viewer" as const));

const RANK: Record<GroupRole, number> = { member: 0, admin: 1, owner: 2 };
export const groupHasRole = (role: GroupRole | null, min: GroupRole) => role != null && RANK[role] >= RANK[min];

export async function getGroupRole(userId: string, groupId: string): Promise<GroupRole | null> {
  const [r] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return toGroupRole(r?.role);
}

async function slugTaken(slug: string): Promise<boolean> {
  const rows = await db.select({ id: groups.id }).from(groups).where(eq(groups.slug, slug)).limit(1);
  return rows.length > 0;
}

async function uniqueGroupSlug(name: string): Promise<string> {
  const base = slugify(name).slice(0, 50).replace(/-+$/g, "") || "nhom";
  const first = base.length >= 3 ? base : `${base}-nhom`;
  if (!(await slugTaken(first))) return first;
  for (let i = 0; i < 6; i++) {
    const c = `${first}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await slugTaken(c))) return c;
  }
  return `${first}-${Date.now().toString(36)}`;
}

export async function createGroup(
  userId: string,
  input: { name: string; slug?: string; description?: string | null; visibility: "private" | "public" },
): Promise<Group> {
  const slug = input.slug ?? (await uniqueGroupSlug(input.name));
  if (input.slug && (await slugTaken(slug))) throw ApiError.conflict("Đường dẫn nhóm đã được sử dụng", "slug_taken");
  try {
    return await db.transaction(async (tx) => {
      const [g] = await tx
        .insert(groups)
        .values({ name: input.name, slug, description: input.description ?? null, ownerId: userId, visibility: input.visibility })
        .returning();
      await tx.insert(groupMembers).values({ groupId: g.id, userId, role: "owner" });
      return g;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw ApiError.conflict("Đường dẫn nhóm đã được sử dụng", "slug_taken");
    throw e;
  }
}

export async function getGroupById(groupId: string): Promise<Group> {
  if (!isUuid(groupId)) throw ApiError.notFound("Không tìm thấy nhóm");
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!g) throw ApiError.notFound("Không tìm thấy nhóm");
  return g;
}

export async function getGroupBySlug(slug: string): Promise<Group | null> {
  const [g] = await db.select().from(groups).where(eq(groups.slug, slug)).limit(1);
  return g ?? null;
}

/** Nhóm riêng tư chỉ thành viên thấy: người ngoài nhận 404 (không lộ sự tồn tại). */
export async function requireGroupAccess(userId: string, groupId: string, min: GroupRole | "viewer" = "viewer"): Promise<{ group: Group; role: GroupRole | null }> {
  const group = await getGroupById(groupId);
  const role = await getGroupRole(userId, groupId);
  if (group.visibility === "private" && !role) throw ApiError.notFound("Không tìm thấy nhóm");
  if (min !== "viewer" && !groupHasRole(role, min)) throw ApiError.forbidden();
  return { group, role };
}

export async function summarizeGroup(group: Group, viewerId: string | null): Promise<GroupSummaryDto> {
  const [row] = await db.execute<{ members: number; nbs: number }>(sql`
    select (select count(*)::int from group_members where group_id = ${group.id}) as members,
           (select count(*)::int from group_notebooks where group_id = ${group.id}) as nbs
  `).then((r) => r.rows);
  return {
    id: group.id,
    slug: group.slug,
    name: group.name,
    description: group.description,
    visibility: group.visibility,
    memberCount: Number(row?.members ?? 0),
    notebookCount: Number(row?.nbs ?? 0),
    myRole: viewerId ? await getGroupRole(viewerId, group.id) : null,
  };
}

export async function updateGroup(
  group: Group,
  patch: { name?: string; description?: string | null; visibility?: "private" | "public" },
): Promise<Group> {
  const [row] = await db.update(groups).set(patch).where(eq(groups.id, group.id)).returning();
  return row;
}

export async function deleteGroup(groupId: string): Promise<void> {
  await db.delete(groups).where(eq(groups.id, groupId));
}

/* -------------------------------- Thành viên -------------------------------- */

export type GroupMemberDto = { userId: string; name: string; email: string | null; image: string | null; role: GroupRole; joinedAt: string };

/** Thành viên nhóm. Email chỉ lộ cho admin+ của nhóm. */
export async function listGroupMembers(groupId: string, viewerRole: GroupRole | null): Promise<GroupMemberDto[]> {
  const rows = await db
    .select({ userId: users.id, name: users.name, email: users.email, image: users.image, role: groupMembers.role, joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.joinedAt));
  const showEmail = groupHasRole(viewerRole, "admin");
  return rows
    .map((r) => ({ userId: r.userId, name: r.name, email: showEmail ? r.email : null, image: r.image, role: toGroupRole(r.role) ?? ("member" as const), joinedAt: r.joinedAt.toISOString() }))
    .sort((a, b) => RANK[b.role] - RANK[a.role] || a.joinedAt.localeCompare(b.joinedAt));
}

/** Tham gia nhóm mở (`visibility='public'`). Nhóm riêng tư: chỉ được thêm bằng email → 403. */
export async function joinGroup(group: Group, userId: string): Promise<void> {
  if (group.visibility !== "public") throw ApiError.forbidden("Nhóm này chỉ tham gia theo lời mời");
  await db.insert(groupMembers).values({ groupId: group.id, userId, role: "viewer" }).onConflictDoNothing();
}

export async function addGroupMemberByEmail(group: Group, actorRole: GroupRole, input: { email: string; role: "admin" | "member" }): Promise<void> {
  if (input.role === "admin" && actorRole !== "owner") throw ApiError.forbidden("Chỉ chủ nhóm được thêm quản trị viên");
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`)
    .limit(1);
  if (!u) throw ApiError.notFound("Chưa có tài khoản với email này");
  const inserted = await db
    .insert(groupMembers)
    .values({ groupId: group.id, userId: u.id, role: toDbRole(input.role) })
    .onConflictDoNothing()
    .returning({ userId: groupMembers.userId });
  if (inserted.length === 0) throw ApiError.conflict("Người dùng đã là thành viên của nhóm", "already_member");
}

export async function setGroupMemberRole(group: Group, targetUserId: string, role: "admin" | "member"): Promise<void> {
  const target = await getGroupRole(targetUserId, group.id);
  if (!target) throw ApiError.notFound("Không tìm thấy thành viên");
  if (target === "owner") throw ApiError.conflict("Không thể đổi vai trò của chủ nhóm", "owner_immutable");
  await db
    .update(groupMembers)
    .set({ role: toDbRole(role) })
    .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, targetUserId)));
}

/** Rời nhóm (tự rời) hoặc xoá thành viên (admin+; admin không xoá được admin/owner khác). */
export async function removeGroupMember(group: Group, actor: { id: string; role: GroupRole }, targetUserId: string): Promise<void> {
  const target = await getGroupRole(targetUserId, group.id);
  if (!target) throw ApiError.notFound("Không tìm thấy thành viên");
  if (target === "owner") throw ApiError.conflict("Chủ nhóm không thể rời hoặc bị xoá khỏi nhóm", "owner_immutable");
  if (targetUserId !== actor.id) {
    if (!groupHasRole(actor.role, "admin")) throw ApiError.forbidden();
    if (actor.role !== "owner" && RANK[target] >= RANK[actor.role]) throw ApiError.forbidden("Bạn không thể xoá thành viên có vai trò ngang hoặc cao hơn");
  }
  await db.delete(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, targetUserId)));
}

/* ---------------------------------- Sổ tay ---------------------------------- */

export type GroupNotebookDto = {
  id: string;
  title: string;
  /** Người xem là thành viên sổ tay → mở được; ngược lại chỉ thấy tiêu đề kèm khoá. */
  accessible: boolean;
  emoji: string | null;
  description: string | null;
  canUnlink: boolean;
};

/** Liên kết sổ tay vào nhóm: người gọi phải là thành viên nhóm VÀ admin+ của sổ tay. */
export async function linkNotebook(group: Group, userId: string, notebookId: string): Promise<void> {
  const role = await getGroupRole(userId, group.id);
  if (!role) throw ApiError.forbidden("Chỉ thành viên nhóm mới liên kết được sổ tay");
  await requireNotebookRole(userId, notebookId, "admin");
  await db.insert(groupNotebooks).values({ groupId: group.id, notebookId }).onConflictDoNothing();
}

export async function unlinkNotebook(group: Group, userId: string, notebookId: string): Promise<void> {
  const groupRole = await getGroupRole(userId, group.id);
  const nbRole = await getNotebookRole(userId, notebookId);
  if (!hasRole(nbRole, "admin") && !groupHasRole(groupRole, "admin")) throw ApiError.forbidden();
  await db.delete(groupNotebooks).where(and(eq(groupNotebooks.groupId, group.id), eq(groupNotebooks.notebookId, notebookId)));
}

/**
 * Sổ tay đã liên kết. Thành viên nhóm thấy tất cả (sổ tay không truy cập được chỉ hiện tiêu đề + khoá);
 * người ngoài nhóm chỉ thấy những sổ tay họ đã là thành viên.
 */
export async function listGroupNotebooks(group: Group, viewerId: string, viewerGroupRole: GroupRole | null): Promise<GroupNotebookDto[]> {
  const rows = await db
    .select({
      id: notebooks.id,
      title: notebooks.title,
      emoji: notebooks.emoji,
      description: notebooks.description,
      nbRole: sql<string | null>`(select m.role::text from notebook_members m where m.notebook_id = ${notebooks.id} and m.user_id = ${viewerId})`,
    })
    .from(groupNotebooks)
    .innerJoin(notebooks, sql`${notebooks.id} = ${groupNotebooks.notebookId} and ${notebooks.deletedAt} is null`)
    .where(eq(groupNotebooks.groupId, group.id))
    .orderBy(asc(notebooks.title));
  const isMember = viewerGroupRole != null;
  const canGroupAdmin = groupHasRole(viewerGroupRole, "admin");
  return rows
    .filter((r) => isMember || r.nbRole != null)
    .map((r) => {
      const accessible = r.nbRole != null;
      return {
        id: r.id,
        title: r.title,
        accessible,
        emoji: accessible ? r.emoji : null,
        description: accessible ? r.description : null,
        canUnlink: canGroupAdmin || (r.nbRole === "admin" || r.nbRole === "owner"),
      };
    });
}
