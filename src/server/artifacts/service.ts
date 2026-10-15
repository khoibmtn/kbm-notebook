import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ApiError } from "@/server/api/errors";
import { verifiedEmailCondition, verifiedEmailRaw } from "@/server/auth/email-verified";
import { canViewArtifact, getNotebookRole, hasRole, type Role } from "@/server/auth/permissions";
import { emitToNotebook, emitToUser } from "@/server/chat/realtime";
import { randomToken } from "@/server/crypto";
import { db, type Database } from "@/server/db";
import {
  artifactShares,
  artifactVersions,
  artifacts,
  notebooks,
  users,
  type Artifact,
  type ArtifactVersionRow,
} from "@/server/db/schema";
import { emailVerificationRequired } from "@/server/env";
import { enqueue } from "@/server/jobs/queue";
import {
  contentSchemaFor,
  isMarkdownType,
  type ArtifactTypeName,
  type MarkdownContent,
} from "@/lib/artifacts/content";
import type {
  ArtifactDetailDto,
  ArtifactDto,
  ArtifactOptions,
  ArtifactShareDto,
  ArtifactStatus,
  ArtifactStatusEvent,
  ArtifactVersionDto,
  ArtifactVisibility,
  CreateArtifactInput,
  RegenerateArtifactInput,
  UpdateArtifactInput,
} from "@/lib/artifacts/meta";
import { t } from "@/lib/i18n";
import { contentToMarkdown } from "./exporters/markdown";
import { assertEngineAvailable } from "./registry";
import { privateSourceIdsAmong } from "@/server/knowledge/sources";
import { resolveScopeSourceIds } from "./evidence";

/** Payload job `generate_artifact`. */
export type GenerateArtifactPayload = { artifactId: string; notebookId: string; userId: string; reason: "create" | "regenerate" };

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Tx;

export type GenerationConfig = {
  customPrompt?: string;
  options?: Record<string, unknown>;
  scope?: { sourceIds?: string[] };
  model?: string;
  /** Tiêu đề do hệ thống đặt (chưa ai đổi) → cho phép lấy tiêu đề model đề xuất. */
  titleAuto?: boolean;
};

export function configOf(row: Pick<Artifact, "generationConfig">): GenerationConfig {
  return (row.generationConfig ?? {}) as GenerationConfig;
}

/* -------------------------------------------------------------------------- */
/* Quyền                                                                       */
/* -------------------------------------------------------------------------- */

export type ArtifactAccess = {
  artifact: Artifact;
  /** Vai trò trong notebook chứa artifact (null nếu không phải thành viên — vd. được chia sẻ riêng). */
  role: Role | null;
  canEdit: boolean;
  canManage: boolean;
  /**
   * Người xem "nội bộ": thành viên sổ tay, người tạo, hoặc được chia sẻ riêng. Khách (token/public/không liên quan)
   * chỉ thấy bản hiện tại — không thấy cấu hình sinh (prompt, id nguồn, model) hay lịch sử phiên bản (M-1).
   */
  internal: boolean;
};

async function shareRoleOf(userId: string, artifactId: string): Promise<"view" | "edit" | null> {
  const rows = await db
    .select({ role: artifactShares.role })
    .from(artifactShares)
    .leftJoin(users, eq(users.id, userId))
    .where(
      and(
        eq(artifactShares.artifactId, artifactId),
        or(
          eq(artifactShares.userId, userId),
          and(isNull(artifactShares.userId), sql`lower(${artifactShares.email}) = lower(${users.email})`, verifiedEmailCondition()),
        ),
      ),
    );
  if (rows.some((r) => r.role === "edit")) return "edit";
  return rows.length ? "view" : null;
}

/**
 * Nạp artifact + quyền của người gọi. Không xem được (không tồn tại / đã xoá / thiếu quyền) → 404.
 * - `canManage` (đổi chia sẻ, xoá, tạo lại, nhân bản): editor+ trong notebook.
 * - `canEdit` (sửa nội dung): editor+ hoặc được chia sẻ vai trò `edit`.
 */
