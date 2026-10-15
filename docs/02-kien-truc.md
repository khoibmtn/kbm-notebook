# 02 · Kiến trúc hệ thống

## 1. Stack (chốt)

| Lớp | Lựa chọn | Lý do |
|---|---|---|
| Web framework | **Next.js 16** (App Router, TypeScript, Turbopack), React 19 | SSR + Route Handlers + streaming; `proxy.ts` thay `middleware.ts`; params/cookies là async |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + lucide-react; tiếng Việt mặc định, dictionary `vi/en` trong `src/i18n` | Hiện đại, tối giản, responsive |
| Auth | **better-auth** (email+password, Google OAuth; plugin `organization` không dùng — quyền theo notebook riêng) | Auth.js đang ở chế độ bảo trì; better-auth lưu user trong Postgres của ta |
| ORM/DB | **Drizzle ORM** + PostgreSQL 16 + **pgvector** (HNSW) + `pg_trgm` + `tsvector` | Hybrid search; migration bằng `drizzle-kit` |
| AI | `@google/genai` (Gemini) qua lớp `AiProvider`; `MockAiProvider` cho test; Anthropic optional sau | Gemini là provider chính, model ID cấu hình được |
| Realtime | **Socket.IO** gắn vào custom server `server.ts` (Node) | Chat cộng tác, typing, read receipt, thông báo |
| Job queue | Bảng `jobs` trong Postgres + worker in-process (`src/server/jobs/worker.ts`), khoá bằng `FOR UPDATE SKIP LOCKED` | Không có Redis/Docker; đủ cho MVP, thay bằng BullMQ sau |
| Lưu trữ tệp | `StorageAdapter` → `LocalDiskStorage` (`./storage`, ngoài public) ; S3 adapter sau | Phục vụ tệp qua route có kiểm quyền `/api/files/[id]` |
| Trích xuất tài liệu | `unpdf` (PDF, theo trang), `mammoth` (DOCX→HTML/text), `xlsx` (SheetJS), PPTX qua `jszip` đọc `ppt/slides/*.xml`, markdown/txt/csv/json, URL qua `@mozilla/readability` + `jsdom`, YouTube transcript (giai đoạn sau) | Có số trang/slide để trích dẫn |
| Export | `pptxgenjs` (PPTX gốc), `docx` (DOCX), PDF qua Chromium (Playwright `page.pdf`) hoặc LibreOffice fallback, PNG/SVG qua Chromium screenshot, CSV/TSV (Anki), Markdown | Mọi định dạng đều chỉnh sửa tiếp được |
| Editor | Tiptap (notes/report/study guide, Markdown in/out), slide editor tự xây (contentEditable per element), markmap (mind map) | |
| Test | Vitest (unit + API), Playwright (e2e smoke) | |

## 2. Cấu trúc thư mục

```
src/
  app/                       # routes (App Router)
    (auth)/login, register
    (app)/
      layout.tsx             # shell: sidebar + topbar
      page.tsx               # dashboard: danh sách sổ tay
      explore/               # Community/Explore (artifact & notebook public)
      settings/              # profile, AI keys, prompts, connectors, notifications
      n/[notebookId]/        # không gian sổ tay (3 cột: Sources · Chat/Notes · Studio)
        layout.tsx, page.tsx (chat AI), sources/, notes/, studio/, artifacts/[artifactId]/, team/ (chat cộng tác), members/, settings/
    api/                     # Route Handlers (REST + SSE)
      auth/[...all]          # better-auth
      notebooks/, sources/, chat/, notes/, artifacts/, channels/, messages/, files/, connectors/, settings/, search/
  server/                    # code chỉ chạy server
    db/ (schema.ts, index.ts, migrate.ts)
    auth/ (auth.ts, session.ts, permissions.ts)
    ai/ (provider.ts, gemini.ts, mock.ts, prompts/, citations.ts, context.ts)
    knowledge/ (providers: local.ts, web.ts, notebooklm-bridge.ts, notebooklm-enterprise.ts; ingest/: extract.ts, chunk.ts, embed.ts; retrieve.ts)
    artifacts/ (generators/<type>.ts, exporters/<format>.ts, schemas.ts)
    chat/ (realtime.ts, service.ts)
    jobs/ (queue.ts, worker.ts, handlers/)
    storage/ (adapter.ts, local.ts)
  components/ (ui/ shadcn, layout/, sources/, chat/, studio/, notes/, team-chat/, shared/)
  lib/ (utils, i18n, validators zod, api-client)
  i18n/ (vi.ts, en.ts)
bridge/notebooklm/           # sidecar Python (FastAPI) bọc notebooklm-py — unofficial
docs/
tests/ (unit/, api/, e2e/)
server.ts                    # custom server: Next + Socket.IO + job worker
drizzle/                     # migrations
storage/                     # tệp người dùng (gitignore)
```

