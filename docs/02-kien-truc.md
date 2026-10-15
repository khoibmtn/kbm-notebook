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

## 8. Ghi chú triển khai P2 (Chat AI + Ghi chú)

**API** (JSON camelCase, lỗi `{ error: { code, message } }`; hội thoại riêng tư theo người dùng, người khác — kể cả owner sổ tay — nhận 404)
- `GET/POST conversations`, `GET/PATCH/DELETE conversations/[conversationId]` (viewer+). `POST conversations/[id]/messages` body `{ question, scope: { sourceIds?, connectionIds?, useWeb? }, model?, regenerate? }`: mặc định trả **SSE**, `?stream=0` trả JSON `{ userMessage, message, evidence, scope, scopeAdjustments }`. Lỗi trước khi bắt đầu trả lời (404/412/429…) là HTTP lỗi thường, không phải sự kiện SSE.
- Sự kiện SSE (`event:` + `data:` JSON): `scope_adjusted {reason, scope}` (`web_not_allowed` | `connections_unavailable`), `meta {messageId, userMessageId, evidence[], scope}`, `delta {text}`, `done {messageId, content, citations, sourcesUsed, insufficientEvidence, usage, model}`, `error {code, message}`. Client ngắt kết nối (nút "Dừng") → server lưu phần câu trả lời đã nhận (không phát `done`).
- `POST …/messages/[messageId]/save-exchange` (viewer+, idempotent) → `saved_exchanges`; `GET saved-exchanges`; `POST …/messages/[messageId]/to-note` (editor+) → ghi chú `origin='chat'`, `origin_ref {conversationId, messageId}`, tiêu đề = câu hỏi, nội dung = câu trả lời + khối "**Nguồn**" (`- [n] Tiêu đề — vị trí`) cho các `[n]` thực sự dùng.
- `GET/POST notes`, `GET/PATCH/DELETE notes/[noteId]` (xem: viewer+ — shared + ghi chú riêng của mình; tạo/sửa/xoá: editor+, sửa/xoá chỉ tác giả hoặc admin+; `?q=` tìm theo tiêu đề/nội dung), `POST notes/[noteId]/to-source`. `GET /api/chat/models` (model mặc định + danh sách model có thể chọn).

**Pipeline** (`src/server/chat/ask.ts`; dùng lại được cho Studio: `prepareAsk()` → `run(signal)` (generator sự kiện) hoặc `askQuestion()` (không stream))
1. Kiểm tra hội thoại → provider AI (412 nếu chưa cấu hình) → rate limit `ask:<userId>` **60 / 10 phút** (`src/server/api/rate-limit.ts`, bảng `rate_limits`, 429 `rate_limited`) → chốt phạm vi: `sourceIds` mặc định = `listReadySourceIds`, luôn giao với nguồn được xem; `useWeb` chỉ được giữ khi `notebooks.allow_web`; `connectionIds` chưa có bằng chứng (P5) nên bị bỏ khỏi phạm vi + báo `connections_unavailable`.
2. Bằng chứng = `retrieve()` (kho `local`, top 12) rồi nối thêm kho `web` (`providers/web.ts`: `generateText` + `tools.googleSearch` → `webSources` → `Evidence{provider:'web', locator.url}`; mock trả rỗng). Câu hỏi ≤ 3 từ được ghép với câu hỏi trước để truy hồi. `buildContext` đánh số `[1..n]`.
3. Prompt: system = `defaultChatSystemPrompt` (hoặc `user_settings.prompts.chat.system`) + `notebooks.system_instruction`; tin nhắn cuối = `NGUỒN … CÂU HỎI …`; lịch sử tối đa 10 lượt, `[n]` của lượt cũ bị bỏ (mỗi lượt đánh số lại). Không có bằng chứng nào → không gọi mô hình, trả câu cố định "Không tìm thấy thông tin này trong các nguồn đã chọn…".
4. Hậu kiểm (`src/server/ai/citations.ts`, phần phân tích `[n]` dùng chung client ở `src/lib/citations.ts`): nhận `[1]`, `[1, 3]`, `[2-4]`, bỏ qua mã và `[1](url)`; loại số ngoài danh sách khỏi văn bản lưu; `sourcesUsed` khử trùng theo nguồn của các `[n]` thực dùng (`{key, sourceId, provider, title, url?, locators[], numbers[]}` — kiểu `SourceUsed` trong `src/lib/chat.ts`, `messages.sources_used` giờ là mảng object chứ không phải mảng id); `insufficientEvidence` = không có bằng chứng, hoặc **mọi** bằng chứng đều có `similarity` và max < `INSUFFICIENT_SIMILARITY_THRESHOLD` (0,25), hoặc câu trả lời chứa câu "Không tìm thấy thông tin này trong các nguồn đã chọn". Bằng chứng không có `similarity` (web, chỉ khớp từ khoá) coi là liên quan.
5. Lưu `messages` (citations = toàn bộ `Evidence[]` đã đánh số, scope, model, usage). *Lưu ý với embedding giả lập (mock) băm theo từ:* cosine chỉ vượt 0,25 khi câu hỏi trùng nhiều từ với đoạn văn — các test/e2e dùng nguồn ngắn và câu hỏi trùng từ.

**Ghi chú → Nguồn**: `POST to-source` tạo `sources(kind='text', mime='text/markdown', raw_text = content_md, metadata.note_id)` + job `ingest_source`, đặt `notes.is_source`. Sửa ghi chú (autosave) → cập nhật `raw_text/title/visibility` của nguồn ngay, xử lý lại gộp bằng **một** job chờ (`run_at` + 15 giây; nếu đã có job `queued` cho nguồn thì không xếp thêm). Xoá nguồn → `is_source=false` (`deleteSource`). Xoá ghi chú không xoá nguồn đã tạo.

**UI**
- `/n/[id]`: cột giữa là `MainTabs` (Trò chuyện · Ghi chú); tab Trò chuyện luôn được giữ (ẩn) khi chuyển tab để không mất câu trả lời đang stream. `/n/[id]/notes`: `NotesPanel` toàn trang. Móc "Chia sẻ vào chat" cho P4: prop `onShareToChat(note)` của `NotesPanel` / `onShareNoteToChat` của `MainTabs` (không truyền thì mục menu không hiện).
- Export tái dùng: `MarkdownWithCitations` (`components/chat/markdown-with-citations.tsx`: GFM + chip `[n]` có tooltip, `evidence[]`, `onCitationOpen`, `streaming`), `CitationChip`, `remarkCitations`, `markdownComponents`; `useChat`, `askStream`/`readAskStream` (`lib/chat-stream.ts`); `noteExtensions()` (Tiptap + `@tiptap/markdown`) và `normalizeEditorMarkdown` (bỏ escape `\[1\]`).
- i18n của mô-đun nằm ở `src/i18n/modules/chat.{vi,en}.ts` (trải vào `vi`/`en`).
- Cài đặt → Prompt có thêm mục "Trò chuyện (Chat AI)" (`prompts.chat`: `system` thay prompt mặc định; `user` là mẫu có `{{question}}`); Cài đặt sổ tay giải thích chỉ dẫn hệ thống được ghép *sau* prompt chat.