export async function loadArtifactAccess(
  userId: string | null,
  artifactId: string,
  opts: { shareToken?: string | null; notebookId?: string } = {},
): Promise<ArtifactAccess> {
  const notFound = () => ApiError.notFound("Không tìm thấy artifact");
  if (!/^[0-9a-f-]{36}$/i.test(artifactId)) throw notFound();
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!artifact || artifact.deletedAt) throw notFound();
  if (opts.notebookId && artifact.notebookId !== opts.notebookId) throw notFound();
  if (!(await canViewArtifact(userId, artifact, { shareToken: opts.shareToken }))) throw notFound();
  const role = userId ? await getNotebookRole(userId, artifact.notebookId) : null;
  const isEditor = hasRole(role, "editor");
  const shareRole = userId && !isEditor ? await shareRoleOf(userId, artifact.id) : null;
  return {
    artifact,
    role,
    canEdit: isEditor || shareRole === "edit",
    canManage: isEditor,
    internal: role != null || shareRole != null || (userId != null && artifact.createdBy === userId),
  };
}

export function requireManage(access: ArtifactAccess): void {
  if (!access.canManage) throw ApiError.forbidden();
}
export function requireEdit(access: ArtifactAccess): void {
  if (!access.canEdit) throw ApiError.forbidden();
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

type RowWithMeta = {
  artifact: Artifact;
  versionNo: number | null;
  creatorName: string | null;
};

export function toArtifactDto(r: RowWithMeta, access: { canEdit: boolean; canManage: boolean }): ArtifactDto {
  const a = r.artifact;
  return {
    id: a.id,
    notebookId: a.notebookId,
    type: a.type,
    title: a.title,
    status: a.status,
    error: a.error,
    visibility: a.visibility,
    createdBy: a.createdBy,
    createdByName: r.creatorName,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    currentVersionId: a.currentVersionId,
    currentVersionNo: r.versionNo,
    forkedFromId: a.forkedFromId,
    containsPrivateSources: a.containsPrivateSources,
    canEdit: access.canEdit,
    canManage: access.canManage,
  };
}

export async function toDetailDto(access: ArtifactAccess, opts: { includeShareToken?: boolean } = {}): Promise<ArtifactDetailDto> {
  const a = access.artifact;
  let version: ArtifactVersionRow | null = null;
  if (a.currentVersionId) {
    const [v] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, a.currentVersionId)).limit(1);
    version = v ?? null;
  }
  const [creator] = await db.select({ name: users.name }).from(users).where(eq(users.id, a.createdBy)).limit(1);
  const cfg = configOf(a);
  return {
    ...toArtifactDto({ artifact: a, versionNo: version?.versionNo ?? null, creatorName: creator?.name ?? null }, access),
    content: version?.content ?? null,
    shareToken: access.canManage && opts.includeShareToken !== false ? a.shareToken : null,
    generationConfig: access.internal
      ? {
          customPrompt: cfg.customPrompt,
          options: cfg.options as ArtifactOptions | undefined,
          scope: cfg.scope,
          model: cfg.model,
        }
      : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Realtime                                                                    */
/* -------------------------------------------------------------------------- */

export function emitArtifactEvent(
  row: Pick<Artifact, "id" | "notebookId" | "type" | "status" | "error" | "createdBy" | "visibility">,
  change: ArtifactStatusEvent["change"],
  extra: { progress?: number; stage?: string } = {},
): void {
  const payload: ArtifactStatusEvent = {
    artifactId: row.id,
    notebookId: row.notebookId,
    type: row.type,
    status: row.status,
    progress: extra.progress ?? (row.status === "ready" ? 100 : 0),
    stage: extra.stage,
    error: row.error,
    createdBy: row.createdBy,
    visibility: row.visibility,
    change,
  };
  // Artifact riêng tư chỉ báo cho chủ nó; còn lại báo cho cả sổ tay.
  if (row.visibility === "private") emitToUser(row.createdBy, "artifact:status", payload);
  else emitToNotebook(row.notebookId, "artifact:status", payload);
}

/* -------------------------------------------------------------------------- */
/* Liệt kê                                                                     */
/* -------------------------------------------------------------------------- */

export async function listArtifacts(
  notebookId: string,
  viewer: { userId: string; role: Role },
  filter: { type?: ArtifactTypeName; status?: ArtifactStatus } = {},
): Promise<ArtifactDto[]> {
  const conds = [eq(artifacts.notebookId, notebookId), isNull(artifacts.deletedAt)];
  if (filter.type) conds.push(eq(artifacts.type, filter.type));
  if (filter.status) conds.push(eq(artifacts.status, filter.status));
  // Thấy được: của mình, hoặc đã chia sẻ cho sổ tay/liên kết, hoặc được chia sẻ riêng cho mình.
  const visible = or(
    eq(artifacts.createdBy, viewer.userId),
    inArray(artifacts.visibility, ["notebook", "link", "public"]),
    sql`exists (select 1 from ${artifactShares} s left join ${users} u on u.id = ${viewer.userId} where s.artifact_id = ${artifacts.id} and (s.user_id = ${viewer.userId} or (s.user_id is null and lower(s.email) = lower(u.email) and ${verifiedEmailRaw("u")})))`,
  );
  const rows = await db
    .select({
      artifact: artifacts,
      versionNo: artifactVersions.versionNo,
      creatorName: users.name,
    })
    .from(artifacts)
    .leftJoin(artifactVersions, eq(artifactVersions.id, artifacts.currentVersionId))
    .leftJoin(users, eq(users.id, artifacts.createdBy))
    .where(and(...conds, visible))
    .orderBy(desc(artifacts.createdAt));
  const isEditor = hasRole(viewer.role, "editor");
  return rows.map((r) => toArtifactDto(r, { canEdit: isEditor, canManage: isEditor }));
}

/* -------------------------------------------------------------------------- */
/* Phiên bản                                                                   */
/* -------------------------------------------------------------------------- */

function contentMdOf(type: ArtifactTypeName, title: string, content: unknown): string | null {
  try {
    return contentToMarkdown(type, title, content);
  } catch {
    return isMarkdownType(type) ? (content as MarkdownContent).markdown : null;
  }
}

/**
 * Thêm phiên bản mới (version_no + 1) và đặt làm hiện tại. Khoá hàng artifact trong giao dịch
 * để hai lần lưu đồng thời không đụng `version_no`.
 */
export async function addVersion(
  artifactId: string,
  input: { content: unknown; userId: string | null; note?: string | null; baseVersionId?: string | null; setStatusReady?: boolean },
  executor?: Executor,
): Promise<ArtifactVersionRow> {
  const run = async (tx: Executor) => {
    const locked = await tx.execute(sql`select id, type, title, current_version_id, deleted_at from artifacts where id = ${artifactId} for update`);
    const row = locked.rows[0] as { type: ArtifactTypeName; title: string; current_version_id: string | null; deleted_at: Date | null } | undefined;
    if (!row || row.deleted_at) throw ApiError.notFound("Không tìm thấy artifact");
    if (input.baseVersionId && row.current_version_id && input.baseVersionId !== row.current_version_id) {
      throw ApiError.conflict("Nội dung đã được người khác cập nhật. Hãy tải lại để xem phiên bản mới nhất.", "version_conflict");
    }
    const [{ next }] = (await tx.execute(
      sql`select coalesce(max(version_no), 0) + 1 as next from artifact_versions where artifact_id = ${artifactId}`,
    )).rows as Array<{ next: number }>;
    const [version] = await tx
      .insert(artifactVersions)
      .values({
        artifactId,
        versionNo: Number(next),
        content: input.content,
        contentMd: contentMdOf(row.type, row.title, input.content),
        createdBy: input.userId,
        note: input.note ?? null,
      })
      .returning();
    await tx
      .update(artifacts)
      .set({
        currentVersionId: version.id,
        updatedAt: new Date(),
        ...(input.setStatusReady ? { status: "ready" as const, error: null } : {}),
      })
      .where(eq(artifacts.id, artifactId));
    return version;
  };
  return executor ? run(executor) : db.transaction(run);
}

export async function listVersions(artifactId: string): Promise<ArtifactVersionDto[]> {
  const [art] = await db.select({ cur: artifacts.currentVersionId }).from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  const rows = await db
    .select({
      id: artifactVersions.id,
      artifactId: artifactVersions.artifactId,
      versionNo: artifactVersions.versionNo,
      note: artifactVersions.note,
      createdBy: artifactVersions.createdBy,
      createdByName: users.name,
      createdAt: artifactVersions.createdAt,
    })
    .from(artifactVersions)
    .leftJoin(users, eq(users.id, artifactVersions.createdBy))
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.versionNo));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), isCurrent: r.id === art?.cur }));
}