## 3. Lớp trừu tượng cốt lõi (contract cho mọi module)

### 3.1 `AiProvider` (`src/server/ai/provider.ts`)
```ts
export interface AiProvider {
  id: 'gemini' | 'mock';
  generateText(req: { model?: string; system?: string; messages: ChatMsg[]; temperature?: number; jsonSchema?: object; tools?: { googleSearch?: boolean } }): Promise<{ text: string; json?: unknown; usage?: Usage; webSources?: WebSource[] }>;
  streamText(req): AsyncIterable<{ delta?: string; done?: boolean; webSources?: WebSource[] }>;
  embed(texts: string[], opts?: { dim?: number; taskType?: 'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY' }): Promise<number[][]>;
  generateImage?(prompt: string, opts?: { aspect?: string }): Promise<{ bytes: Buffer; mime: string }>;
  listModels?(): Promise<string[]>;
}
```
`getAiProviderForUser(userId)` → ưu tiên key người dùng (bảng `user_settings.gemini_api_key_enc`, mã hoá AES-256-GCM với `APP_ENCRYPTION_KEY`) → key server `GEMINI_API_KEY` → nếu không có: ném `AiNotConfiguredError` (HTTP 412, UI hiển thị hướng dẫn cấu hình). `AI_PROVIDER=mock` dùng trong test.

### 3.2 `KnowledgeProvider` (`src/server/knowledge/providers/types.ts`)
```ts
export interface KnowledgeProvider {
  kind: 'local' | 'web' | 'notebooklm-bridge' | 'notebooklm-enterprise';
  retrieve(q: { query: string; notebookId: string; sourceIds?: string[]; topK?: number; userId: string }): Promise<Evidence[]>;
  // Evidence = { id, provider, sourceId, sourceTitle, locator: { page?, slide?, section?, url?, startChar?, endChar? }, text, score }
}
```
- `local`: hybrid = pgvector cosine (HNSW) + BM25 (`tsvector`) + rerank bằng RRF; trả về chunk với `locator.page`.
- `web`: Gemini `googleSearch` grounding → `Evidence` với `locator.url`; chỉ gọi khi `notebook.allow_web = true` **và** người dùng bật trong câu hỏi.
- `notebooklm-bridge`: gọi sidecar `POST /notebooks/{id}/ask` → `references[]` → `Evidence` (sourceTitle lấy từ cache danh sách nguồn của notebook ngoài).
- `notebooklm-enterprise`: không có chat API → `retrieve()` ném `NotSupported`; chỉ dùng để liệt kê/thêm nguồn/chia sẻ.

