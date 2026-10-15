import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { enforceRateLimit } from "@/server/api/rate-limit";
import { emitToNotebook, emitToUser } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { notebookJoinRequests, notebookMembers, notebooks, notifications, users } from "@/server/db/schema";
import { addMember } from "@/server/notebooks/service";
import { localesOf, toNotificationDTO } from "@/server/team-chat/notify";
import { makeT, type MessageKey, type MessageParams } from "@/lib/i18n";
import type { JoinRequestDto } from "@/lib/community";

/** Gửi thông báo (đã dịch theo ngôn ngữ từng người nhận) và đẩy realtime. */
export async function notifyUsers(
  userIds: string[],
  spec: { type: string; titleKey: MessageKey; bodyKey?: MessageKey; params: MessageParams; body?: string | null; link: string; data?: Record<string, unknown> },
): Promise<void> {
  if (userIds.length === 0) return;
  const locales = await localesOf(userIds);
  const values = userIds.map((userId) => {
    const t = makeT(locales.get(userId) ?? "vi");
    return {
      userId,
      type: spec.type,
      title: t(spec.titleKey, spec.params),
      body: spec.body ?? (spec.bodyKey ? t(spec.bodyKey, spec.params) : null),
      link: spec.link,
      data: spec.data ?? null,
    };
  });
  const rows = await db.insert(notifications).values(values).returning();
  for (const row of rows) emitToUser(row.userId, "notification", { notification: toNotificationDTO(row) });
}

const JOIN_RATE = { limit: 10, windowMs: 60 * 60 * 1000 };

/** Gửi yêu cầu tham gia sổ tay công khai; báo cho owner + admin. */
export async function createJoinRequest(
  notebookId: string,
  user: { id: string; name: string },
  message: string | undefined,
): Promise<JoinRequestDto> {
  const [nb] = await db
    .select({ id: notebooks.id, title: notebooks.title })
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), eq(notebooks.isPublic, true), isNull(notebooks.deletedAt)))
    .limit(1);
  if (!nb) throw ApiError.notFound("Không tìm thấy sổ tay");
  const [member] = await db
    .select({ r: notebookMembers.role })
    .from(notebookMembers)
    .where(and(eq(notebookMembers.notebookId, notebookId), eq(notebookMembers.userId, user.id)))
    .limit(1);
  if (member) throw ApiError.conflict("Bạn đã là thành viên của sổ tay này", "already_member");
  const [pending] = await db
    .select({ id: notebookJoinRequests.id })
    .from(notebookJoinRequests)
    .where(and(eq(notebookJoinRequests.notebookId, notebookId), eq(notebookJoinRequests.userId, user.id), eq(notebookJoinRequests.status, "pending")))
    .limit(1);
  if (pending) throw ApiError.conflict("Bạn đã gửi yêu cầu, đang chờ duyệt", "request_pending");
  await enforceRateLimit(`join-request:${user.id}`, JOIN_RATE.limit, JOIN_RATE.windowMs, "Bạn gửi yêu cầu tham gia quá nhiều. Thử lại sau {minutes} phút.");

  let row;
  try {
    [row] = await db.insert(notebookJoinRequests).values({ notebookId, userId: user.id, message: message || null }).returning();
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw ApiError.conflict("Bạn đã gửi yêu cầu, đang chờ duyệt", "request_pending");
    throw e;
  }
  const managers = await db
    .select({ userId: notebookMembers.userId })
    .from(notebookMembers)
    .where(and(eq(notebookMembers.notebookId, notebookId), inArray(notebookMembers.role, ["owner", "admin"])));
  await notifyUsers(
    managers.map((m) => m.userId),
    {
      type: "join_request",
      titleKey: "community.notif.joinRequest",
      params: { name: user.name, notebook: nb.title },
      body: message || null,
      link: `/n/${notebookId}/members?requests=1`,
      data: { notebookId, requestId: row.id, userId: user.id },
    },
  );
  emitToNotebook(notebookId, "member:changed", { notebookId });
  return {
    id: row.id,
    notebookId,
    status: row.status,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    user: { id: user.id, name: user.name, email: "", image: null },
  };
}

/** Yêu cầu đang chờ của sổ tay (admin+ xem). */
export async function listPendingJoinRequests(notebookId: string): Promise<JoinRequestDto[]> {
  const rows = await db
    .select({ r: notebookJoinRequests, name: users.name, email: users.email, image: users.image })
    .from(notebookJoinRequests)
    .innerJoin(users, eq(users.id, notebookJoinRequests.userId))
    .where(and(eq(notebookJoinRequests.notebookId, notebookId), eq(notebookJoinRequests.status, "pending")))
    .orderBy(desc(notebookJoinRequests.createdAt));
  return rows.map(({ r, name, email, image }) => ({
    id: r.id,
    notebookId: r.notebookId,
    status: r.status,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    user: { id: r.userId, name, email, image },
  }));
}

/** Trạng thái yêu cầu gần nhất của chính người dùng (cho nút ở trang công khai). */
export async function getMyJoinRequestStatus(notebookId: string, userId: string): Promise<"pending" | "rejected" | null> {
  const [r] = await db
    .select({ status: notebookJoinRequests.status })
    .from(notebookJoinRequests)
    .where(and(eq(notebookJoinRequests.notebookId, notebookId), eq(notebookJoinRequests.userId, userId)))
    .orderBy(desc(notebookJoinRequests.createdAt))
    .limit(1);
  if (r?.status === "pending") return "pending";
  if (r?.status === "rejected") return "rejected";
  return null;
}

/** Duyệt/từ chối (admin+ — route đã kiểm). Chấp nhận → thêm làm `viewer`. Idempotent theo trạng thái: đã quyết định → 409. */
export async function decideJoinRequest(opts: {
  notebookId: string;
  requestId: string;
  actorId: string;
  decision: "accept" | "reject";
}): Promise<{ status: "accepted" | "rejected"; userId: string }> {
  const { notebookId, requestId, actorId, decision } = opts;
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw ApiError.notFound("Không tìm thấy yêu cầu");
  const next = decision === "accept" ? ("accepted" as const) : ("rejected" as const);
  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string; user_id: string; status: string }>(
      sql`select id, user_id, status from notebook_join_requests where id = ${requestId} and notebook_id = ${notebookId} for update`,
    );
    const row = locked.rows[0];
    if (!row) throw ApiError.notFound("Không tìm thấy yêu cầu");
    if (row.status !== "pending") throw ApiError.conflict("Yêu cầu này đã được xử lý", "already_decided");
    if (decision === "accept") await addMember(notebookId, row.user_id, "viewer", actorId, tx);
    await tx
      .update(notebookJoinRequests)
      .set({ status: next, decidedAt: new Date(), decidedBy: actorId })
      .where(eq(notebookJoinRequests.id, requestId));
    return { userId: row.user_id };
  });
  const [nb] = await db.select({ title: notebooks.title }).from(notebooks).where(eq(notebooks.id, notebookId)).limit(1);
  await notifyUsers([result.userId], {
    type: next === "accepted" ? "join_accepted" : "join_rejected",
    titleKey: next === "accepted" ? "community.notif.joinAccepted" : "community.notif.joinRejected",
    params: { notebook: nb?.title ?? "" },
    link: next === "accepted" ? `/n/${notebookId}` : `/explore`,
    data: { notebookId, requestId },
  });
  if (next === "accepted") emitToNotebook(notebookId, "member:changed", { notebookId });
  return { status: next, userId: result.userId };
}