export async function getVersion(artifactId: string, versionId: string): Promise<ArtifactVersionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw ApiError.notFound("Không tìm thấy phiên bản");
  const [v] = await db
    .select()
    .from(artifactVersions)
    .where(and(eq(artifactVersions.id, versionId), eq(artifactVersions.artifactId, artifactId)))
    .limit(1);
  if (!v) throw ApiError.notFound("Không tìm thấy phiên bản");
  return v;
}

/** Khôi phục = tạo phiên bản MỚI mang nội dung của phiên bản cũ (lịch sử luôn tuyến tính, không mất gì). */
export async function restoreVersion(artifact: Artifact, versionId: string, userId: string): Promise<ArtifactVersionRow> {
  const old = await getVersion(artifact.id, versionId);
  return addVersion(artifact.id, {
    content: old.content,
    userId,
    note: t("studio.version.restoredNote", { n: old.versionNo }),
  });
}

/* -------------------------------------------------------------------------- */
/* Tạo / sửa / xoá                                                             */
/* -------------------------------------------------------------------------- */

function defaultTitle(type: ArtifactTypeName): string {
  return t(`artifact.${type}`);
}

async function notebookDefaultVisibility(notebookId: string): Promise<ArtifactVisibility> {
  const [nb] = await db
    .select({ v: notebooks.defaultArtifactVisibility })
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), isNull(notebooks.deletedAt)))
    .limit(1);
  return nb?.v ?? "notebook";
}