### 3.3 Pipeline trả lời có trích dẫn (`src/server/ai/context.ts`, `citations.ts`)
1. Xác định scope: nguồn được chọn (`selected_source_ids`), kho ngoài được chọn (`selected_connections`), `use_web`.
2. `retrieve()` song song trên các provider → gộp, cắt theo token budget (mặc định 24k token), đánh số `[1..n]`.
3. Prompt: system instruction = `global default` + `notebook.system_instruction` + quy tắc trích dẫn: *chỉ dùng `[n]` có trong danh sách; nếu không có bằng chứng, nói rõ "Không tìm thấy trong nguồn"*.
4. Hậu kiểm: regex `\[(\d+)\]` → giữ n hợp lệ, xoá n không hợp lệ; tính `sources_used` = tập source của các n được dùng thật; gắn `insufficient_evidence=true` nếu evidence rỗng hoặc max score < ngưỡng.
5. Lưu `messages.citations = Evidence[]` và `messages.sources_used`; UI render chip `[n]` → mở source viewer đúng trang/đoạn; cuối câu trả lời liệt kê "Nguồn đã dùng".

### 3.4 Phân quyền (`src/server/auth/permissions.ts`)
- Vai trò notebook: `owner > admin > editor > viewer`. Hàm `requireNotebookRole(userId, notebookId, min: Role)` dùng trong **mọi** route handler/socket event. Ma trận ở `docs/03-mo-hinh-du-lieu.md`.
- Nguồn riêng tư (`sources.visibility='private'`): chỉ chủ nguồn thấy & được dùng trong retrieval của chính họ; khi chia sẻ sổ tay không lộ.
- Kết nối ngoài (`notebook_connections`): credential thuộc người tạo (`owner_user_id`); thành viên khác dùng được **chỉ khi** `shared_with_members=true`, và chỉ qua server (không bao giờ trả credential về client).
- Artifact: `visibility` ∈ `private | notebook | link | public`; mặc định khi tạo = `notebooks.default_artifact_visibility`.
- Chat riêng: `channels.type='dm'` với đúng 2 `channel_members`; mọi truy vấn message đều join `channel_members`.

### 3.5 Realtime (`src/server/chat/realtime.ts`)
Socket.IO namespace `/rt`, auth bằng cookie session better-auth khi handshake. Rooms: `notebook:{id}`, `channel:{id}`, `user:{id}`. Sự kiện: `message:new|edit|delete|recall|reaction`, `typing`, `read`, `notification`, `source:status`, `artifact:status`, `job:progress`.

### 3.6 Jobs
`jobs(id, type, payload jsonb, status, attempts, run_at, locked_at, error, result)`. Loại: `ingest_source`, `generate_artifact`, `export_artifact`, `sync_connection`. Worker poll 1s, concurrency 2, retry 3 lần với backoff.

## 4. Luồng người dùng chính
1. Đăng ký/đăng nhập → Dashboard → "Tạo sổ tay".
2. Sổ tay: kéo thả tệp vào cột Sources → trạng thái ingest realtime → tick chọn nguồn → hỏi ở Chat → trả lời có `[n]` → "Lưu thành note" / "Lưu cặp hỏi-đáp".
3. Studio: chọn loại (Slide deck…) → hộp tuỳ chỉnh (prompt mặc định từ Settings + prompt riêng + thiết lập) → job → artifact mở trong editor → sửa → xuất PPTX/DOCX/PDF → chia sẻ (link/public) → nhân bản/phiên bản.
4. Thành viên: mời qua email, chọn vai trò → Team chat chung/DM → chia sẻ artifact vào chat → chuyển tệp chat → Sources → chọn tin nhắn → "Tạo note/artifact".
5. Settings: khoá API, model, prompt mặc định từng loại artifact, kết nối NotebookLM Bridge/Enterprise, Google.

## 5. Bảo mật
- Session cookie httpOnly; CSRF theo better-auth; rate-limit route AI (per user) bằng bảng `rate_limits`.
- Tệp tải lên: kiểm MIME + kích thước (mặc định 50MB), lưu ngoài `public`, phục vụ qua route có kiểm quyền; tên tệp sinh UUID.
- Khoá API/credential mã hoá AES-256-GCM; không log.
- Zod validate mọi input; lỗi chuẩn `{ error: { code, message } }`.

