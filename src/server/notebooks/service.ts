import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { db, type Database } from "@/server/db";
import {
  channelMembers,
  channels,
  notebookInvites,
  notebookMembers,
  notebooks,
  userProfiles,
  users,
  type Role,
} from "@/server/db/schema";
import { randomToken } from "@/server/crypto";
import { DEFAULT_COVER_COLOR, DEFAULT_EMOJI } from "@/lib/notebook-colors";
import type { CreateNotebookInput, UpdateNotebookInput } from "@/lib/validators/notebooks";
import { canAssignRole, roleRank } from "@/lib/roles";
import { emitToNotebook } from "@/server/chat/realtime";

/** Báo cho các client đang mở sổ tay biết danh sách thành viên đã đổi. */
function notifyMembersChanged(notebookId: string) {
  emitToNotebook(notebookId, "member:changed", { notebookId });
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Tx;

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type MemberPreview = { id: string; name: string; image: string | null };

export type NotebookListItem = {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  coverColor: string | null;
  role: Role;
  ownerId: string;
  memberCount: number;
  members: MemberPreview[];
  createdAt: Date;
  updatedAt: Date;
};

/** Tạo notebook + owner member + kênh `general` + channel_members. */
export async function createNotebook(userId: string, input: CreateNotebookInput) {
  return db.transaction(async (tx) => {
    const [nb] = await tx
      .insert(notebooks)
      .values({
        ownerId: userId,
        title: input.title,
        description: input.description ?? null,
        emoji: input.emoji ?? DEFAULT_EMOJI,
        coverColor: input.coverColor ?? DEFAULT_COVER_COLOR,
      })
      .returning();
    await tx.insert(notebookMembers).values({
      notebookId: nb.id,
      userId,
      role: "owner",
      invitedBy: userId,
    });
    const [general] = await tx
      .insert(channels)
      .values({ notebookId: nb.id, type: "general", name: "general", createdBy: userId })
      .returning();
    await tx.insert(channelMembers).values({ channelId: general.id, userId });
    return nb;
  });
}

export async function listNotebooksForUser(userId: string, q?: string): Promise<NotebookListItem[]> {
  const filters = [eq(notebookMembers.userId, userId), isNull(notebooks.deletedAt)];
  if (q && q.trim()) {
    const pattern = `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    filters.push(sql`(${notebooks.title} ilike ${pattern} or ${notebooks.description} ilike ${pattern})`);
  }
  const rows = await db
    .select({ nb: notebooks, role: notebookMembers.role })
    .from(notebookMembers)
    .innerJoin(notebooks, eq(notebooks.id, notebookMembers.notebookId))
    .where(and(...filters))
    .orderBy(desc(notebooks.updatedAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.nb.id);
  const memberRows = await db
    .select({
      notebookId: notebookMembers.notebookId,
      id: users.id,
      name: users.name,
      image: users.image,
      joinedAt: notebookMembers.joinedAt,
    })
    .from(notebookMembers)
    .innerJoin(users, eq(users.id, notebookMembers.userId))
    .where(inArray(notebookMembers.notebookId, ids))
    .orderBy(asc(notebookMembers.joinedAt));
  const byNb = new Map<string, MemberPreview[]>();
  const counts = new Map<string, number>();
  for (const m of memberRows) {
    counts.set(m.notebookId, (counts.get(m.notebookId) ?? 0) + 1);
    const list = byNb.get(m.notebookId) ?? [];
    if (list.length < 4) list.push({ id: m.id, name: m.name, image: m.image });
    byNb.set(m.notebookId, list);
  }
  return rows.map(({ nb, role }) => ({
    id: nb.id,
    title: nb.title,
    description: nb.description,
    emoji: nb.emoji,
    coverColor: nb.coverColor,
    role,
    ownerId: nb.ownerId,
    memberCount: counts.get(nb.id) ?? 1,
    members: byNb.get(nb.id) ?? [],
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
  }));
}

export async function getNotebook(notebookId: string) {
  const [nb] = await db
    .select()
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), isNull(notebooks.deletedAt)))
    .limit(1);
  if (!nb) throw ApiError.notFound("Không tìm thấy sổ tay");
  return nb;
}

export async function updateNotebook(notebookId: string, patch: UpdateNotebookInput) {
  const [nb] = await db
    .update(notebooks)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(notebooks.id, notebookId), isNull(notebooks.deletedAt)))
    .returning();
  if (!nb) throw ApiError.notFound("Không tìm thấy sổ tay");
  return nb;
}

export async function softDeleteNotebook(notebookId: string) {
  await db.update(notebooks).set({ deletedAt: new Date() }).where(eq(notebooks.id, notebookId));
}

export async function touchNotebook(notebookId: string) {
  await db.update(notebooks).set({ updatedAt: new Date() }).where(eq(notebooks.id, notebookId));
}

/* ------------------------------ Thành viên ------------------------------ */

export type MemberView = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  joinedAt: Date;
};
export type PendingInviteView = {
  id: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: Date;
  createdAt: Date;
};

export async function listMembers(notebookId: string): Promise<MemberView[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: notebookMembers.role,
      joinedAt: notebookMembers.joinedAt,
    })
    .from(notebookMembers)
    .innerJoin(users, eq(users.id, notebookMembers.userId))
    .where(eq(notebookMembers.notebookId, notebookId))
    .orderBy(asc(notebookMembers.joinedAt));
  return rows.sort((a, b) => roleRank(b.role) - roleRank(a.role) || a.joinedAt.getTime() - b.joinedAt.getTime());
}

export async function listPendingInvites(notebookId: string): Promise<PendingInviteView[]> {
  return db
    .select({
      id: notebookInvites.id,
      email: notebookInvites.email,
      role: notebookInvites.role,
      token: notebookInvites.token,
      expiresAt: notebookInvites.expiresAt,
      createdAt: notebookInvites.createdAt,
    })
    .from(notebookInvites)
    .where(
      and(
        eq(notebookInvites.notebookId, notebookId),
        isNull(notebookInvites.acceptedAt),
        sql`${notebookInvites.expiresAt} > now()`,
      ),
    )
    .orderBy(desc(notebookInvites.createdAt));
}

/** Thêm thành viên + đưa vào kênh general của notebook. Idempotent. */
export async function addMember(
  notebookId: string,
  userId: string,
  role: Role,
  invitedBy: string | null,
  executor: Executor = db,
): Promise<boolean> {
  const inserted = await executor
    .insert(notebookMembers)
    .values({ notebookId, userId, role, invitedBy })
    .onConflictDoNothing()
    .returning({ userId: notebookMembers.userId });
  const [general] = await executor
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.notebookId, notebookId), eq(channels.type, "general")))
    .limit(1);
  if (general) {
    await executor.insert(channelMembers).values({ channelId: general.id, userId }).onConflictDoNothing();
  }
  return inserted.length > 0;
}

export type InviteResult =
  | { status: "added"; member: { userId: string; role: Role } }
  | { status: "invited"; invite: { id: string; email: string; role: Role; token: string; link: string; expiresAt: Date } };

export async function inviteMember(opts: {
  notebookId: string;
  actorId: string;
  actorRole: Role;
  email: string;
  role: Role;
}): Promise<InviteResult> {
  const { notebookId, actorId, actorRole, email, role } = opts;
  if (!canAssignRole(actorRole, role)) {
    throw ApiError.forbidden("Bạn không thể gán vai trò ngang hoặc cao hơn vai trò của mình");
  }
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);

  if (existing) {
    const added = await addMember(notebookId, existing.id, role, actorId);
    if (!added) throw ApiError.conflict("Người dùng đã là thành viên của sổ tay", "already_member");
    await db.delete(notebookInvites).where(
      and(eq(notebookInvites.notebookId, notebookId), sql`lower(${notebookInvites.email}) = ${email.toLowerCase()}`),
    );
    notifyMembersChanged(notebookId);
    return { status: "added", member: { userId: existing.id, role } };
  }

  // Thay lời mời cũ (chưa chấp nhận) của cùng email.
  await db.delete(notebookInvites).where(
    and(
      eq(notebookInvites.notebookId, notebookId),
      sql`lower(${notebookInvites.email}) = ${email.toLowerCase()}`,
      isNull(notebookInvites.acceptedAt),
    ),
  );
  const token = randomToken();
  const [invite] = await db
    .insert(notebookInvites)
    .values({
      notebookId,
      email: email.toLowerCase(),
      role,
      token,
      invitedBy: actorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning();
  return {
    status: "invited",
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token,
      link: `/invite/${token}`,
      expiresAt: invite.expiresAt,
    },
  };
}

export async function revokeInvite(notebookId: string, inviteId: string) {
  await db
    .delete(notebookInvites)
    .where(and(eq(notebookInvites.id, inviteId), eq(notebookInvites.notebookId, notebookId)));
}

export async function changeMemberRole(opts: {
  notebookId: string;
  actorId: string;
  actorRole: Role;
  targetUserId: string;
  role: Role;
}) {
  const { notebookId, actorId, actorRole, targetUserId, role } = opts;
  if (targetUserId === actorId) throw ApiError.badRequest("Không thể tự đổi vai trò của chính mình");
  const [target] = await db
    .select({ role: notebookMembers.role })
    .from(notebookMembers)
    .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, targetUserId)))
    .limit(1);
  if (!target) throw ApiError.notFound("Không tìm thấy thành viên");
  if (target.role === "owner") throw ApiError.conflict("Không thể đổi vai trò của chủ sở hữu; hãy dùng chuyển quyền", "owner_immutable");
  if (actorRole !== "owner" && roleRank(target.role) >= roleRank(actorRole)) {
    throw ApiError.forbidden("Bạn không thể thay đổi thành viên có vai trò ngang hoặc cao hơn");
  }
  if (!canAssignRole(actorRole, role)) {
    throw ApiError.forbidden("Bạn không thể gán vai trò ngang hoặc cao hơn vai trò của mình");
  }
  await db
    .update(notebookMembers)
    .set({ role })
    .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, targetUserId)));
  notifyMembersChanged(notebookId);
}

export async function removeMember(opts: {
  notebookId: string;
  actorId: string;
  actorRole: Role;
  targetUserId: string;
}) {
  const { notebookId, actorId, actorRole, targetUserId } = opts;
  const [target] = await db
    .select({ role: notebookMembers.role })
    .from(notebookMembers)
    .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, targetUserId)))
    .limit(1);
  if (!target) throw ApiError.notFound("Không tìm thấy thành viên");
  if (target.role === "owner") throw ApiError.conflict("Không thể xoá chủ sở hữu sổ tay", "owner_immutable");
  const self = targetUserId === actorId;
  if (!self) {
    if (actorRole !== "owner" && roleRank(actorRole) < roleRank("admin")) throw ApiError.forbidden();
    if (actorRole !== "owner" && roleRank(target.role) >= roleRank(actorRole)) {
      throw ApiError.forbidden("Bạn không thể xoá thành viên có vai trò ngang hoặc cao hơn");
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(notebookMembers)
      .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, targetUserId)));
    const chIds = tx.select({ id: channels.id }).from(channels).where(eq(channels.notebookId, notebookId));
    await tx
      .delete(channelMembers)
      .where(and(eq(channelMembers.userId, targetUserId), inArray(channelMembers.channelId, chIds)));
  });
  notifyMembersChanged(notebookId);
}

export async function transferOwnership(notebookId: string, fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) throw ApiError.badRequest("Người nhận phải khác chủ sở hữu hiện tại");
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: notebookMembers.role })
      .from(notebookMembers)
      .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, toUserId)))
      .limit(1);
    if (!target) throw ApiError.badRequest("Người nhận phải là thành viên của sổ tay", "not_a_member");
    await tx
      .update(notebookMembers)
      .set({ role: "admin" })
      .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, fromUserId)));
    await tx
      .update(notebookMembers)
      .set({ role: "owner" })
      .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, toUserId)));
    await tx.update(notebooks).set({ ownerId: toUserId, updatedAt: new Date() }).where(eq(notebooks.id, notebookId));
  });
  notifyMembersChanged(notebookId);
}

/* -------------------------------- Lời mời -------------------------------- */

export async function getInviteByToken(token: string) {
  const [row] = await db
    .select({
      invite: notebookInvites,
      notebookTitle: notebooks.title,
      notebookEmoji: notebooks.emoji,
      notebookDeletedAt: notebooks.deletedAt,
      inviterName: users.name,
    })
    .from(notebookInvites)
    .innerJoin(notebooks, eq(notebooks.id, notebookInvites.notebookId))
    .leftJoin(users, eq(users.id, notebookInvites.invitedBy))
    .where(eq(notebookInvites.token, token))
    .limit(1);
  if (!row || row.notebookDeletedAt) throw ApiError.notFound("Lời mời không tồn tại hoặc đã bị thu hồi");
  return row;
}

export async function acceptInvite(token: string, user: { id: string; email: string }) {
  const row = await getInviteByToken(token);
  const { invite } = row;
  if (invite.acceptedAt) throw ApiError.conflict("Lời mời đã được sử dụng", "invite_used");
  if (isInviteExpired(invite)) throw ApiError.badRequest("Lời mời đã hết hạn", "invite_expired");
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw ApiError.forbidden("Lời mời này dành cho một địa chỉ email khác");
  }
  await db.transaction(async (tx) => {
    await addMember(invite.notebookId, user.id, invite.role, invite.invitedBy, tx);
    await tx.update(notebookInvites).set({ acceptedAt: new Date() }).where(eq(notebookInvites.id, invite.id));
  });
  notifyMembersChanged(invite.notebookId);
  return { notebookId: invite.notebookId, role: invite.role };
}

/** Hồ sơ hiển thị (profile + user). */
export async function getProfile(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [p] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return { user: u, profile: p ?? null };
}

/** Lời mời đã quá hạn chưa (hàm thuần theo thời điểm gọi). */
export function isInviteExpired(invite: { expiresAt: Date }, now: number = Date.now()): boolean {
  return invite.expiresAt.getTime() < now;
}