/**
 * Tạo artifact `queued` + xếp job `generate_artifact`.
 * Ném 501 nếu loại phụ thuộc engine chưa có; 400 `no_sources` nếu phạm vi không có nguồn `ready`.
 */
export async function createArtifact(params: {
  notebookId: string;
  userId: string;
  input: CreateArtifactInput;
}): Promise<Artifact> {
  const { notebookId, userId, input } = params;
  assertEngineAvailable(input.type);
  const sourceIds = await resolveScopeSourceIds(notebookId, userId, input.scope?.sourceIds);
  if (sourceIds.length === 0) {
    throw new ApiError(400, "no_sources", "Chưa có nguồn nào sẵn sàng trong phạm vi đã chọn. Hãy thêm hoặc chọn nguồn đã xử lý xong.");
  }
  const config: GenerationConfig = {
    customPrompt: input.customPrompt || undefined,
    options: input.options as Record<string, unknown> | undefined,
    scope: input.scope?.sourceIds?.length ? { sourceIds: input.scope.sourceIds } : undefined,
    model: input.model || undefined,
    titleAuto: !input.title,
  };
  // Phạm vi có nguồn riêng tư → artifact mặc định RIÊNG TƯ và bị đánh dấu (bất biến §3.4: không lộ nguồn riêng tư khi chia sẻ).
  const containsPrivateSources = (await privateSourceIdsAmong(sourceIds)).size > 0;
  const visibility = containsPrivateSources ? "private" : await notebookDefaultVisibility(notebookId);
  const [row] = await db
    .insert(artifacts)
    .values({
      notebookId,
      createdBy: userId,
      type: input.type,
      title: input.title ?? defaultTitle(input.type),
      status: "queued",
      visibility,
      containsPrivateSources,
      generationConfig: config as Record<string, unknown>,
    })
    .returning();
  const payload: GenerateArtifactPayload = { artifactId: row.id, notebookId, userId, reason: "create" };
  await enqueue("generate_artifact", payload);
  emitArtifactEvent(row, "created");
  return row;
}