## 6. Ghi chú triển khai P0 (khác biệt / bổ sung so với thiết kế)

Các điểm dưới đây phản ánh code thật sau P0; phase sau dựa vào đây khi mở rộng.

**Next 16 & môi trường**
- Dùng `src/proxy.ts` (không còn `middleware.ts`): chỉ kiểm tra *có cookie session* để chuyển hướng về `/login?next=…`; xác thực thật nằm ở `(app)/layout.tsx` (`requirePageSession`) và `requireUser()` trong route handler.
- `cacheComponents`/`partialPrefetching` của template mặc định **bị tắt** (app hoàn toàn động theo session; custom server).
- shadcn CLI không chạy được trong môi trường build (registry `ui.shadcn.com` bị chặn) nên các component trong `src/components/ui/` được sao chép từ nguồn `new-york-v4` của repo shadcn-ui (cùng nội dung CLI sinh ra). Thêm component mới: copy tương tự hoặc chạy `pnpm dlx shadcn@latest add <name>` khi có mạng.
- `server.ts` chạy bằng `tsx --tsconfig tsconfig.server.json` (dev) và bundle bằng `esbuild` → `dist/server.js` (prod, `--packages=external`). Package `server-only` được alias sang stub (`scripts/server-only-stub.ts`) ngoài Next. **Không** import `next/headers`/`next/navigation` tĩnh trong module mà `server.ts` nạp (vd. `session.ts` import lười `next/headers`; `requirePageSession` nằm riêng ở `auth/page-session.ts`).
- Module nạp bởi `server.ts` (tsx) và module bundle bởi Next là **hai instance riêng trong cùng tiến trình**: chia sẻ trạng thái qua `globalThis` (Socket.IO `__kbmIo`, pool DB, worker). Handler job chỉ đăng ký ở instance của `server.ts` (nơi worker chạy); route handler chỉ `enqueue()`.

**Auth**
- better-auth dùng id `uuid` (`advanced.database.generateId = "uuid"`) khớp schema; bảng đặt tên số nhiều (`users, sessions, accounts, verifications`). Hook `user.create.after` tạo `user_profiles` + `user_settings`.
- `getSession(headers?)` lấy headers theo thứ tự: tham số → `AsyncLocalStorage` do `handleRoute` đặt (cho phép test gọi thẳng route handler bằng `Request`) → `next/headers`. Socket.IO truyền `Headers({ cookie })` từ handshake.
- Google: chỉ bật khi có `GOOGLE_CLIENT_ID/SECRET` (scope `openid email profile`, `accessType: offline`). Drive là scope *tuỳ chọn*: client gọi `connectGoogleDrive()` (`src/lib/auth-client.ts`) = `linkSocial({ provider: "google", scopes: [drive.readonly] })`; chưa có UI Drive.

**Phân quyền**
- `requireNotebookRole`: không phải thành viên / notebook đã xoá → **404** (không lộ sự tồn tại); là thành viên nhưng thiếu quyền → **403**. Logic thứ bậc vai trò dùng chung client/server ở `src/lib/roles.ts`.
- Chấp nhận lời mời (`POST /api/invites/[token]/accept`) yêu cầu email tài khoản **trùng** email được mời (chưa có xác minh email nên token một mình chưa đủ). Lời mời hết hạn sau 7 ngày. Mời email đã có tài khoản → thêm thẳng vào `notebook_members` + `channel_members` của kênh `general`.
- Chỉ owner được đặt `defaultArtifactVisibility = public`. Chủ sở hữu bất biến qua PATCH/DELETE member; đổi chủ qua `POST /api/notebooks/[id]/transfer` (owner cũ → admin).
- Quy ước JSON của API là camelCase (`systemInstruction`, `allowWeb`, `defaultArtifactVisibility`, `coverColor`).

