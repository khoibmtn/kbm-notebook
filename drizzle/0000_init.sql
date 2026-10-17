CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."artifact_status" AS ENUM('queued', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('note', 'report', 'study_guide', 'faq', 'timeline', 'mindmap', 'slide_deck', 'infographic', 'quiz', 'flashcards', 'data_table');--> statement-breakpoint
CREATE TYPE "public"."artifact_visibility" AS ENUM('private', 'notebook', 'link', 'public');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('general', 'topic', 'dm');--> statement-breakpoint
CREATE TYPE "public"."connection_provider" AS ENUM('notebooklm-bridge', 'notebooklm-enterprise', 'google-drive');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('unconfigured', 'ready', 'error');--> statement-breakpoint
CREATE TYPE "public"."content_visibility" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('pptx', 'docx', 'pdf', 'png', 'svg', 'csv', 'md', 'json', 'apkg_tsv');--> statement-breakpoint
CREATE TYPE "public"."group_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."note_origin" AS ENUM('manual', 'chat', 'team_chat', 'artifact');--> statement-breakpoint
CREATE TYPE "public"."share_role" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('file', 'url', 'text', 'youtube', 'drive', 'chat_attachment');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."team_message_kind" AS ENUM('text', 'file', 'artifact_ref', 'source_ref', 'note_ref', 'system');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"format" "export_format" NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_likes" (
	"artifact_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_likes_artifact_id_user_id_pk" PRIMARY KEY("artifact_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "artifact_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text,
	"role" "share_role" DEFAULT 'view' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_md" text,
	"created_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"type" "artifact_type" NOT NULL,
	"title" text NOT NULL,
	"status" "artifact_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"current_version_id" uuid,
	"visibility" "artifact_visibility" DEFAULT 'notebook' NOT NULL,
	"share_token" text,
	"generation_config" jsonb,
	"forked_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "artifacts_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_members" (
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "channel_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"type" "channel_type" NOT NULL,
	"name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_source_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_notebooks" (
	"group_id" uuid NOT NULL,
	"notebook_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_notebooks_group_id_notebook_id_pk" PRIMARY KEY("group_id","notebook_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"visibility" "group_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb,
	"sources_used" jsonb,
	"insufficient_evidence" boolean DEFAULT false NOT NULL,
	"scope" jsonb,
	"model" text,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notebook_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider" "connection_provider" NOT NULL,
	"external_id" text,
	"label" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_enc" text,
	"shared_with_members" boolean DEFAULT false NOT NULL,
	"status" "connection_status" DEFAULT 'unconfigured' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notebook_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notebook_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "notebook_members" (
	"notebook_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notebook_members_notebook_id_user_id_pk" PRIMARY KEY("notebook_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notebooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"emoji" text,
	"cover_color" text,
	"system_instruction" text,
	"allow_web" boolean DEFAULT false NOT NULL,
	"default_artifact_visibility" "artifact_visibility" DEFAULT 'notebook' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "notebooks_public_slug_unique" UNIQUE("public_slug")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"content_json" jsonb,
	"origin" "note_origin" DEFAULT 'manual' NOT NULL,
	"origin_ref" jsonb,
	"visibility" "content_visibility" DEFAULT 'shared' NOT NULL,
	"is_source" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question_message_id" uuid NOT NULL,
	"answer_message_id" uuid NOT NULL,
	"note_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"notebook_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"text" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"page" integer,
	"section" text,
	"start_char" integer DEFAULT 0 NOT NULL,
	"end_char" integer DEFAULT 0 NOT NULL,
	"embedding" vector(768),
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"title" text NOT NULL,
	"mime" text,
	"file_id" uuid,
	"url" text,
	"raw_text" text,
	"visibility" "content_visibility" DEFAULT 'shared' NOT NULL,
	"status" "source_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"page_count" integer,
	"token_count" integer,
	"summary" text,
	"key_topics" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"kind" "team_message_kind" DEFAULT 'text' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"content_json" jsonb,
	"reply_to_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"recalled_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"title" text,
	"bio" text,
	"locale" text DEFAULT 'vi' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"gemini_api_key_enc" text,
	"default_chat_model" text,
	"default_artifact_model" text,
	"embedding_model" text DEFAULT 'gemini-embedding-001' NOT NULL,
	"embedding_dim" integer DEFAULT 768 NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"prompts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_exports" ADD CONSTRAINT "artifact_exports_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_exports" ADD CONSTRAINT "artifact_exports_version_id_artifact_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_exports" ADD CONSTRAINT "artifact_exports_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_likes" ADD CONSTRAINT "artifact_likes_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_likes" ADD CONSTRAINT "artifact_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_shares" ADD CONSTRAINT "artifact_shares_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_shares" ADD CONSTRAINT "artifact_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_current_version_id_artifact_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_forked_from_id_artifacts_id_fk" FOREIGN KEY ("forked_from_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_sources" ADD CONSTRAINT "connection_sources_connection_id_notebook_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."notebook_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_notebooks" ADD CONSTRAINT "group_notebooks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_notebooks" ADD CONSTRAINT "group_notebooks_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_team_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."team_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_team_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."team_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_connections" ADD CONSTRAINT "notebook_connections_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_connections" ADD CONSTRAINT "notebook_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_invites" ADD CONSTRAINT "notebook_invites_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_invites" ADD CONSTRAINT "notebook_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_members" ADD CONSTRAINT "notebook_members_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_members" ADD CONSTRAINT "notebook_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_members" ADD CONSTRAINT "notebook_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebooks" ADD CONSTRAINT "notebooks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_exchanges" ADD CONSTRAINT "saved_exchanges_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_exchanges" ADD CONSTRAINT "saved_exchanges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_exchanges" ADD CONSTRAINT "saved_exchanges_question_message_id_messages_id_fk" FOREIGN KEY ("question_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_exchanges" ADD CONSTRAINT "saved_exchanges_answer_message_id_messages_id_fk" FOREIGN KEY ("answer_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_exchanges" ADD CONSTRAINT "saved_exchanges_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_reply_to_id_team_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."team_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "artifact_comments_artifact_idx" ON "artifact_comments" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "artifact_shares_artifact_idx" ON "artifact_shares" USING btree ("artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_no_uq" ON "artifact_versions" USING btree ("artifact_id","version_no");--> statement-breakpoint
CREATE INDEX "artifacts_notebook_idx" ON "artifacts" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_members_user_idx" ON "channel_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "channels_notebook_idx" ON "channels" USING btree ("notebook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_general_uq" ON "channels" USING btree ("notebook_id") WHERE "channels"."type" = 'general';--> statement-breakpoint
CREATE UNIQUE INDEX "connection_sources_uq" ON "connection_sources" USING btree ("connection_id","external_source_id");--> statement-breakpoint
CREATE INDEX "conversations_notebook_user_idx" ON "conversations" USING btree ("notebook_id","user_id");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "jobs_poll_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "message_attachments_message_idx" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notebook_connections_notebook_idx" ON "notebook_connections" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "notebook_invites_notebook_idx" ON "notebook_invites" USING btree ("notebook_id","email");--> statement-breakpoint
CREATE INDEX "notebook_members_user_idx" ON "notebook_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notebooks_owner_idx" ON "notebooks" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "notebooks_title_trgm" ON "notebooks" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notes_notebook_idx" ON "notes" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "source_chunks_embedding_hnsw" ON "source_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "source_chunks_tsv_gin" ON "source_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "source_chunks_notebook_source_idx" ON "source_chunks" USING btree ("notebook_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_chunks_source_idx_uq" ON "source_chunks" USING btree ("source_id","idx");--> statement-breakpoint
CREATE INDEX "sources_notebook_idx" ON "sources" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "sources_file_idx" ON "sources" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "sources_title_trgm" ON "sources" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "team_messages_channel_idx" ON "team_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "team_messages_tsv_gin" ON "team_messages" USING gin ("tsv");