export function privateSourcesConflict(): ApiError {
  return ApiError.conflict(
    "Phạm vi đã chọn có nguồn riêng tư nhưng artifact này đang được chia sẻ. Hãy chuyển artifact sang Riêng tư hoặc bỏ nguồn riêng tư khỏi phạm vi.",
    "private_sources_in_shared_artifact",
  );
}

/** Tạo lại: job mới, giữ nguyên lịch sử phiên bản (kết quả thành phiên bản mới). */
export async function regenerateArtifact(artifact: Artifact, userId: string, input: RegenerateArtifactInput): Promise<Artifact> {
  if (artifact.status === "queued" || artifact.status === "generating") {
    throw ApiError.conflict("Artifact đang được tạo", "already_generating");
  }
  assertEngineAvailable(artifact.type);
  const prev = configOf(artifact);
  const next: GenerationConfig = {
    ...prev,
    ...(input.customPrompt !== undefined ? { customPrompt: input.customPrompt || undefined } : {}),
    ...(input.options !== undefined ? { options: input.options as Record<string, unknown> } : {}),
    ...(input.scope !== undefined ? { scope: input.scope.sourceIds?.length ? { sourceIds: input.scope.sourceIds } : undefined } : {}),
    ...(input.model !== undefined ? { model: input.model || undefined } : {}),
  };
  const isPrivate = artifact.visibility === "private";
  const sourceIds = await resolveScopeSourceIds(artifact.notebookId, userId, next.scope?.sourceIds, { allowPrivate: isPrivate });
  if (!isPrivate && next.scope?.sourceIds?.length) {
    // Phạm vi chọn tay có nguồn riêng tư nhưng artifact đang chia sẻ → từ chối rõ ràng thay vì lặng lẽ bỏ nguồn.
    const withPrivate = await resolveScopeSourceIds(artifact.notebookId, userId, next.scope.sourceIds);
    if ((await privateSourceIdsAmong(withPrivate)).size > 0) throw privateSourcesConflict();
  }
  if (sourceIds.length === 0) {
    throw new ApiError(400, "no_sources", "Chưa có nguồn nào sẵn sàng trong phạm vi đã chọn.");
  }
  const [row] = await db
    .update(artifacts)
    .set({ status: "queued", error: null, generationConfig: next as Record<string, unknown>, updatedAt: new Date() })
    .where(and(eq(artifacts.id, artifact.id), isNull(artifacts.deletedAt)))
    .returning();
  if (!row) throw ApiError.notFound("Không tìm thấy artifact");
  const payload: GenerateArtifactPayload = { artifactId: row.id, notebookId: row.notebookId, userId, reason: "regenerate" };
  await enqueue("generate_artifact", payload);
  emitArtifactEvent(row, "updated");
  return row;
}