**AI**
- Thêm `AiProviderError` (key sai/hết quota… → 400/429/502, mã `ai_provider_error`) bên cạnh `AiNotConfiguredError` (412, mã `ai_not_configured`). `TextRequest.__mockJson` chỉ để test với `MockAiProvider`.
- Model mặc định cấu hình qua env (`GEMINI_CHAT_MODEL`, `GEMINI_ARTIFACT_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_IMAGE_MODEL`) hoặc `user_settings`; mặc định dùng alias `gemini-flash-latest`/`gemini-pro-latest`/`gemini-embedding-001`. Embedding luôn chuẩn hoá L2 sau khi cắt `outputDimensionality` (768).
- `KnowledgeProvider`/`Evidence` đã có kiểu ở `src/server/knowledge/providers/types.ts` (chưa có implementation).

**Tệp & job & realtime**
- `StorageAdapter.put(data, { ownerId, mime, name })` (cần `ownerId` vì `files.owner_id` bắt buộc); key lưu `YYYY/MM/<uuid>`; vượt `MAX_UPLOAD_MB` → 413 `payload_too_large`. `canAccessFile` chạy chuỗi *luật truy cập* — phase sau gọi `registerFileAccessRule()` (`src/server/storage/files.ts`) để thêm luật (vd. tệp đính kèm chat đã có sẵn). HTML/SVG luôn bị ép `attachment`.
- Worker: handler đăng ký bằng `registerJobHandler(type, fn)`; chỉ nhận job có loại đã đăng ký; retry backoff 5s/20s/80s; job `running` quá 10 phút được đưa lại hàng đợi; tiến độ phát qua `job:progress` tới `notebook:{payload.notebookId}` / `user:{payload.userId}` nếu payload có các trường đó.
- Socket.IO: namespace `/rt`, `destroyUpgrade: false` (để HMR của Next dev hoạt động). Ngoài `join:notebook` còn có `leave:notebook`, `join:channel` (kiểm tra `channel_members`), `leave:channel`.

**i18n & test**
- Từ điển phẳng khoá dạng `"nhóm.khoá"` (`src/i18n/vi.ts` là nguồn kiểu `MessageKey`; `en.ts` bắt buộc đủ khoá). `t()` ở `src/lib/i18n.ts`, `useT()` ở `src/lib/i18n-client.tsx`, `getT()` (server) ở `src/i18n/server.ts`; locale lưu cookie `kbm_locale`.
- Test: `tests/unit`, `tests/api` (gọi route handler trực tiếp với session thật của better-auth, DB `kbm_notebook_test` được tạo lại + migrate trong `tests/setup/global-setup.ts`), `tests/components` (jsdom), `tests/e2e` (Playwright, tự bật `pnpm dev` ở cổng `E2E_PORT`, mặc định 3200).

## 7. Ghi chú triển khai P1 (Sources)

**API** (`src/app/api/notebooks/[id]/…`, JSON camelCase, lỗi `{ error: { code, message } }`)
- `GET sources` (viewer+; chỉ nguồn shared + nguồn private của chính người gọi), `POST sources` (editor+; `{kind:'url',url}` | `{kind:'text',title,text}`, tuỳ chọn `visibility`), `POST sources/upload` (multipart, trường `files`, nhiều tệp; 413 `payload_too_large`, 415 `unsupported_type`), `GET/PATCH/DELETE sources/[sourceId]` (PATCH/DELETE: chủ nguồn hoặc admin+, nguồn private của người khác → 404), `POST sources/[sourceId]/reprocess` (202; chỉ khi `ready`/`failed`, 409 nếu đang xử lý), `POST search` (`{query, sourceIds?, topK?}` → `{ evidence }`).
- Link YouTube tạo nguồn `kind='youtube'` ở trạng thái `failed` ("Nguồn YouTube chưa hỗ trợ"), không xếp job. URL nội bộ/loopback bị từ chối ngay (400 `blocked_url`).

