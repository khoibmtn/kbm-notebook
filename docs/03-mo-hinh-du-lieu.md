# 03 · Mô hình dữ liệu (PostgreSQL · Drizzle)

Quy ước: `id uuid pk default gen_random_uuid()`, `created_at/updated_at timestamptz`, xoá mềm bằng `deleted_at` ở bảng nội dung. Tên bảng snake_case số nhiều.

## Auth (better-auth quản lý)
`users(id, name, email unique, email_verified, image, created_at, updated_at)`, `sessions`, `accounts` (Google OAuth tokens: access/refresh, scope), `verifications`. Mở rộng: `user_profiles(user_id pk→users, display_name, title, bio, locale 'vi', theme)`.

## Settings
- `user_settings(user_id pk, gemini_api_key_enc text, connectors_enc text (JSON mã hoá: cài đặt NotebookLM Bridge/Enterprise — P5), default_chat_model, default_artifact_model, embedding_model 'gemini-embedding-001', embedding_dim 768, notify_email bool, prompts jsonb)` — `prompts` = map `{ [artifactType]: { system, user, options } }` ghi đè prompt mặc định trong code (`src/server/ai/prompts/defaults.ts`).
- `app_settings(key pk, value jsonb)` (server-level, admin).

## Notebook & thành viên
- `notebooks(id, owner_id→users, title, description, emoji, cover_color, system_instruction text, allow_web bool default false, default_artifact_visibility enum('private','notebook','link','public') default 'notebook', is_public bool default false, public_slug unique null, created_at, updated_at, deleted_at)`
- `notebook_members(notebook_id, user_id, role enum('owner','admin','editor','viewer'), invited_by, joined_at, pk(notebook_id,user_id))`
- `notebook_invites(id, notebook_id, email, role, token unique, invited_by, expires_at, accepted_at)`

Ma trận quyền:

| Hành động | viewer | editor | admin | owner |
|---|---|---|---|---|
| Xem nguồn shared, artifact đã chia sẻ, notes shared | ✓ | ✓ | ✓ | ✓ |
| Chat AI (trên nguồn được phép) | ✓ | ✓ | ✓ | ✓ |
| Chat cộng tác (general + DM) | ✓ | ✓ | ✓ | ✓ |
| Thêm/xoá nguồn, kết nối/gỡ connection của mình | | ✓ | ✓ | ✓ |
| Tạo/sửa/xoá artifact, notes | | ✓ | ✓ | ✓ |
| Sửa system instruction, cấu hình sổ tay | | | ✓ | ✓ |
| Mời/đổi vai trò/xoá thành viên (≤ admin) | | | ✓ | ✓ |
| Xoá sổ tay, chuyển chủ sở hữu, chia sẻ public | | | | ✓ |

## Nguồn tri thức
- `sources(id, notebook_id, created_by, kind enum('file','url','text','youtube','drive','chat_attachment'), title, mime, file_id→files null, url null, raw_text null, visibility enum('shared','private') default 'shared', status enum('pending','processing','ready','failed'), error text, page_count int, token_count int, summary text, key_topics jsonb, metadata jsonb, created_at, updated_at, deleted_at)`
- `source_chunks(id, source_id, notebook_id, idx int, text, token_count, page int null, section text null, start_char int, end_char int, embedding vector(768), tsv tsvector generated)` — index HNSW `embedding vector_cosine_ops`, GIN `tsv`, index `(notebook_id, source_id)`.
- `files(id, owner_id, storage_key, original_name, mime, size_bytes, sha256, created_at)`.
- `notebook_connections(id, notebook_id, owner_user_id, provider enum('notebooklm-bridge','notebooklm-enterprise','google-drive'), external_id text (notebook id ngoài), label, config jsonb (không chứa secret), credential_enc text null, shared_with_members bool default false, status enum('unconfigured','ready','error'), last_error, last_synced_at, created_at)` — cache: `connection_sources(id, connection_id, external_source_id, title, kind, metadata jsonb, synced_at)`.

## Chat AI
- `conversations(id, notebook_id, user_id, title, created_at, updated_at)` (riêng từng người dùng trong sổ tay).
- `messages(id, conversation_id, role enum('user','assistant','system'), content text, citations jsonb (Evidence[]), sources_used jsonb, insufficient_evidence bool, scope jsonb {sourceIds, connectionIds, useWeb}, model, usage jsonb, created_at)`.
- `saved_exchanges(id, notebook_id, user_id, question_message_id, answer_message_id, note_id null, created_at)`.

## Notes
- `notes(id, notebook_id, created_by, title, content_md text, content_json jsonb null, origin enum('manual','chat','team_chat','artifact'), origin_ref jsonb, visibility enum('shared','private') default 'shared', is_source bool default false (đã "thêm vào nguồn" → tạo `sources.kind='text'` liên kết `metadata.note_id`), created_at, updated_at, deleted_at)`.