/** Sửa tiêu đề và/hoặc nội dung (nội dung → phiên bản mới). */
export async function updateArtifact(access: ArtifactAccess, userId: string, input: UpdateArtifactInput): Promise<{ artifact: Artifact; version: ArtifactVersionRow | null }> {
  const a = access.artifact;
  let version: ArtifactVersionRow | null = null;
  if (input.content !== undefined) {
    if (a.status === "queued" || a.status === "generating") {
      throw ApiError.conflict("Artifact đang được tạo, chưa thể sửa nội dung", "already_generating");
    }
    const parsed = contentSchemaFor(a.type).safeParse(input.content);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "validation_error",
        `Nội dung không hợp lệ: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "content"}: ${i.message}`).join("; ")}`,
        parsed.error.issues,
      );
    }
    version = await addVersion(a.id, {
      content: parsed.data,
      userId,
      note: input.note ?? t("studio.version.editedNote"),
      baseVersionId: input.baseVersionId ?? null,
    });
  }
  const patch: Partial<typeof artifacts.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) {
    patch.title = input.title;
    patch.generationConfig = { ...configOf(a), titleAuto: false } as Record<string, unknown>;
  }
  const [row] = await db.update(artifacts).set(patch).where(eq(artifacts.id, a.id)).returning();
  emitArtifactEvent(row, "updated");
  return { artifact: row, version };
}

/** Nhân bản: bản sao độc lập (phiên bản 1 = nội dung hiện tại), `forked_from_id` trỏ về bản gốc. */
export async function forkArtifact(artifact: Artifact, userId: string): Promise<Artifact> {
  if (!artifact.currentVersionId) throw ApiError.conflict("Artifact chưa có nội dung để nhân bản", "not_ready");
  const [cur] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, artifact.currentVersionId)).limit(1);
  if (!cur) throw ApiError.conflict("Artifact chưa có nội dung để nhân bản", "not_ready");
  // Bản sao của artifact chứa nguồn riêng tư cũng phải riêng tư.
  const visibility = artifact.containsPrivateSources ? "private" : await notebookDefaultVisibility(artifact.notebookId);
  const copy = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(artifacts)
      .values({
        notebookId: artifact.notebookId,
        createdBy: userId,
        type: artifact.type,
        title: t("studio.fork.title", { title: artifact.title }).slice(0, 200),
        status: "ready",
        visibility,
        containsPrivateSources: artifact.containsPrivateSources,
        generationConfig: { ...configOf(artifact), titleAuto: false } as Record<string, unknown>,
        forkedFromId: artifact.id,
      })
      .returning();
    await addVersion(row.id, { content: cur.content, userId, note: t("studio.version.forkedNote", { title: artifact.title }) }, tx);
    // Bản sao dùng cùng ảnh: ghi nhận phía server các tệp ảnh của bản gốc cho bản sao.
    await tx.execute(
      sql`insert into artifact_files (artifact_id, file_id) select ${row.id}, file_id from artifact_files where artifact_id = ${artifact.id} on conflict do nothing`,
    );
    const [fresh] = await tx.select().from(artifacts).where(eq(artifacts.id, row.id)).limit(1);
    return fresh;
  });
  emitArtifactEvent(copy, "created");
  return copy;
}

export async function deleteArtifact(artifact: Artifact): Promise<void> {
  const [row] = await db
    .update(artifacts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(artifacts.id, artifact.id))
    .returning();
  emitArtifactEvent(row ?? artifact, "deleted");
}

/* -------------------------------------------------------------------------- */
/* Chia sẻ                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Đặt visibility. `public` chỉ chủ sổ tay được đặt (ma trận docs/03). `link` sinh `share_token` nếu chưa có
 * (hoặc `rotate` để đổi token, vô hiệu hoá liên kết cũ).
 */
export async function setVisibility(
  artifact: Artifact,
  actor: { role: Role },
  visibility: ArtifactVisibility,
  opts: { rotateToken?: boolean } = {},
): Promise<Artifact> {
  if (visibility === "public" && actor.role !== "owner") {
    throw ApiError.forbidden("Chỉ chủ sở hữu sổ tay được chia sẻ công khai");
  }
  if (artifact.containsPrivateSources && visibility !== "private") {
    throw ApiError.conflict(
      "Artifact này được tạo từ nguồn riêng tư nên chỉ có thể ở chế độ Riêng tư. Hãy tạo lại từ các nguồn chia sẻ nếu muốn chia sẻ.",
      "private_sources_not_shareable",
    );
  }
  // Token chia sẻ: thu hồi khi rời khỏi link/public; luôn sinh token MỚI khi (lại) bật link để liên kết cũ không sống lại (M-2).
  const wasTokenVisible = artifact.visibility === "link" || artifact.visibility === "public";
  let token = artifact.shareToken;
  if (visibility === "private" || visibility === "notebook") token = null;
  else if (visibility === "link") token = opts.rotateToken || !wasTokenVisible || !token ? randomToken(24) : token;
  const [row] = await db
    .update(artifacts)
    .set({ visibility, shareToken: token, updatedAt: new Date() })
    .where(eq(artifacts.id, artifact.id))
    .returning();
  emitArtifactEvent(row, "updated");
  return row;
}

export async function listShares(artifactId: string): Promise<ArtifactShareDto[]> {
  const rows = await db
    .select({
      id: artifactShares.id,
      artifactId: artifactShares.artifactId,
      userId: artifactShares.userId,
      email: artifactShares.email,
      name: users.name,
      userEmail: users.email,
      role: artifactShares.role,
      createdAt: artifactShares.createdAt,
    })
    .from(artifactShares)
    .leftJoin(users, eq(users.id, artifactShares.userId))
    .where(eq(artifactShares.artifactId, artifactId))
    .orderBy(asc(artifactShares.createdAt));
  return rows.map((r) => ({
    id: r.id,
    artifactId: r.artifactId,
    userId: r.userId,
    email: r.email ?? r.userEmail,
    name: r.name,
    role: r.role,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Chia sẻ trực tiếp cho một người (theo userId hoặc email); đã có thì cập nhật vai trò. */
export async function addShare(artifactId: string, target: { userId?: string; email?: string; role: "view" | "edit" }): Promise<ArtifactShareDto> {
  let userId = target.userId ?? null;
  let email = target.email?.toLowerCase() ?? null;
  if (userId) {
    const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw ApiError.notFound("Không tìm thấy người dùng");
    email = u.email;
  } else if (email) {
    const [u] = await db
      .select({ id: users.id, verified: users.emailVerified })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    // Chỉ gắn thẳng vào tài khoản đã xác minh email; chưa có tài khoản / chưa xác minh → giữ email, chỉ khớp sau khi xác minh (H-4)
    userId = u && (u.verified || !emailVerificationRequired()) ? u.id : null;
  }
  const existing = await db
    .select()
    .from(artifactShares)
    .where(
      and(
        eq(artifactShares.artifactId, artifactId),
        userId ? eq(artifactShares.userId, userId) : sql`lower(${artifactShares.email}) = ${email}`,
      ),
    )
    .limit(1);
  let row;
  if (existing[0]) {
    [row] = await db.update(artifactShares).set({ role: target.role }).where(eq(artifactShares.id, existing[0].id)).returning();
  } else {
    [row] = await db.insert(artifactShares).values({ artifactId, userId, email, role: target.role }).returning();
  }
  const all = await listShares(artifactId);
  return all.find((s) => s.id === row.id)!;
}

export async function removeShare(artifactId: string, shareId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(shareId)) throw ApiError.notFound("Không tìm thấy lượt chia sẻ");
  const res = await db
    .delete(artifactShares)
    .where(and(eq(artifactShares.id, shareId), eq(artifactShares.artifactId, artifactId)))
    .returning({ id: artifactShares.id });
  if (res.length === 0) throw ApiError.notFound("Không tìm thấy lượt chia sẻ");
}

/** Tìm artifact theo share_token (chỉ khi visibility là link; public cũng truy cập bằng token nếu có). */
export async function findArtifactByToken(token: string): Promise<Artifact | null> {
  if (!token || token.length < 16) return null;
  const [row] = await db
    .select({ artifact: artifacts })
    .from(artifacts)
    .innerJoin(notebooks, and(eq(notebooks.id, artifacts.notebookId), isNull(notebooks.deletedAt)))
    .where(and(eq(artifacts.shareToken, token), isNull(artifacts.deletedAt)))
    .limit(1);
  return row?.artifact ?? null;
}
