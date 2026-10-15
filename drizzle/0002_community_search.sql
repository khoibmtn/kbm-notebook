CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "notebook_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" text,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid
);
--> statement-breakpoint
ALTER TABLE "notebook_join_requests" ADD CONSTRAINT "notebook_join_requests_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_join_requests" ADD CONSTRAINT "notebook_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notebook_join_requests" ADD CONSTRAINT "notebook_join_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notebook_join_requests_notebook_idx" ON "notebook_join_requests" USING btree ("notebook_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notebook_join_requests_pending_uq" ON "notebook_join_requests" USING btree ("notebook_id","user_id") WHERE "notebook_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "artifact_versions_md_gin" ON "artifact_versions" USING gin (to_tsvector('simple', coalesce("content_md", '')));--> statement-breakpoint
CREATE INDEX "artifacts_title_trgm" ON "artifacts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "artifacts_public_idx" ON "artifacts" USING btree ("created_at") WHERE "artifacts"."visibility" = 'public' and "artifacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "groups_name_trgm" ON "groups" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notes_search_gin" ON "notes" USING gin (to_tsvector('simple', "title" || ' ' || "content_md"));--> statement-breakpoint
CREATE INDEX "notes_title_trgm" ON "notes" USING gin ("title" gin_trgm_ops);