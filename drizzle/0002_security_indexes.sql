CREATE TABLE "artifact_files" (
	"artifact_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_files_artifact_id_file_id_pk" PRIMARY KEY("artifact_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "contains_private_sources" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "notebook_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_files" ADD CONSTRAINT "artifact_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_files_file_idx" ON "artifact_files" USING btree ("file_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_notebook_idx" ON "files" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "files_origin_created_idx" ON "files" USING btree ("origin","created_at");--> statement-breakpoint
-- ===== Dữ liệu hiện có (backfill) =====
-- 1) files.notebook_id / origin: tệp đính kèm chat -> nguồn -> tệp xuất (quota dung lượng theo sổ tay).
UPDATE "files" f SET "notebook_id" = c."notebook_id", "origin" = 'chat_upload'
FROM "message_attachments" ma
JOIN "team_messages" m ON m."id" = ma."message_id"
JOIN "channels" c ON c."id" = m."channel_id"
WHERE ma."file_id" = f."id" AND f."notebook_id" IS NULL;--> statement-breakpoint
UPDATE "files" f SET "notebook_id" = s."notebook_id", "origin" = 'source_upload'
FROM "sources" s
WHERE s."file_id" = f."id" AND f."notebook_id" IS NULL;--> statement-breakpoint
UPDATE "files" f SET "notebook_id" = a."notebook_id", "origin" = 'export'
FROM "artifact_exports" e
JOIN "artifacts" a ON a."id" = e."artifact_id"
WHERE e."file_id" = f."id" AND f."notebook_id" IS NULL;--> statement-breakpoint
-- 2) artifact_files: ảnh mà các phiên bản hiện có đang tham chiếu. Chỉ nhận tệp do chủ artifact hoặc thành viên sổ tay sở hữu
--    (không tin fileId tuỳ ý trong JSON do client sửa được).
INSERT INTO "artifact_files" ("artifact_id", "file_id")
SELECT DISTINCT v."artifact_id", f."id"
FROM "artifact_versions" v
JOIN "artifacts" a ON a."id" = v."artifact_id" AND a."type" IN ('slide_deck', 'infographic')
CROSS JOIN LATERAL (
  SELECT x #>> '{}' AS fid FROM jsonb_path_query(v."content", '$.slides[*].image.fileId') x
  UNION
  SELECT x #>> '{}' AS fid FROM jsonb_path_query(v."content", '$.imageFileId') x
) refs
JOIN "files" f ON f."id"::text = refs.fid
WHERE f."owner_id" = a."created_by"
   OR EXISTS (SELECT 1 FROM "notebook_members" nm WHERE nm."notebook_id" = a."notebook_id" AND nm."user_id" = f."owner_id")
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "files" f SET "notebook_id" = a."notebook_id", "origin" = 'artifact_image'
FROM "artifact_files" af
JOIN "artifacts" a ON a."id" = af."artifact_id"
WHERE af."file_id" = f."id" AND f."notebook_id" IS NULL;--> statement-breakpoint
-- 3) Artifact đang chứa trích đoạn từ nguồn riêng tư: đánh dấu và đưa về riêng tư, thu hồi liên kết chia sẻ (bất biến docs/02 §3.4).
UPDATE "artifacts" a SET "contains_private_sources" = true
WHERE EXISTS (
  SELECT 1
  FROM "artifact_versions" v,
       jsonb_array_elements(CASE WHEN jsonb_typeof(v."content" -> 'evidence') = 'array' THEN v."content" -> 'evidence' ELSE '[]'::jsonb END) e
  JOIN "sources" s ON s."id"::text = e ->> 'sourceId' AND s."visibility" = 'private'
  WHERE v."id" = a."current_version_id"
);--> statement-breakpoint
UPDATE "artifacts" SET "visibility" = 'private', "share_token" = NULL
WHERE "contains_private_sources" = true AND "visibility" <> 'private';
