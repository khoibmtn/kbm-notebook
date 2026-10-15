import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { hasRole, type Role } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { connectionSources, files, notebookConnections, sources, users, type NotebookConnection, type Source } from "@/server/db/schema";
import { decrypt, encrypt } from "@/server/crypto";
import { createSourceFromText } from "@/server/knowledge/sources";
import { NotebookLmBridgeProvider } from "@/server/knowledge/providers/notebooklm-bridge";
import { NotebookLmEnterpriseProvider } from "@/server/knowledge/providers/notebooklm-enterprise";
import type { Evidence } from "@/server/knowledge/providers/types";
import { getStorage } from "@/server/storage/local";
import {
  MAX_PUSH_TEXT_CHARS,
  externalNotebookUrl,
  type ConnectionDto,
  type ConnectionSourceDto,
  type ConnectorProvider,
  type ExternalNotebook,
  type ExternalSource,
} from "@/lib/connectors";
import type { SourceVisibility } from "@/lib/sources";
import { BridgeClient, type BridgeCredential } from "./bridge-client";
import { EnterpriseClient, type EnterpriseCredential, type EnterpriseDeps } from "./enterprise-client";
import { getBridgeCredential, getEnterpriseCredential } from "./settings";

/**
 * Kết nối ngoài của một sổ tay (`notebook_connections`).
 *
 * Mô hình tin cậy (docs/02 §3.4):
 * - Credential thuộc người tạo (`owner_user_id`). Khi tạo, credential hiện tại của họ được **chụp** (snapshot) vào
 *   `credential_enc` (AES-256-GCM) — kết nối vẫn chạy nếu sau đó người dùng đổi Cài đặt; chủ kết nối có thể "Cập nhật
 *   thông tin xác thực" để chụp lại (cần với access token Enterprise vì sống ngắn).
 * - Thành viên khác chỉ dùng được khi `shared_with_members = true`, và chỉ qua server. Credential KHÔNG BAO GIỜ nằm trong DTO.
 */

type StoredCredential =
  | { provider: "notebooklm-bridge"; bridge: BridgeCredential }
  | { provider: "notebooklm-enterprise"; enterprise: EnterpriseCredential };

const storedSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("notebooklm-bridge"),
    bridge: z.object({ url: z.string(), token: z.string(), allowPrivateHosts: z.boolean() }),
  }),
  z.object({
    provider: z.literal("notebooklm-enterprise"),
    enterprise: z.object({
      projectNumber: z.string(),
      location: z.enum(["global", "us", "eu"]),
      auth: z.discriminatedUnion("type", [
        z.object({ type: z.literal("access_token"), accessToken: z.string() }),
        z.object({ type: z.literal("service_account"), serviceAccountJson: z.string() }),
      ]),
    }),
  }),
]);

export type ConnectorDeps = { enterprise?: EnterpriseDeps };

export function supportsChat(provider: ConnectorProvider): boolean {
  return provider === "notebooklm-bridge";
}

function isChatProvider(provider: NotebookConnection["provider"]): provider is "notebooklm-bridge" {
  return provider === "notebooklm-bridge";
}

/* -------------------------------------------------------------------------- */
/* Credential                                                                  */
/* -------------------------------------------------------------------------- */

function sealCredential(c: StoredCredential): string {
  return encrypt(JSON.stringify(c));
}

function openCredential(row: Pick<NotebookConnection, "credentialEnc" | "provider">): StoredCredential {
  if (!row.credentialEnc) throw new ApiError(409, "connector_not_configured", "Kết nối này chưa có thông tin xác thực. Hãy xoá và tạo lại.");
  try {
    const parsed = storedSchema.safeParse(JSON.parse(decrypt(row.credentialEnc)));
    if (parsed.success && parsed.data.provider === row.provider) return parsed.data as StoredCredential;
  } catch {
    /* rơi xuống lỗi dưới */
  }
  throw new ApiError(409, "credential_unreadable", "Không đọc được thông tin xác thực của kết nối (khoá mã hoá đã đổi?). Chủ kết nối hãy chọn “Cập nhật thông tin xác thực”.");
}

function bridgeOf(row: NotebookConnection): BridgeClient {
  const c = openCredential(row);
  if (c.provider !== "notebooklm-bridge") throw new ApiError(400, "not_supported", "Thao tác này chỉ dành cho NotebookLM Bridge");
  return new BridgeClient(c.bridge);
}