**Pipeline ingest** (`src/server/knowledge/ingest/`, job `ingest_source`, handler đăng ký trong `server.ts` qua `registerIngestHandler()`)
- `extract.ts` → `Segment[]` (`text`, `page` | `slide`, `section`); `chunk.ts` ghép thành toàn văn + `spans` rồi cắt chunk ≈800 token / chồng lấn 120 (ranh giới câu, không vượt ranh giới trang/slide; các mục không có trang như DOCX/MD được gộp nếu vừa); `embed.ts` batch 32 + retry; `summarize.ts` (AI với JSON schema, lỗi/đầu ra sai → tóm tắt trích xuất từ chính văn bản, `metadata.summaryBy`).
- Toàn văn lưu ở `sources.raw_text`; bản đồ vị trí ở `sources.metadata.spans` (`[{start,end,page?,slide?,section?}]`), đơn vị trang ở `metadata.unit` (`page|slide|sheet`), tiến độ ở `metadata.progress`. `source_chunks.page` lưu số trang **hoặc** số slide **hoặc** thứ tự sheet (xem `unit`); `start_char/end_char` tính theo `raw_text`.
- Lỗi vĩnh viễn (`IngestError`: PDF scan "cần OCR", tệp hỏng, URL nội bộ…) → `failed` ngay, job không retry; lỗi tạm (mạng, AI quá tải) → để worker retry theo backoff, nguồn giữ `processing` kèm ghi chú; hết lượt → `failed`. Thiếu khoá AI → `failed` với thông báo cấu hình.
- Realtime `source:status` (`SourceStatusEvent` ở `src/lib/sources.ts`): nguồn shared phát tới `notebook:{id}`, nguồn private chỉ tới `user:{createdBy}`; `change` = `status|created|updated|deleted` (client tải lại danh sách với các giá trị khác `status`).
- SSRF (`ssrf.ts`): chỉ http/https, chặn IP riêng/loopback/link-local/metadata (cả IPv6, v4-mapped), kiểm tra lại ở mỗi lần redirect **và** ở bước kết nối (`lookup` tuỳ biến, chống DNS rebinding); timeout 15s, tối đa 10MB, tự giải nén gzip/br. Không dùng `HTTP(S)_PROXY` của môi trường.

**Retrieval cho P2/P3**
- `retrieve(q, providers?)` (`src/server/knowledge/retrieve.ts`) → `Evidence[]` đã sắp giảm dần; `LocalKnowledgeProvider` (`providers/local.ts`): top 30 cosine (`<=>`) + top 30 full-text (`websearch_to_tsquery('simple', …)`, câu hỏi được chuyển thành các từ khoá nối bằng `or` vì mặc định là AND) → RRF (k=60, `rrf.ts`) → `topK` (mặc định 12). Chỉ tìm trong nguồn `ready`, chưa xoá, shared hoặc private của `userId`; `sourceIds` rỗng → không có kết quả.
- `Evidence.score` là điểm RRF (≈0,016–0,033; chỉ so sánh trong cùng một truy vấn). Để đặt ngưỡng "thiếu bằng chứng" dùng `Evidence.similarity` (cosine 0–1, chỉ có khi chunk nằm trong top vector). `locator.slide` thay cho `page` với nguồn PPTX; sheet XLSX/CSV dùng `page` = thứ tự sheet + `section` = tên sheet.
- `buildContext(evidence, { tokenBudget = 24000 })` (`src/server/ai/context.ts`) đánh số `[1..n]`, cắt theo ngân sách (≈ký tự/4), trả `{ evidence, contextText }` (chỉ các `[n]` trong `evidence` trả về là hợp lệ khi hậu kiểm).
- Embedding của tài liệu dùng provider của **người tạo nguồn**, của câu hỏi dùng provider của **người hỏi**: nếu hai bên dùng model embedding khác nhau thì kết quả vector không còn đáng tin (mặc định cùng `gemini-embedding-001`/768 chiều).

