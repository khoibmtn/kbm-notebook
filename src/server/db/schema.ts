import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { SourceUsed } from "@/lib/chat";
import type { Evidence } from "@/server/knowledge/providers/types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "editor", "viewer"]);
export const artifactVisibilityEnum = pgEnum("artifact_visibility", [
  "private",
  "notebook",
  "link",
  "public",
]);
export const sourceKindEnum = pgEnum("source_kind", [
  "file",
  "url",
  "text",
  "youtube",
  "drive",
  "chat_attachment",
]);
export const contentVisibilityEnum = pgEnum("content_visibility", ["shared", "private"]);
export const sourceStatusEnum = pgEnum("source_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);
export const connectionProviderEnum = pgEnum("connection_provider", [
  "notebooklm-bridge",
  "notebooklm-enterprise",
  "google-drive",
]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "unconfigured",
  "ready",
  "error",
]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
export const noteOriginEnum = pgEnum("note_origin", ["manual", "chat", "team_chat", "artifact"]);
export const artifactTypeEnum = pgEnum("artifact_type", [
  "note",
  "report",
  "study_guide",
  "faq",
  "timeline",
  "mindmap",
  "slide_deck",
  "infographic",
  "quiz",
  "flashcards",
  "data_table",
]);
export const artifactStatusEnum = pgEnum("artifact_status", [
  "queued",
  "generating",
  "ready",
  "failed",
]);
export const exportFormatEnum = pgEnum("export_format", [
  "pptx",
  "docx",
  "pdf",
  "png",
  "svg",
  "csv",
  "md",
  "json",
  "apkg_tsv",
]);
export const shareRoleEnum = pgEnum("share_role", ["view", "edit"]);
export const channelTypeEnum = pgEnum("channel_type", ["general", "topic", "dm"]);
export const teamMessageKindEnum = pgEnum("team_message_kind", [
  "text",
  "file",
  "artifact_ref",
  "source_ref",
  "note_ref",
  "system",
]);
export const groupVisibilityEnum = pgEnum("group_visibility", ["private", "public"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "done", "failed"]);

/* -------------------------------------------------------------------------- */
/* Auth (better-auth quản lý bốn bảng đầu)                                     */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable("verifications", {
  id: id(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  title: text("title"),
  bio: text("bio"),
  locale: text("locale").default("vi").notNull(),
  theme: text("theme").default("system").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export type PromptOverride = { system?: string; user?: string; options?: Record<string, unknown> };

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  geminiApiKeyEnc: text("gemini_api_key_enc"),
  /** JSON (AES-256-GCM) cấu hình kết nối ngoài của người dùng: NotebookLM Bridge (URL + token) và Enterprise (dự án + xác thực). Không bao giờ trả về client. */
  connectorsEnc: text("connectors_enc"),
  defaultChatModel: text("default_chat_model"),
  defaultArtifactModel: text("default_artifact_model"),
  embeddingModel: text("embedding_model").default("gemini-embedding-001").notNull(),
  embeddingDim: integer("embedding_dim").default(768).notNull(),
  notifyEmail: boolean("notify_email").default(true).notNull(),
  prompts: jsonb("prompts").$type<Record<string, PromptOverride>>().default({}).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/* -------------------------------------------------------------------------- */
/* Notebook & thành viên                                                       */
/* -------------------------------------------------------------------------- */

export const notebooks = pgTable(
  "notebooks",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    emoji: text("emoji"),
    coverColor: text("cover_color"),
    systemInstruction: text("system_instruction"),
    allowWeb: boolean("allow_web").default(false).notNull(),
    defaultArtifactVisibility: artifactVisibilityEnum("default_artifact_visibility")
      .default("notebook")
      .notNull(),
    isPublic: boolean("is_public").default(false).notNull(),
    publicSlug: text("public_slug").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("notebooks_owner_idx").on(t.ownerId),
    index("notebooks_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

export const notebookMembers = pgTable(
  "notebook_members",
  {
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.notebookId, t.userId] }),
    index("notebook_members_user_idx").on(t.userId),
  ],
);

export const notebookInvites = pgTable(
  "notebook_invites",
  {
    id: id(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull(),
    token: text("token").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notebook_invites_notebook_idx").on(t.notebookId, t.email)],
);

/* -------------------------------------------------------------------------- */
/* Tệp & nguồn tri thức                                                        */
/* -------------------------------------------------------------------------- */

export const files = pgTable(
  "files",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("files_owner_idx").on(t.ownerId)],
);

export const sources = pgTable(
  "sources",
  {
    id: id(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    kind: sourceKindEnum("kind").notNull(),
    title: text("title").notNull(),
    mime: text("mime"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    url: text("url"),
    rawText: text("raw_text"),
    visibility: contentVisibilityEnum("visibility").default("shared").notNull(),
    status: sourceStatusEnum("status").default("pending").notNull(),
    error: text("error"),
    pageCount: integer("page_count"),
    tokenCount: integer("token_count"),
    summary: text("summary"),
    keyTopics: jsonb("key_topics").$type<string[]>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("sources_notebook_idx").on(t.notebookId),
    index("sources_file_idx").on(t.fileId),
    index("sources_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    page: integer("page"),
    section: text("section"),
    startChar: integer("start_char").notNull().default(0),
    endChar: integer("end_char").notNull().default(0),
    embedding: vector("embedding", { dimensions: 768 }),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('simple', "text")`),
  },
  (t) => [
    index("source_chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("source_chunks_tsv_gin").using("gin", t.tsv),
    index("source_chunks_notebook_source_idx").on(t.notebookId, t.sourceId),
    uniqueIndex("source_chunks_source_idx_uq").on(t.sourceId, t.idx),
  ],
);

export const notebookConnections = pgTable(
  "notebook_connections",
  {
    id: id(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: connectionProviderEnum("provider").notNull(),
    externalId: text("external_id"),
    label: text("label").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
    credentialEnc: text("credential_enc"),
    sharedWithMembers: boolean("shared_with_members").default(false).notNull(),
    status: connectionStatusEnum("status").default("unconfigured").notNull(),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notebook_connections_notebook_idx").on(t.notebookId)],
);

export const connectionSources = pgTable(
  "connection_sources",
  {
    id: id(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => notebookConnections.id, { onDelete: "cascade" }),
    externalSourceId: text("external_source_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("connection_sources_uq").on(t.connectionId, t.externalSourceId)],
);

/* -------------------------------------------------------------------------- */
/* Chat AI                                                                    */
/* -------------------------------------------------------------------------- */

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_notebook_user_idx").on(t.notebookId, t.userId)],
);

export type MessageScope = { sourceIds?: string[]; connectionIds?: string[]; useWeb?: boolean };

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<Evidence[]>(),
    sourcesUsed: jsonb("sources_used").$type<SourceUsed[]>(),
    insufficientEvidence: boolean("insufficient_evidence").default(false).notNull(),
    scope: jsonb("scope").$type<MessageScope>(),
    model: text("model"),
    usage: jsonb("usage").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
/* -------------------------------------------------------------------------- */

export const notes = pgTable(
  "notes",
  {
    id: id(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    contentMd: text("content_md").default("").notNull(),
    contentJson: jsonb("content_json").$type<unknown>(),
    origin: noteOriginEnum("origin").default("manual").notNull(),
    originRef: jsonb("origin_ref").$type<Record<string, unknown>>(),
    visibility: contentVisibilityEnum("visibility").default("shared").notNull(),
    isSource: boolean("is_source").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("notes_notebook_idx").on(t.notebookId)],
);

export const savedExchanges = pgTable("saved_exchanges", {
  id: id(),
  notebookId: uuid("notebook_id")
    .notNull()
    .references(() => notebooks.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  questionMessageId: uuid("question_message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  answerMessageId: uuid("answer_message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/* -------------------------------------------------------------------------- */
/* Studio / Artifact                                                          */
/* -------------------------------------------------------------------------- */

export const artifacts = pgTable(
  "artifacts",
  {
    id: id(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    type: artifactTypeEnum("type").notNull(),
    title: text("title").notNull(),
    status: artifactStatusEnum("status").default("queued").notNull(),
    error: text("error"),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => artifactVersions.id, {
      onDelete: "set null",
    }),
    visibility: artifactVisibilityEnum("visibility").default("notebook").notNull(),
    shareToken: text("share_token").unique(),
    generationConfig: jsonb("generation_config").$type<Record<string, unknown>>(),
    forkedFromId: uuid("forked_from_id").references((): AnyPgColumn => artifacts.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("artifacts_notebook_idx").on(t.notebookId)],
);

export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id: id(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references((): AnyPgColumn => artifacts.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    contentMd: text("content_md"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("artifact_versions_no_uq").on(t.artifactId, t.versionNo)],
);

export const artifactExports = pgTable("artifact_exports", {
  id: id(),
  artifactId: uuid("artifact_id")
    .notNull()
    .references(() => artifacts.id, { onDelete: "cascade" }),
  versionId: uuid("version_id")
    .notNull()
    .references(() => artifactVersions.id, { onDelete: "cascade" }),
  format: exportFormatEnum("format").notNull(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id),
  createdAt: createdAt(),
});

export const artifactShares = pgTable(
  "artifact_shares",
  {
    id: id(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    email: text("email"),
    role: shareRoleEnum("role").default("view").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("artifact_shares_artifact_idx").on(t.artifactId)],
);

/* -------------------------------------------------------------------------- */
/* Chat cộng tác                                                              */
/* -------------------------------------------------------------------------- */

export const channels = pgTable(
  "channels",
  {
    id: id(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    type: channelTypeEnum("type").notNull(),
    name: text("name"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("channels_notebook_idx").on(t.notebookId),
    // mỗi notebook đúng một kênh general
    uniqueIndex("channels_general_uq").on(t.notebookId).where(sql`${t.type} = 'general'`),
  ],
);

export const channelMembers = pgTable(
  "channel_members",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadMessageId: uuid("last_read_message_id"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    muted: boolean("muted").default(false).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index("channel_members_user_idx").on(t.userId),
  ],
);

export type TeamMessageContentJson = {
  mentions?: string[];
  attachments?: { fileId: string; name: string; mime: string; size: number }[];
  refs?: { type: "artifact" | "source" | "note"; id: string; title?: string }[];
};

export const teamMessages = pgTable(
  "team_messages",
  {
    id: id(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id),
    kind: teamMessageKindEnum("kind").default("text").notNull(),
    content: text("content").default("").notNull(),
    contentJson: jsonb("content_json").$type<TeamMessageContentJson>(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => teamMessages.id, {
      onDelete: "set null",
    }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: deletedAt(),
    recalledAt: timestamp("recalled_at", { withTimezone: true }),
    pinned: boolean("pinned").default(false).notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('simple', "content")`),
    createdAt: createdAt(),
  },
  (t) => [
    index("team_messages_channel_idx").on(t.channelId, t.createdAt),
    index("team_messages_tsv_gin").using("gin", t.tsv),
  ],
);

export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => teamMessages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: id(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => teamMessages.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
  },
  (t) => [index("message_attachments_message_idx").on(t.messageId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Community                                                                  */
/* -------------------------------------------------------------------------- */

export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  visibility: groupVisibilityEnum("visibility").default("private").notNull(),
  createdAt: createdAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").default("viewer").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const groupNotebooks = pgTable(
  "group_notebooks",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.notebookId] })],
);

export const artifactLikes = pgTable(
  "artifact_likes",
  {
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.artifactId, t.userId] })],
);

export const artifactComments = pgTable(
  "artifact_comments",
  {
    id: id(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("artifact_comments_artifact_idx").on(t.artifactId)],
);

/* -------------------------------------------------------------------------- */
/* Hạ tầng                                                                     */
/* -------------------------------------------------------------------------- */

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<unknown>().default({}).notNull(),
    status: jobStatusEnum("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    progress: integer("progress").default(0).notNull(),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_poll_idx").on(t.status, t.runAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").default(0).notNull(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_user_idx").on(t.userId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Kiểu suy ra                                                                 */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type Notebook = typeof notebooks.$inferSelect;
export type NotebookMember = typeof notebookMembers.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersions.$inferSelect;
export type ArtifactExportRow = typeof artifactExports.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Role = (typeof memberRoleEnum.enumValues)[number];
export type NotebookConnection = typeof notebookConnections.$inferSelect;
export type ConnectionSource = typeof connectionSources.$inferSelect;