## Studio / Artifact
- `artifacts(id, notebook_id, created_by, type enum('note','report','study_guide','faq','timeline','mindmap','slide_deck','infographic','quiz','flashcards','data_table'), title, status enum('queued','generating','ready','failed'), error, current_version_id→artifact_versions, visibility enum('private','notebook','link','public'), share_token unique null, generation_config jsonb {prompt, customPrompt, options, scope, model}, forked_from_id null, created_at, updated_at, deleted_at)`
- `artifact_versions(id, artifact_id, version_no int, content jsonb, content_md text null, created_by, note text, created_at)` — content theo schema từng loại (`src/server/artifacts/schemas.ts`):
  - `slide_deck`: `{ theme: {palette, font}, slides: [{ id, layout:'title'|'title_bullets'|'two_column'|'image_text'|'chart'|'quote'|'section'|'closing', title, subtitle?, bullets?: string[], columns?: [{heading, bullets}], image?: {prompt, fileId?, caption}, chart?: {type:'bar'|'line'|'pie', labels, series:[{name, values}]}, notes?: string, citations?: number[] }], evidence: Evidence[] }`
  - `quiz`: `{ questions: [{ id, type:'mcq'|'tf'|'short', stem, options?: [{key,text}], answer, explanation, citations?: number[], difficulty }] , evidence }`
  - `flashcards`: `{ cards: [{ id, front, back, hint?, tags?, citations? }], evidence }`
  - `mindmap`: `{ root: { id, label, note?, children: [...] }, evidence }`
  - `report|study_guide|faq|timeline`: `{ markdown, sections?: [...], evidence }`
  - `infographic`: `{ title, subtitle, orientation:'portrait'|'landscape', palette, blocks: [{ type:'stat'|'list'|'process'|'compare'|'icon_text'|'chart'|'quote', ... }], imageFileId?: string, evidence }`
  - `data_table`: `{ columns: [{key,label}], rows: [...], evidence }`
- `artifact_exports(id, artifact_id, version_id, format enum('pptx','docx','pdf','png','svg','csv','md','json','apkg_tsv'), file_id, created_at)`.
- `artifact_shares(id, artifact_id, user_id null, email null, role enum('view','edit'), created_at)`.

## Chat cộng tác
- `channels(id, notebook_id, type enum('general','topic','dm'), name null, created_by, created_at)`; mỗi notebook tự tạo 1 `general`.
- `channel_members(channel_id, user_id, last_read_message_id null, last_read_at, muted bool, pk(channel_id,user_id))`.
- `team_messages(id, channel_id, sender_id, kind enum('text','file','artifact_ref','source_ref','note_ref','system'), content text, content_json jsonb (mentions[], attachments[], refs), reply_to_id null, edited_at null, deleted_at null, recalled_at null, pinned bool, tsv tsvector generated, created_at)`.
- `message_reactions(message_id, user_id, emoji, pk(message_id,user_id,emoji))`.
- `message_attachments(id, message_id, file_id, name, mime, size)` — "chuyển vào Sources" tạo `sources(kind='chat_attachment', file_id)`.
- `notifications(id, user_id, type, title, body, link, data jsonb, read_at, created_at)`.

## Community
- `groups(id, name, slug unique, description, owner_id, visibility 'private'|'public', created_at)` + `group_members(group_id, user_id, role owner|admin|viewer, joined_at)` + `group_notebooks(group_id, notebook_id)`. `visibility='public'` = ai cũng tham gia được; `'private'` = chỉ theo lời mời. Vai trò `viewer` hiển thị là "Thành viên".
- `artifact_likes(artifact_id, user_id)`, `artifact_comments(id, artifact_id, user_id, body, created_at)`.
- `notebook_join_requests(id, notebook_id, user_id, message, status 'pending'|'accepted'|'rejected', created_at, decided_at, decided_by)` (P6, migration `0002`): yêu cầu tham gia sổ tay công khai; duy nhất một yêu cầu `pending` mỗi (sổ tay, người dùng).
- Explore dùng `artifacts.visibility='public'` (đã `ready`, chưa xoá) và `notebooks.is_public` + `public_slug` (trang `/p/<slug>` chỉ lộ tiêu đề/mô tả/emoji/artifact công khai).

## Hạ tầng
- `jobs(id, type, payload jsonb, status enum('queued','running','done','failed'), attempts, max_attempts 3, run_at, locked_at, locked_by, progress int, result jsonb, error, created_at, updated_at)`.
- `rate_limits(key, window_start, count)`, `audit_logs(id, user_id, action, target_type, target_id, meta jsonb, created_at)`.