**UI** (`src/components/sources/`)
- `SourcesPanel` cắm vào cột trái `NotebookWorkspace` và trang `/n/[id]/sources`; `SourceViewer`/`SourceViewerSheet` (route `/n/[id]/sources/[sourceId]?chunk=…|page=&start=&end=`). Helper `sourceViewerHref(notebookId, evidence)` và `parseViewerHighlight` ở `src/lib/sources.ts`.
- Lựa chọn nguồn: `useSourceSelection(notebookId)` / `getSelectedSourceIds(notebookId)` (`src/lib/use-source-selection.ts`, localStorage `kbm:sources:selected:<notebookId>`). Lần đầu mở sổ tay chọn sẵn mọi nguồn `ready`; nguồn vừa thêm được tự chọn; chỉ nguồn `ready` mới chọn được.

## 8. Ghi chú triển khai P4 — Chat nhóm

Không đổi schema (dùng nguyên các bảng `channels`, `channel_members`, `team_messages`, `message_reactions`, `message_attachments`, `notifications`). Mã nguồn: `src/server/team-chat/*` (nghiệp vụ), `src/app/api/{channels,notifications,notebooks/[id]/channels,…}`, `src/components/team-chat/*`, kiểu/hàm thuần dùng chung ở `src/lib/team-chat/*`.

**Quyền & riêng tư**
- Mọi handler tin nhắn đi qua `requireChannelAccess(userId, channelId, minRole)` (`server/team-chat/access.ts`): phải là thành viên notebook (không → **404**); kênh `dm` bắt buộc có dòng `channel_members` (không → **404**, không lộ sự tồn tại); kênh `general`/`topic` mọi thành viên notebook đều vào được (dòng `channel_members` thiếu được tự tạo). Viewer chat được; ghim / chuyển tệp vào Nguồn / tạo note cần `editor`; xoá tin của người khác cần `admin`; sửa & thu hồi chỉ người gửi.
- Danh sách kênh tự chữa: tạo lại `general` nếu thiếu và thêm mọi thành viên vào `general` + mọi chủ đề. `addMember` (P0) giờ cũng thêm người mới vào các kênh chủ đề; `removeMember` rút socket của người bị xoá khỏi phòng notebook/kênh.
- Tin xoá mềm (`deleted_at`) ẩn với mọi người; tin **thu hồi** (`recalled_at`) vẫn trả về như một dấu nhưng `content=''`, tệp/reaction/ghim bị gỡ khỏi DB. Note và nguồn tạo từ DM luôn `private`.
- Thẻ tham chiếu (`artifact_ref|source_ref|note_ref`) chỉ nhận mục đã chia sẻ trong cùng notebook (mục riêng tư → 400); khi đọc lại, mục bị xoá/chuyển riêng tư hiển thị `available:false`.