function enterpriseOf(row: NotebookConnection, deps: ConnectorDeps = {}): EnterpriseClient {
  const c = openCredential(row);
  if (c.provider !== "notebooklm-enterprise") throw new ApiError(400, "not_supported", "Thao tác này chỉ dành cho NotebookLM Enterprise");
  return new EnterpriseClient(c.enterprise, deps.enterprise);
}

async function currentUserCredential(userId: string, provider: ConnectorProvider): Promise<StoredCredential> {
  if (provider === "notebooklm-bridge") {
    const bridge = await getBridgeCredential(userId);
    if (!bridge) {
      throw new ApiError(412, "connector_not_configured", "Bạn chưa cấu hình NotebookLM Bridge. Vào Cài đặt → Kết nối để nhập URL và token.");
    }
    return { provider, bridge };
  }
  const enterprise = await getEnterpriseCredential(userId);
  if (!enterprise) {
    throw new ApiError(412, "connector_not_configured", "Bạn chưa cấu hình NotebookLM Enterprise. Vào Cài đặt → Kết nối để nhập dự án và xác thực.");
  }
  return { provider, enterprise };
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toSourceDto(r: typeof connectionSources.$inferSelect): ConnectionSourceDto {
  return { id: r.id, externalSourceId: r.externalSourceId, title: r.title, kind: r.kind, syncedAt: r.syncedAt.toISOString() };
}

/**
 * Chuyển một dòng kết nối thành DTO **an toàn**: liệt kê tường minh từng trường — không spread `row`, nên `credentialEnc`
 * và `config` không bao giờ lọt ra ngoài.
 */
export function toConnectionDto(
  row: NotebookConnection,
  ctx: { ownerName: string | null; sources: (typeof connectionSources.$inferSelect)[]; viewer: { userId: string; role: Role } },
): ConnectionDto {
  const isMine = row.ownerUserId === ctx.viewer.userId;
  const usable = isMine || row.sharedWithMembers;
  const provider = row.provider as ConnectorProvider;
  return {
    id: row.id,
    notebookId: row.notebookId,
    provider,
    externalId: row.externalId,
    externalUrl: row.externalId ? externalNotebookUrl(provider, row.externalId) : null,
    label: row.label,
    status: row.status,
    // Lỗi có thể chứa chi tiết nhạy cảm của máy chủ riêng → chỉ người dùng được dùng kết nối mới thấy.
    lastError: usable ? row.lastError : row.lastError ? "Kết nối đang lỗi" : null,
    lastSyncedAt: iso(row.lastSyncedAt),
    createdAt: row.createdAt.toISOString(),
    ownerUserId: row.ownerUserId,
    ownerName: ctx.ownerName,
    isMine,
    sharedWithMembers: row.sharedWithMembers,
    usable,
    supportsChat: usable && isChatProvider(row.provider),
    canDelete: isMine || hasRole(ctx.viewer.role, "admin"),
    // Tên nguồn trong notebook cá nhân của người khác chỉ hiện khi họ chia sẻ kết nối.
    sourceCount: usable ? ctx.sources.length : 0,
    sources: usable ? ctx.sources.map(toSourceDto) : [],
  };
}

export async function listConnections(notebookId: string, viewer: { userId: string; role: Role }): Promise<ConnectionDto[]> {
  const rows = await db
    .select({ conn: notebookConnections, ownerName: users.name })
    .from(notebookConnections)
    .leftJoin(users, eq(users.id, notebookConnections.ownerUserId))
    .where(eq(notebookConnections.notebookId, notebookId))
    .orderBy(asc(notebookConnections.createdAt));
  if (rows.length === 0) return [];
  const srcRows = await db
    .select()
    .from(connectionSources)
    .where(inArray(connectionSources.connectionId, rows.map((r) => r.conn.id)))
    .orderBy(asc(connectionSources.title));
  const byConn = new Map<string, (typeof connectionSources.$inferSelect)[]>();
  for (const s of srcRows) {
    const list = byConn.get(s.connectionId) ?? [];
    list.push(s);
    byConn.set(s.connectionId, list);
  }
  return rows.map((r) => toConnectionDto(r.conn, { ownerName: r.ownerName, sources: byConn.get(r.conn.id) ?? [], viewer }));
}

async function loadDto(notebookId: string, connectionId: string, viewer: { userId: string; role: Role }): Promise<ConnectionDto> {
  const all = await listConnections(notebookId, viewer);
  const found = all.find((c) => c.id === connectionId);
  if (!found) throw ApiError.notFound("Không tìm thấy kết nối");
  return found;
}

/* -------------------------------------------------------------------------- */
/* Truy cập                                                                    */
/* -------------------------------------------------------------------------- */

export async function getConnectionOrThrow(notebookId: string, connectionId: string): Promise<NotebookConnection> {
  const [row] = await db
    .select()
    .from(notebookConnections)
    .where(and(eq(notebookConnections.id, connectionId), eq(notebookConnections.notebookId, notebookId)))
    .limit(1);
  if (!row) throw ApiError.notFound("Không tìm thấy kết nối");
  return row;
}

/** Kết nối dùng được: của chính mình, hoặc đã chia sẻ cho thành viên. Người khác → 403. */
export function assertCanUse(row: Pick<NotebookConnection, "ownerUserId" | "sharedWithMembers">, userId: string): void {
  if (row.ownerUserId !== userId && !row.sharedWithMembers) {
    throw new ApiError(403, "forbidden", "Kết nối này thuộc về người khác và chưa được chia sẻ với thành viên");
  }
}

async function setStatus(id: string, status: "ready" | "error", lastError: string | null): Promise<void> {
  await db.update(notebookConnections).set({ status, lastError }).where(eq(notebookConnections.id, id));
}

/** Chạy một lời gọi ra ngoài và ghi nhận trạng thái THẬT: thành công → `ready`; lỗi từ phía bên ngoài → `error` + thông báo. */
async function tracked<T>(row: Pick<NotebookConnection, "id" | "status" | "lastError">, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    if (row.status !== "ready" || row.lastError) await setStatus(row.id, "ready", null);
    return result;
  } catch (err) {
    if (err instanceof ApiError && (err.code === "connector_error" || err.code === "credential_unreadable")) {
      await setStatus(row.id, "error", err.message.slice(0, 500)).catch(() => undefined);
    }
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Tạo / đồng bộ / sửa / xoá                                                   */
/* -------------------------------------------------------------------------- */

type ExternalSnapshot = { title: string; sources: { id: string; title: string; kind: string | null; status: string | null; url?: string | null }[] };

async function fetchSnapshot(row: Pick<NotebookConnection, "provider" | "externalId" | "credentialEnc">, cred: StoredCredential, deps: ConnectorDeps): Promise<ExternalSnapshot> {
  if (!row.externalId) throw ApiError.badRequest("Kết nối thiếu ID notebook ngoài");
  if (cred.provider === "notebooklm-bridge") {
    const nb = await new BridgeClient(cred.bridge).getNotebook(row.externalId);
    return { title: nb.title, sources: nb.sources };
  }
  const nb = await new EnterpriseClient(cred.enterprise, deps.enterprise).getNotebook(row.externalId);
  return { title: nb.title, sources: nb.sources };
}

async function replaceSourceCache(connectionId: string, snap: ExternalSnapshot): Promise<void> {
  const ids = snap.sources.map((s) => s.id);
  await db.transaction(async (tx) => {
    if (ids.length === 0) {
      await tx.delete(connectionSources).where(eq(connectionSources.connectionId, connectionId));
    } else {
      await tx
        .delete(connectionSources)
        .where(and(eq(connectionSources.connectionId, connectionId), sql`${connectionSources.externalSourceId} NOT IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
      await tx
        .insert(connectionSources)
        .values(
          snap.sources.map((s) => ({
            connectionId,
            externalSourceId: s.id,
            title: s.title,
            kind: s.kind,
            metadata: { status: s.status, url: s.url ?? null },
            syncedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [connectionSources.connectionId, connectionSources.externalSourceId],
          set: {
            title: sql`excluded.title`,
            kind: sql`excluded.kind`,
            metadata: sql`excluded.metadata`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    }
  });
}

export type CreateConnectionInput = {
  provider: ConnectorProvider;
  externalId: string;
  label?: string;
  sharedWithMembers: boolean;
};

/**
 * Tạo kết nối: kiểm tra THẬT bằng cách gọi notebook ngoài bằng credential hiện tại của người tạo (Bridge `GET /notebooks/{id}`),
 * rồi chụp credential vào `credential_enc` và cache danh sách nguồn.
 */
export async function createConnection(
  input: { notebookId: string; userId: string; role: Role; data: CreateConnectionInput },
  deps: ConnectorDeps = {},
): Promise<ConnectionDto> {
  const { notebookId, userId, data } = input;
  const externalId = data.externalId.trim();
  const [dup] = await db
    .select({ id: notebookConnections.id })
    .from(notebookConnections)
    .where(
      and(
        eq(notebookConnections.notebookId, notebookId),
        eq(notebookConnections.ownerUserId, userId),
        eq(notebookConnections.provider, data.provider),
        eq(notebookConnections.externalId, externalId),
      ),
    )
    .limit(1);
  if (dup) throw ApiError.conflict("Bạn đã kết nối notebook này vào sổ tay rồi", "already_connected");

  const cred = await currentUserCredential(userId, data.provider);
  const snap = await fetchSnapshot({ provider: data.provider, externalId, credentialEnc: null }, cred, deps);

  const config: Record<string, unknown> = { externalTitle: snap.title };
  if (cred.provider === "notebooklm-enterprise") {
    config.projectNumber = cred.enterprise.projectNumber;
    config.location = cred.enterprise.location;
  }
  const [row] = await db
    .insert(notebookConnections)
    .values({
      notebookId,
      ownerUserId: userId,
      provider: data.provider,
      externalId,
      label: (data.label?.trim() || snap.title).slice(0, 120),
      config,
      credentialEnc: sealCredential(cred),
      sharedWithMembers: data.sharedWithMembers,
      status: "ready",
      lastError: null,
      lastSyncedAt: new Date(),
    })
    .returning();
  await replaceSourceCache(row.id, snap);
  return loadDto(notebookId, row.id, { userId, role: input.role });
}

/** Làm mới cache nguồn từ notebook ngoài. Cần dùng được kết nối + vai trò editor+. */
export async function syncConnection(
  input: { notebookId: string; connectionId: string; userId: string; role: Role },
  deps: ConnectorDeps = {},
): Promise<ConnectionDto> {
  const row = await getConnectionOrThrow(input.notebookId, input.connectionId);
  assertCanUse(row, input.userId);
  await tracked(row, async () => {
    const snap = await fetchSnapshot(row, openCredential(row), deps);
    await replaceSourceCache(row.id, snap);
    await db
      .update(notebookConnections)
      .set({ lastSyncedAt: new Date(), config: { ...row.config, externalTitle: snap.title } })
      .where(eq(notebookConnections.id, row.id));
  });
  return loadDto(input.notebookId, row.id, { userId: input.userId, role: input.role });
}

export type UpdateConnectionInput = { label?: string; sharedWithMembers?: boolean; refreshCredentials?: boolean };

/** Đổi nhãn (chủ kết nối hoặc admin+), bật/tắt chia sẻ và chụp lại credential (chỉ chủ kết nối). */
export async function updateConnection(
  input: { notebookId: string; connectionId: string; userId: string; role: Role; data: UpdateConnectionInput },
  deps: ConnectorDeps = {},
): Promise<ConnectionDto> {
  const row = await getConnectionOrThrow(input.notebookId, input.connectionId);
  const isOwner = row.ownerUserId === input.userId;
  const { data } = input;
  if ((data.sharedWithMembers !== undefined || data.refreshCredentials) && !isOwner) {
    throw new ApiError(403, "forbidden", "Chỉ người tạo kết nối mới được đổi chia sẻ hoặc cập nhật thông tin xác thực");
  }
  if (data.label !== undefined && !isOwner && !hasRole(input.role, "admin")) throw ApiError.forbidden();

  const patch: Partial<typeof notebookConnections.$inferInsert> = {};
  if (data.label !== undefined) patch.label = data.label.trim().slice(0, 120);
  if (data.sharedWithMembers !== undefined) patch.sharedWithMembers = data.sharedWithMembers;
  if (data.refreshCredentials) {
    const cred = await currentUserCredential(input.userId, row.provider as ConnectorProvider);
    // Kiểm tra credential mới bằng một lời gọi thật trước khi thay.
    const snap = await fetchSnapshot(row, cred, deps);
    patch.credentialEnc = sealCredential(cred);
    patch.status = "ready";
    patch.lastError = null;
    patch.lastSyncedAt = new Date();
    await replaceSourceCache(row.id, snap);
  }
  if (Object.keys(patch).length > 0) await db.update(notebookConnections).set(patch).where(eq(notebookConnections.id, row.id));
  return loadDto(input.notebookId, row.id, { userId: input.userId, role: input.role });
}

/** Xoá kết nối: người tạo hoặc admin+. */
export async function deleteConnection(input: { notebookId: string; connectionId: string; userId: string; role: Role }): Promise<void> {
  const row = await getConnectionOrThrow(input.notebookId, input.connectionId);
  if (row.ownerUserId !== input.userId && !hasRole(input.role, "admin")) throw ApiError.forbidden();
  await db.delete(notebookConnections).where(eq(notebookConnections.id, row.id));
}

/* -------------------------------------------------------------------------- */
/* Nguồn bên ngoài (trực tiếp)                                                 */
/* -------------------------------------------------------------------------- */

/** Danh sách nguồn HIỆN TẠI trong notebook ngoài (không dùng cache) — cho hộp thoại nhập nguồn. */
export async function listExternalSources(
  input: { notebookId: string; connectionId: string; userId: string },
  deps: ConnectorDeps = {},
): Promise<ExternalSource[]> {
  const row = await getConnectionOrThrow(input.notebookId, input.connectionId);
  assertCanUse(row, input.userId);
  if (!row.externalId) throw ApiError.badRequest("Kết nối thiếu ID notebook ngoài");
  const externalId = row.externalId;
  return tracked(row, async () => {
    if (row.provider === "notebooklm-bridge") {
      return (await bridgeOf(row).listSources(externalId)).map((s) => ({ id: s.id, title: s.title, kind: s.kind, status: s.status, url: s.url }));
    }
    return (await enterpriseOf(row, deps).getNotebook(externalId)).sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind, status: s.status, url: null }));
  });
}

/* -------------------------------------------------------------------------- */
/* Hỏi đáp                                                                     */
/* -------------------------------------------------------------------------- */

export type ChatConnections = {
  providers: NotebookLmBridgeProvider[];
  /** Có kết nối được yêu cầu nhưng không dùng được cho hỏi đáp (không tồn tại trong sổ tay / provider không có chat). */
  skipped: number;
};

/**
 * Chốt các kết nối dùng cho một câu hỏi.
 * - `id` không thuộc sổ tay → bỏ qua (tính vào `skipped`).
 * - Kết nối của người khác chưa chia sẻ → **403**.
 * - Provider không có chat (Enterprise) → bỏ qua (tính vào `skipped`).
 */
export async function resolveChatConnections(input: { notebookId: string; userId: string; connectionIds: string[] }): Promise<ChatConnections> {
  const ids = [...new Set(input.connectionIds)];
  if (ids.length === 0) return { providers: [], skipped: 0 };
  const validIds = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const rows = validIds.length
    ? await db
        .select()
        .from(notebookConnections)
        .where(and(eq(notebookConnections.notebookId, input.notebookId), inArray(notebookConnections.id, validIds)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const providers: NotebookLmBridgeProvider[] = [];
  let skipped = 0;
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      skipped++;
      continue;
    }
    assertCanUse(row, input.userId);
    if (!isChatProvider(row.provider) || !row.externalId) {
      skipped++;
      continue;
    }
    const cached = await db.select({ id: connectionSources.externalSourceId, title: connectionSources.title }).from(connectionSources).where(eq(connectionSources.connectionId, row.id));
    providers.push(
      new NotebookLmBridgeProvider(
        { connectionId: row.id, externalId: row.externalId, label: row.label, sourceTitles: new Map(cached.map((c) => [c.id, c.title])) },
        bridgeOf(row),
      ),
    );
  }
  return { providers, skipped };
}

export type ConnectionRetrieval = {
  evidence: Evidence[];
  errors: { connectionId: string; label: string; message: string }[];
};

/**
 * Truy hồi song song trên các kết nối. Lỗi của từng kết nối được thu lại (và ghi `status='error'`) thay vì làm hỏng cả câu hỏi;
 * bằng chứng giữ thứ tự theo thứ tự `connectionIds`.
 */
export async function retrieveFromConnections(
  providers: NotebookLmBridgeProvider[],
  q: { query: string; notebookId: string; userId: string },
): Promise<ConnectionRetrieval> {
  const settled = await Promise.all(
    providers.map(async (p) => {
      try {
        const evidence = await p.retrieve({ ...q, topK: 12 });
        await db
          .update(notebookConnections)
          .set({ status: "ready", lastError: null })
          .where(and(eq(notebookConnections.id, p.connectionId), sql`(${notebookConnections.status} <> 'ready' OR ${notebookConnections.lastError} IS NOT NULL)`));
        return { evidence, error: null as string | null };
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Lỗi không xác định khi truy vấn kết nối";
        if (err instanceof ApiError && err.code === "connector_error") {
          await setStatus(p.connectionId, "error", message.slice(0, 500)).catch(() => undefined);
        } else if (!(err instanceof ApiError)) {
          console.error("[connectors] retrieve failed", err);
        }
        return { evidence: [] as Evidence[], error: message };
      }
    }),
  );
  const errors: ConnectionRetrieval["errors"] = [];
  settled.forEach((r, i) => {
    if (r.error) errors.push({ connectionId: providers[i].connectionId, label: providers[i].label, message: r.error });
  });
  return { evidence: settled.flatMap((r) => r.evidence), errors };
}

/* -------------------------------------------------------------------------- */
/* Ghi ngược sang NotebookLM                                                   */
/* -------------------------------------------------------------------------- */

function clip(text: string): string {
  return text.length > MAX_PUSH_TEXT_CHARS ? `${text.slice(0, MAX_PUSH_TEXT_CHARS)}\n\n[…đã cắt bớt]` : text;
}

/** Tạo ghi chú trong notebook ngoài (chỉ Bridge: Enterprise API không có ghi chú). */
export async function pushNote(
  input: { notebookId: string; connectionId: string; userId: string; title: string; content: string },
): Promise<{ externalNoteId: string; title: string }> {
  const row = await getConnectionOrThrow(input.notebookId, input.connectionId);
  assertCanUse(row, input.userId);
  if (row.provider !== "notebooklm-bridge" || !row.externalId) {
    throw new ApiError(501, "not_supported", "NotebookLM Enterprise API không hỗ trợ tạo ghi chú — hãy dùng kết nối NotebookLM Bridge");
  }
  const externalId = row.externalId;
  const note = await tracked(row, () => bridgeOf(row).createNote(externalId, input.title.trim().slice(0, 500) || "Ghi chú từ KBM Notebook", clip(input.content)));
  return { externalNoteId: note.id, title: note.title };
}

/** Đẩy một nguồn cục bộ sang notebook ngoài: text → add text; url → add url; tệp → upload (Bridge). Enterprise: text/url. */
export async function pushSource(
  input: { notebookId: string; connectionId: string; userId: string; sourceId: string },
  deps: ConnectorDeps = {},
): Promise<{ externalSourceId: string | null; title: string; status: string | null }> {
  const row = await getConnectionOrThrow(input.notebookId, input.connectionId);
  assertCanUse(row, input.userId);
  if (!row.externalId) throw ApiError.badRequest("Kết nối thiếu ID notebook ngoài");
  const externalId = row.externalId;

  const [src] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, input.sourceId), eq(sources.notebookId, input.notebookId), isNull(sources.deletedAt)))
    .limit(1);
  if (!src || (src.visibility === "private" && src.createdBy !== input.userId)) throw ApiError.notFound("Không tìm thấy nguồn");

  const plan = await planPush(src);
  if (row.provider === "notebooklm-enterprise") {
    if (plan.type === "file") throw new ApiError(501, "not_supported", "NotebookLM Enterprise chưa hỗ trợ đẩy tệp từ đây (chỉ văn bản và URL)");
    await tracked(row, () =>
      enterpriseOf(row, deps).addSources(externalId, [plan.type === "text" ? { kind: "text", title: plan.title, content: plan.text } : { kind: "web", title: plan.title, url: plan.url }]),
    );
    return { externalSourceId: null, title: plan.title, status: null };
  }
  const client = bridgeOf(row);
  const out = await tracked(row, async () => {
    if (plan.type === "text") return client.addTextSource(externalId, plan.title, plan.text);
    if (plan.type === "url") return client.addUrlSource(externalId, plan.url, plan.title);
    return client.addFileSource(externalId, plan.file, plan.title);
  });
  return { externalSourceId: out.id, title: out.title, status: out.status };
}

type PushPlan =
  | { type: "text"; title: string; text: string }
  | { type: "url"; title: string; url: string }
  | { type: "file"; title: string; file: { name: string; mime: string; data: Buffer } };

async function planPush(src: Source): Promise<PushPlan> {
  if (src.kind === "url") {
    if (!src.url) throw ApiError.badRequest("Nguồn URL không có địa chỉ");
    return { type: "url", title: src.title, url: src.url };
  }
  if (src.kind === "youtube") {
    if (!src.url) throw ApiError.badRequest("Nguồn YouTube không có địa chỉ");
    return { type: "url", title: src.title, url: src.url };
  }
  if (src.kind === "text") {
    const text = src.rawText?.trim();
    if (!text) throw ApiError.badRequest("Nguồn văn bản trống");
    return { type: "text", title: src.title, text: clip(text) };
  }
  if (src.fileId) {
    const [file] = await db.select().from(files).where(eq(files.id, src.fileId)).limit(1);
    if (!file) throw new ApiError(409, "conflict", "Tệp gốc không còn tồn tại");
    const chunks: Buffer[] = [];
    for await (const c of await getStorage().getStream(file.storageKey)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return { type: "file", title: src.title, file: { name: file.originalName, mime: file.mime, data: Buffer.concat(chunks) } };
  }
  throw ApiError.badRequest("Loại nguồn này chưa thể đẩy sang NotebookLM");
}

/* -------------------------------------------------------------------------- */
/* Nhập nguồn từ NotebookLM                                                    */
/* -------------------------------------------------------------------------- */

export type ImportFromConnectionResult = {
  imported: { externalSourceId: string; sourceId: string; title: string }[];
  failed: { externalSourceId: string; message: string }[];
};

/**
 * Nhập nguồn từ notebook NotebookLM (Bridge) thành nguồn `text` cục bộ + job `ingest_source`, dùng văn bản đầy đủ do bridge xuất
 * (`GET /notebooks/{id}/sources/{sid}/fulltext`). Bridge cũ chưa có endpoint → 501 `bridge_fulltext_unsupported`.
 */
export async function importFromConnection(input: {
  notebookId: string;
  connectionId: string;
  userId: string;
  externalSourceIds: string[];
  visibility: SourceVisibility;
}): Promise<ImportFromConnectionResult> {
  const row = await getConnectionOrThrow(input.notebookId, input.connectionId);
  assertCanUse(row, input.userId);
  if (row.provider !== "notebooklm-bridge" || !row.externalId) {
    throw new ApiError(501, "not_supported", "Chỉ NotebookLM Bridge hỗ trợ nhập nguồn (Enterprise API không có endpoint xuất nội dung nguồn)");
  }
  const externalId = row.externalId;
  const client = bridgeOf(row);
  const result: ImportFromConnectionResult = { imported: [], failed: [] };
  for (const sid of [...new Set(input.externalSourceIds)]) {
    try {
      const ft = await tracked(row, () => client.getSourceFulltext(externalId, sid));
      const text = ft.text.trim();
      if (!text) {
        result.failed.push({ externalSourceId: sid, message: "Nguồn không có văn bản (NotebookLM chưa xử lý xong hoặc nguồn rỗng)" });
        continue;
      }
      const created = await createSourceFromText({
        notebookId: input.notebookId,
        userId: input.userId,
        title: ft.title?.trim() || "Nguồn từ NotebookLM",
        text,
        visibility: input.visibility,
        metadata: { importedFrom: { provider: row.provider, connectionId: row.id, externalNotebookId: externalId, externalSourceId: sid, url: ft.url } },
      });
      result.imported.push({ externalSourceId: sid, sourceId: created.id, title: created.title });
    } catch (err) {
      if (err instanceof ApiError && err.code === "bridge_fulltext_unsupported") throw err;
      result.failed.push({ externalSourceId: sid, message: err instanceof Error ? err.message : "Lỗi không xác định" });
    }
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Cấp người dùng: kiểm tra + liệt kê notebook ngoài                            */
/* -------------------------------------------------------------------------- */

export function externalNotebookFromBridge(n: { id: string; title: string; sourceCount: number | null; updatedAt: string | null }): ExternalNotebook {
  return { id: n.id, title: n.title, sourceCount: n.sourceCount, updatedAt: n.updatedAt };
}

export function createEnterpriseProviderFor(cred: EnterpriseCredential, deps: ConnectorDeps = {}, externalId?: string): NotebookLmEnterpriseProvider {
  return new NotebookLmEnterpriseProvider(new EnterpriseClient(cred, deps.enterprise), externalId);
}