**API** (JSON camelCase; lỗi chuẩn `{ error: { code, message } }`)
| Phương thức · đường dẫn | Ghi chú |
|---|---|
| `GET/POST /api/notebooks/[id]/channels` | GET: kênh nhìn thấy + `unread`, `lastMessage`, `members` (DM); `?summary=1` → `{ unread }` (bỏ kênh tắt tiếng). POST `{type:'topic',name}` (editor+) hoặc `{type:'dm',userId}` (idempotent, khoá advisory theo cặp) |
| `PATCH /api/notebooks/[id]/channels/[channelId]` | đổi tên chủ đề (admin+ hoặc người tạo) |
| `POST …/channels/[channelId]/read` `{messageId}` · `POST …/mute` `{muted}` | mốc đọc chỉ tiến, không lùi; đọc kênh đánh dấu đã đọc thông báo `mention/dm` của kênh |
| `GET/POST /api/channels/[channelId]/messages` | GET keyset mới nhất trước: `?before=<id>`, `?after=<id>`, `?around=<id>`, `limit` ≤ 100; trang đầu kèm `pinned[]` và `reads[]` (mốc `lastReadAt` của thành viên khác → dấu "đã xem"). POST `{kind, content, replyToId?, mentions?, refs?, attachmentFileIds?}` |
| `GET /api/channels/[channelId]/messages/search?q=` · `GET /api/notebooks/[id]/messages/search?q=` | `tsv @@ plainto_tsquery('simple')` + `ILIKE`; chỉ trong kênh user thuộc về; bỏ tin thu hồi/xoá |
| `PATCH/DELETE …/messages/[messageId]` · `POST …/recall` · `POST …/reactions` `{emoji}` · `POST …/pin` | sửa (đặt `edited_at`) · xoá mềm · thu hồi · toggle reaction · toggle ghim |
| `POST /api/channels/[channelId]/upload` | multipart, trường `files` (≤ 10 tệp, theo `MAX_UPLOAD_MB`) → `{ files: [{ fileId, name, mime, size }] }`; sau đó POST tin nhắn với `attachmentFileIds` (chỉ nhận tệp của chính người gửi, chưa gắn tin nào). Quyền đọc tệp dùng luật `registerFileAccessRule` có sẵn từ P0 (thành viên kênh) |
| `POST …/messages/[messageId]/to-source` | editor+: `sources(kind='chat_attachment', status='pending')` + `enqueue('ingest_source', { sourceId, notebookId, userId })`; gọi lại không nhân đôi (`existing:true`); nếu chưa có handler thì nguồn giữ `pending` |
| `POST /api/notebooks/[id]/notes/from-messages` `{channelId?, messageIds[], title?, timeZone?}` | editor+: `notes(origin='team_chat', origin_ref={channelId,messageIds})`, `content_md` = `**Tên** (hh:mm): nội dung` theo thứ tự thời gian |
| `GET /api/notifications?unread=1` · `POST /api/notifications/read` `{ids}\|{all:true}` | thông báo `mention` / `dm`, `link` = `/n/{id}/team?channel=…&message=…` |

**Realtime** (namespace `/rt`): khi kết nối, socket tự vào mọi phòng `channel:{id}` của user (kể cả DM); `joinUserToChannel`/`joinNotebookToChannel`/`removeUserFromRooms` ở `server/chat/realtime.ts` đồng bộ phòng khi tạo kênh/xoá thành viên. Server phát `message:new|edit|delete|recall|reaction|pin` (payload luôn có `notebookId`, `channelId`), `channel:new` (kênh chủ đề → phòng notebook, DM → hai phòng `user:`), `channel:update`, `read`, `notification` (→ `user:{id}`). Client phát `typing {channelId}` (chỉ khi socket đã ở trong phòng; throttle 1.5s) và `read {channelId, messageId}` (có ack).

**Thành phần dùng lại cho module khác**
- `ShareToChatDialog` (`components/team-chat/share-to-chat-dialog.tsx`): `<ShareToChatDialog open onOpenChange notebookId item={{ type:'artifact'|'source'|'note', id, title }} />` — cần nằm trong `NotebookProvider`. Đường dẫn thẻ: artifact → `/n/[id]/artifacts/[artifactId]`, nguồn → `/n/[id]/sources?source=<id>`, note → `/n/[id]/notes?note=<id>` (module tương ứng có thể đọc query này để mở đúng mục).
- `NotificationBell` (đã gắn ở thanh trên của sổ tay và dashboard), hook `useNotifications()` (`lib/use-notifications.ts`) và `useTeamUnread(notebookId, meId)` (`lib/use-team-unread.ts`).
- `RefPickerDialog` đọc `GET /api/notebooks/[id]/{sources|artifacts|notes}` (chấp nhận `[...]` hoặc `{ sources: [...] }`); API chưa có (404) thì hiện "mô-đun chưa khả dụng".
