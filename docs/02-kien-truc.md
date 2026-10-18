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
> Kết quả rà soát bảo mật và trạng thái xử lý từng phát hiện: [docs/10-ra-soat-bao-mat.md](10-ra-soat-bao-mat.md).

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
- Chấp nhận lời mời (`POST /api/invites/[token]/accept`) yêu cầu email tài khoản **trùng** email được mời **và đã xác minh** (khi `AUTH_REQUIRE_EMAIL_VERIFICATION` bật — mặc định ở production; xem `docs/10-ra-soat-bao-mat.md`), người mời còn đủ quyền gán vai trò đó. Lời mời hết hạn sau 7 ngày. Mời email đã có tài khoản **đã xác minh** → thêm thẳng vào `notebook_members` + `channel_members` của kênh `general`; chưa xác minh → tạo lời mời (liên kết).
- Chỉ owner được đặt `defaultArtifactVisibility = public`. Chủ sở hữu bất biến qua PATCH/DELETE member; đổi chủ qua `POST /api/notebooks/[id]/transfer` (owner cũ → admin).
- Quy ước JSON của API là camelCase (`systemInstruction`, `allowWeb`, `defaultArtifactVisibility`, `coverColor`).

**AI**
- Thêm `AiProviderError` (key sai/hết quota… → 400/429/502, mã `ai_provider_error`) bên cạnh `AiNotConfiguredError` (412, mã `ai_not_configured`). `TextRequest.__mockJson` chỉ để test với `MockAiProvider`.
- Model mặc định cấu hình qua env (`GEMINI_CHAT_MODEL`, `GEMINI_ARTIFACT_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_IMAGE_MODEL`) hoặc `user_settings`; mặc định `gemini-3.5-flash` (chat; đổi từ alias `gemini-flash-latest` ngày 2026-10-18 vì alias hay quá tải) / `gemini-pro-latest` / `gemini-embedding-001`. Embedding luôn chuẩn hoá L2 sau khi cắt `outputDimensionality` (768).
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

## 9. Ghi chú triển khai P2 (Chat AI + Ghi chú)

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
- Export tái dùng: `MarkdownWithCitations` (`components/chat/markdown-with-citations.tsx`: GFM + chip `[n]` có tooltip, `evidence[]`, `onCitationOpen`, `streaming`), `CitationChip`, `remarkCitations`, `markdownComponents`; `useChat`, `askStream`/`readAskStream` (`lib/chat-stream.ts`); `markdownExtensions()` (Tiptap + `@tiptap/markdown`, `components/shared/markdown-extensions.ts`) và `normalizeEditorMarkdown` (bỏ escape `\[1\]`).
- i18n của mô-đun nằm ở `src/i18n/modules/chat.{vi,en}.ts` (trải vào `vi`/`en`).
- Cài đặt → Prompt có thêm mục "Trò chuyện (Chat AI)" (`prompts.chat`: `system` thay prompt mặc định; `user` là mẫu có `{{question}}`); Cài đặt sổ tay giải thích chỉ dẫn hệ thống được ghép *sau* prompt chat.

## 10. Ghi chú triển khai P3 (Studio: khung artifact, generator, editor, xuất)

**Cấu trúc**
- `src/lib/artifacts/` (dùng chung client+server): `content.ts` (zod + kiểu nội dung từng loại), `meta.ts` (tuỳ chọn tạo, DTO, định dạng xuất theo loại, `isAsyncExport`), `citations.ts` (hậu kiểm `[n]`), `mindmap-tree.ts` (thao tác thuần trên cây).
- `src/server/artifacts/`: `schemas.ts` (schema ĐẦU RA của model + `toJsonSchema`), `prompt.ts` (`composePrompt`), `evidence.ts` (chiến lược lấy bằng chứng), `generators/*`, `exporters/*`, `service.ts`, `export-service.ts`, `registry.ts` (điểm nối engine slide/infographic). Job: `jobs/handlers/generate-artifact.ts`, `export-artifact.ts` (đăng ký trong `server.ts`).
- UI: `src/components/studio/*` (`StudioPanel`, `CustomizeDialog`, `ArtifactPage`, `ArtifactBody`, `ShareDialog`, các view theo loại, `engines.tsx`), dùng chung `src/components/shared/markdown-editor.tsx` (Tiptap, props `{value, onChange, readOnly, ...}`; CŨNG là trình soạn của Ghi chú `NoteEditor`, bộ extension ở `markdown-extensions.ts`) và `markdown-view.tsx` (React, không `dangerouslySetInnerHTML`). Chuỗi UI ở `src/i18n/modules/studio.{vi,en}.ts` (trải làm mục đầu của `vi`/`en`).

**Vòng đời & phiên bản**
- `POST /api/notebooks/[id]/artifacts` (editor+) tạo hàng `queued` + job `generate_artifact` → `generating` (tiến độ qua `artifact:status`, `stage` + `progress`) → `ready`/`failed`. Thiếu nguồn `ready` trong phạm vi → 400 `no_sources`; loại chưa có engine → 501 `not_implemented` (không tạo hàng).
- Mỗi lần đổi nội dung (sinh, sửa, khôi phục, tạo lại) = một dòng `artifact_versions` mới (`version_no` + 1, khoá hàng artifact trong giao dịch → lưu đồng thời không trùng số). `PATCH` nhận `baseVersionId`; lệch phiên bản hiện tại → 409 `version_conflict`. **Khôi phục không ghi đè**: tạo phiên bản mới mang nội dung cũ. Tạo lại giữ lịch sử; lỗi khi tạo lại để `failed` nhưng phiên bản cũ vẫn xem được. Nhân bản = artifact mới (`forked_from_id`, phiên bản 1 = nội dung hiện tại). Xoá là xoá mềm.
- Lỗi vĩnh viễn (không có nguồn, thiếu khoá AI, 4xx, 501) → `failed` ngay, job không retry; lỗi tạm/sai schema của model → retry theo backoff của worker, lượt cuối → `failed` kèm thông báo. Không bao giờ thay bằng nội dung giả.
- Model = `generation_config.model` → `user_settings.default_artifact_model` → mặc định hệ thống. Tên artifact tự đặt (`titleAuto`) lấy tiêu đề model đề xuất; người dùng đã đặt tên thì giữ.

**Prompt** = `defaults.ts[type]` ⊕ `user_settings.prompts[type]` (ghi đè system/user/options) ⊕ prompt riêng ở hộp "Tuỳ chỉnh" (`{{instructions}}`) ⊕ tuỳ chọn (`{{options}}`; ngôn ngữ mặc định tiếng Việt). `GET /api/settings/prompts` trả thêm `defaults` và `effective` để hộp Tuỳ chỉnh hiển thị prompt đang áp dụng.

**Chiến lược bằng chứng** (`evidence.ts`): phạm vi = `scope.sourceIds` ∩ nguồn `ready` người tạo được dùng. Nếu tổng token chunk ≤ ngân sách của loại (báo cáo/đề cương/timeline/slide: **60k**; infographic/quiz/thẻ/bảng 40k; mindmap/FAQ 32k; note 16k) → lấy **toàn bộ** chunk theo thứ tự tài liệu. Ngược lại: một truy vấn theo yêu cầu riêng trên toàn phạm vi + với **mỗi nguồn** một truy vấn (tiêu đề + đầu tóm tắt) và một truy vấn cho từng `key_topics` (tối đa 40, chia vòng tròn giữa các nguồn), `retrieve()` hybrid mỗi truy vấn, gộp theo chunk (cộng điểm RRF), chọn tới hết ngân sách rồi sắp lại theo (nguồn → vị trí). Sau đó `buildContext` đánh số `[1..n]`.

**Trích dẫn** (`lib/artifacts/citations.ts`): model trả `[n]` hoặc mảng `citations` theo số gốc; `CitationRemapper` chuẩn hoá `[1, 2]`/`[2-4]` → `[1][2]`…, loại số không tồn tại, bỏ qua khối code/code inline/liên kết, rồi đánh số lại theo thứ tự dùng đầu tiên → `content.evidence` chỉ chứa bằng chứng thật sự được trích; `citations` trong câu hỏi/thẻ/nút/dòng bảng trỏ vào `evidence[n-1]`.

**Schema đầu ra riêng của model** (docs/03 là schema LƯU): mindmap sinh danh sách phẳng `{id, parentId}` (tránh schema đệ quy) rồi dựng cây (cha thiếu → gắn gốc, chu trình bị loại, cắt theo `depth`); data_table sinh `cells: string[]` theo thứ tự cột rồi lưu `rows: [{cells: {key: value}, citations}]`; quiz: câu hỏng (đáp án không khớp lựa chọn) bị loại chứ không sửa bừa.

**Xuất** (`POST /api/artifacts/[id]/export {format, versionId?}`; người xem được artifact đều xuất được; tệp lưu `files` + `artifact_exports`, tải qua `/api/files/[id]` theo luật `canViewArtifact` có sẵn ở `storage/files.ts`):
- Đồng bộ (200 `{export}`): `docx` (markdown → `docx`, danh sách/bảng/định dạng thật), `md`, `csv` (BOM; chống CSV injection; quiz/thẻ/bảng), `apkg_tsv` (Anki: `front\tback\ttags` + chỉ thị `#separator/#html/#tags`), `json`, `pptx`/`svg` infographic qua engine.
- Bất đồng bộ (202 `{jobId}`, job `export_artifact`, sự kiện `artifact:export` tới người yêu cầu, hoặc poll `GET /exports?jobId=`): `pdf` (HTML an toàn → Chromium `page.pdf`; Chromium không chạy được → dự phòng LibreOffice `soffice --convert-to pdf` qua DOCX), `png`/`svg` của mindmap (markmap trong Chromium: SVG độc lập + ảnh x2). Chromium tìm theo `PW_CHROMIUM_PATH` → `/opt/pw-browsers/chromium-*` (như `playwright.config.ts`); trang xuất bị chặn mọi request mạng.
- Markdown/HTML trong nội dung artifact **không bao giờ** được chèn nguyên văn (token → DOCX/HTML/React; liên kết chỉ http/https/mailto).

**Chia sẻ**: `PATCH …/share {visibility, rotateToken?}` (editor+; `public` chỉ chủ sổ tay; `link` sinh/xoay `share_token`), `GET/POST …/shares`, `DELETE …/shares/[id]` (theo email hoặc userId, vai trò `view|edit`; email chưa có tài khoản được giữ và tự khớp). Xem công khai: `GET /api/share/[token]` + trang `/s/[token]` (chỉ `link`/`public`, 404 chung khi sai/đã xoay/đã đổi chế độ), `/a/[artifactId]` (public hoặc chia sẻ riêng cho người ngoài sổ tay; thành viên được chuyển sang trang trong ứng dụng). Quyền sửa = editor+ hoặc chia sẻ `edit`; viewer không tạo/sửa/xoá (403); artifact `private` của người khác là 404 kể cả với owner sổ tay.

**Nối engine slide/infographic**: duy nhất ở `src/server/artifacts/registry.ts` (server, `registerDefaultEngines()`) và `src/components/studio/engines.tsx` (client, `clientEngines`). Đã nối engine thật — xem §11. Khi một engine bị gỡ (test) thì tạo/xuất trả 501 `not_implemented`.

**Mock cho dev/test**: `TextRequest.__mockKey` (`artifact:<type>`); `registerMockJson(key, json)` / `registerMockJsonFn(key, fn)` / `clearMockJson()` trong `ai/mock.ts`; biến `MOCK_AI_FIXTURES_DIR` đọc `<khoá>.json` (dấu `:` → `_`, vd `artifact_quiz.json`); không có thì `mock-artifacts.ts` dựng JSON hợp schema từ chính các câu trong ngữ cảnh (tiêu đề gắn "[mock]") để chạy được toàn luồng khi chưa có khoá Gemini.

**Thay đổi ngoài thư mục Studio**: thêm `ArtifactVersionRow`/`ArtifactExportRow` (kiểu) vào `db/schema.ts` — **không có migration**; thêm `artifact:export` vào `RealtimeEvent`; `docx` chuyển sang `dependencies`; thêm `@tiptap/*`, `markmap-*`, `d3`, `marked`, `playwright-core`.

## 11. Tích hợp

**Nối engine slide/infographic vào khung Studio**
- `registry.ts` đăng ký engine thật qua `registerDefaultEngines()` (chạy khi nạp module; test có thể `registerEngines({ slide_deck: null })` để mô phỏng thiếu engine hoặc tiêm engine giả, rồi gọi lại `registerDefaultEngines()`). `SlideDeckEngine` có thêm `editSlide` và `renderHtml`, `InfographicEngine` có thêm `renderHtml`. Engine kiểm tra nội dung bằng schema chặt (`slideDeckSchema`/`infographicSchema`) ở ranh giới xuất/sửa: nội dung hỏng trả 400 `invalid_content`, không 500. `components/studio/engines.tsx` xuất `clientEngines = { SlideEditor, InfographicView }`; thẻ "Bài thuyết trình"/"Infographic" không còn bị khoá.
- Ảnh: `generateSlideDeck` trả `image.dataUrl`; job `generate_artifact` gọi `persistSlideImages` (`artifacts/slide-images.ts`) để lưu từng ảnh vào kho tệp (chủ tệp = người tạo artifact), thay bằng `image.fileId` và xoá `dataUrl` trước khi ghi phiên bản. PPTX nhận `resolveImage` (Buffer, có kiểm quyền); editor/HTML nhận `resolveImageUrl` → `/api/files/[id]`. Luật truy cập tệp mới (`storage/files.ts`): ai `canViewArtifact` đều đọc được ảnh được tham chiếu bởi một phiên bản của artifact (`jsonb_path_exists` trên `$.slides[*].image.fileId` / `$.imageFileId`); khách mở liên kết chia sẻ đọc ảnh qua `/api/files/[id]?share=<token>`.
- API mới: `POST /api/artifacts/[id]/slides/[slideId]/ai-edit {instruction, baseVersionId?}` (editor+; dựng lại `contextText` từ `content.evidence` bằng `buildContext`, lưu phiên bản mới, trả `{artifact, version}`); `POST /api/artifacts/[id]/images` (multipart `file`, kiểm bằng byte thật PNG/JPEG/GIF/WebP, trả `{fileId,url}`).
- Xuất: slide deck có `pptx`, `pdf` (HTML in `renderSlideDeckHtml` → Chromium `page.pdf`, ảnh được nhúng thành data URL vì Chromium chạy chặn mạng), `json`; infographic có `svg`, `png`, `pdf` (`renderInfographicHtml`), `json`. PDF/PNG chạy bằng job `export_artifact`.
- Trang artifact nối `onAiEdit` (lưu bản nháp trước rồi gọi API), `onExport` (lưu nháp rồi xuất), `onEvidenceClick` (mở Source viewer ở tab mới bằng `sourceViewerHref` để không mất bản nháp) và `onImageUpload`.

**Tích hợp chéo giữa các mô-đun**
- "Chia sẻ vào chat": `ShareToChatProvider` (`components/team-chat/share-to-chat-provider.tsx`, gắn trong `/n/[id]/layout.tsx`) giữ MỘT hộp `ShareToChatDialog` cho cả sổ tay; nơi nào cũng gọi `useShareToChat()?.({ type, id, title })` (null khi không có provider → ẩn mục menu). Đã nối vào: Ghi chú (menu của `NotesPanel`, mặc định dùng provider; chỉ ghi chú `shared`), Studio (menu ⋯ của artifact + nút trên thanh tiêu đề trang artifact; chỉ khi `ready` và không `private`), thẻ nguồn (menu ⋯, chỉ nguồn `ready` không riêng tư). Server vẫn là nơi kiểm quyền cuối cùng.
- Liên kết sâu từ thẻ trong chat nhóm: `/n/[id]/notes?note=<id>` (trang Ghi chú toàn chiều rộng → `NotesPanel initialNoteId`), `/n/[id]/sources?source=<id>` (→ `SourcesPanel initialViewSourceId` mở Source viewer), `/n/[id]/sources?add=1` mở hộp "Thêm nguồn" (dùng bởi bảng lệnh), `/n/[id]/team?channel=<id>`.
- Di động (< 1024px): thanh tab dưới của `NotebookWorkspace` có thêm tab "Nhóm" (`team` slot = `TeamChat`) kèm huy hiệu tin chưa đọc (`useTeamUnread`).
- Bảng lệnh ⌘K / Ctrl+K (`components/shared/command-palette.tsx`, gắn ở `(app)/layout.tsx`, nút mở ở `AppHeader` và thanh trên của sổ tay; sự kiện `kbm:open-command-palette`): tìm sổ tay (`/api/notebooks`), trong sổ tay còn tìm nguồn, ghi chú, artifact, kênh nhóm (các API danh sách hiện có, lọc ở máy khách, **không phân biệt dấu** — `foldVi`/`paletteFilter`); hành động nhanh: Tạo sổ tay, Thêm nguồn, Tạo từng loại artifact (editor+ theo vai trò của sổ tay lấy từ danh sách sổ tay), đi tới các trang của sổ tay.
- Dọn khoá i18n giữ chỗ không còn dùng: `{sources,chat,notes,studio,team}.empty.{title,description}`, `module.comingSoon.description`, `studio.engine.*`, `studio.{disabled,badge}.noEngine`, `studio.editor.*` (thanh công cụ soạn thảo dùng chung khoá `notes.editor.*`).

## 12. Ghi chú triển khai P5 (Kết nối)

Chi tiết đầy đủ, API và mô hình bảo mật: [docs/07-ket-noi.md](07-ket-noi.md). Tóm tắt các điểm khác/bổ sung so với thiết kế ban đầu:

- **Schema**: thêm cột `user_settings.connectors_enc text` (migration `0001_connectors_enc.sql`) giữ JSON mã hoá cài đặt Bridge/Enterprise của người dùng. Các bảng `notebook_connections` / `connection_sources` dùng nguyên như thiết kế; credential được **chụp** vào `credential_enc` khi tạo kết nối.
- **`Evidence`** (providers/types.ts) có thêm `kind?: 'chunk' | 'external_answer' | 'web'`, `connectionId?`, `externalUrl?`. `buildSourcesUsed` khoá nguồn ngoài theo `connectionId` để hai kết nối không bị gộp.
- **Provider**: `providers/notebooklm-bridge.ts` (`bridgeResultToEvidence` thuần + `NotebookLmBridgeProvider`, mỗi kết nối một instance) và `providers/notebooklm-enterprise.ts` (`retrieve()` ném `501 not_supported`; chỉ có helper liệt kê/tạo/thêm nguồn/chia sẻ). Client HTTP ở `src/server/connectors/{http,bridge-client,enterprise-client,drive}.ts`; nghiệp vụ kết nối ở `connections.ts`; cài đặt người dùng ở `settings.ts`.
- **`prepareAsk`** (`chat/ask.ts`): `scope.connectionIds` → `resolveChatConnections` (403 nếu của người khác chưa chia sẻ; id lạ/Enterprise → bỏ qua + `connections_unavailable`) → truy hồi song song cục bộ + kết nối + web; thứ tự bằng chứng **cục bộ → kết nối → web**. Truy hồi chạy **trước** khi lưu tin nhắn người dùng (lỗi kết nối không để lại tin nhắn mồ côi). `ScopeAdjustReason` có thêm `connection_error` (sự kiện `scope_adjusted` kèm `detail`; `AskResult.scopeAdjustmentDetails`).
- **SSRF của Bridge**: `connectorHttp` cho phép host nội bộ chỉ khi người dùng bật công tắc *và* quản trị viên máy chủ đặt `CONNECTORS_ALLOW_PRIVATE_HOSTS=true` (mặc định `false`); luôn chặn link-local/metadata/CGNAT (`src/server/net/ip-policy.ts`); không theo redirect; không phản chiếu nội dung thô của máy chủ ngoài.
- **Ingest**: `kind='drive'` được pipeline xử lý như tệp (`extractForSource`); `createSourceFromFile/Text` nhận thêm `kind`/`metadata`.
- **UI**: `src/components/connectors/*` (thẻ kết nối, hộp chọn notebook, nhập nguồn, tab Drive, menu "Lưu vào NotebookLM"), `components/settings/connectors-settings.tsx`; i18n `src/i18n/modules/connectors.{vi,en}.ts`.
- **Sidecar**: thêm `GET /notebooks/{id}/sources/{sourceId}/fulltext` (+ pytest).

## 13. Ghi chú triển khai P6 (Cộng đồng, tìm kiếm toàn cục, hoàn thiện, triển khai)

**Schema** — migration `0002_community_search`: bảng `notebook_join_requests(id, notebook_id, user_id, message, status 'pending'|'accepted'|'rejected', created_at, decided_at, decided_by)` (chỉ mục duy nhất một yêu cầu `pending` mỗi người/sổ tay); chỉ mục tìm kiếm: GIN `to_tsvector('simple', title || ' ' || content_md)` + trigram tiêu đề cho `notes`, trigram tiêu đề + chỉ mục từng phần `visibility='public'` cho `artifacts`, GIN `to_tsvector('simple', coalesce(content_md,''))` cho `artifact_versions`, trigram cho `groups.name`. Các bảng `artifact_likes/comments`, `groups*`, `notebooks.is_public/public_slug` đã có từ P0 và được dùng nguyên.

**Explore & công khai** (`src/server/community/*`, `src/lib/community.ts`, `src/components/community/*`)
- `GET /api/explore/{artifacts,notebooks,groups}` (cần đăng nhập, 24 mục/trang theo offset, `hasMore` bằng cách lấy 25). Artifact công khai = `visibility='public'`, `status='ready'`, chưa xoá, sổ tay chưa xoá; tên sổ tay chỉ lộ khi sổ tay cũng `is_public` (nếu không: "Sổ tay riêng"). Sắp xếp `new|likes`, lọc `type`, tìm `ILIKE` theo tiêu đề.
- **Thích/bình luận** dùng `loadArtifactAccess` ⇒ cùng luật `canViewArtifact` (artifact riêng tư của người khác 404 kể cả với owner sổ tay). `POST/DELETE /api/artifacts/[id]/like` idempotent; `GET` cho cả khách (xem số liệu). Bình luận: tối đa 2000 ký tự, 20/phút, hiển thị bằng `RichText` (markdown-lite của chat nhóm, không HTML thô); xoá được bởi tác giả hoặc admin+ của sổ tay chứa artifact.
- `/a/[artifactId]` có `ArtifactSocial`; thành viên sổ tay xem artifact công khai ngay tại đó (artifact chia sẻ riêng vẫn chuyển vào ứng dụng). `SharedArtifactView` chỉ dựng trình xem sau khi mount (slide/infographic đo văn bản ở trình duyệt nên SSR gây lệch hydration); `DndContext` của slide có `id` cố định.
- **Sổ tay công khai**: `PATCH /api/notebooks/[id]/public {isPublic, slug?}` (CHỈ owner; slug tự sinh từ tiêu đề, duy nhất, 3–60 ký tự `a-z0-9-`, 409 `slug_taken`; tắt công khai vẫn giữ slug). Trang `/p/[slug]` (không cần đăng nhập, `noindex`) và `GET /api/public/notebooks/[slug]` chỉ truy vấn tiêu đề, mô tả, emoji, màu bìa, tên chủ và danh sách artifact CÔNG KHAI — **không bao giờ** nguồn, ghi chú, hội thoại, tin nhắn, thành viên (test khẳng định danh sách khoá của phản hồi và không chứa chuỗi bí mật).
- **Yêu cầu tham gia**: `POST /api/notebooks/[id]/join-requests` (người đăng nhập chưa là thành viên, sổ tay phải công khai, 10/giờ) → thông báo `join_request` cho owner + admin (link `/n/<id>/members?requests=1`); `GET` (admin+); `POST …/[requestId]/accept|reject` (admin+, khoá hàng, đã xử lý → 409 `already_decided`; chấp nhận = `addMember(viewer)` + thông báo `join_accepted/rejected` cho người gửi). UI: nút ở `/p/[slug]`, mục "Yêu cầu tham gia" trong trang/hộp Thành viên.
- **Nhóm** (`/api/groups*`, trang `/g/[slug]`): vai trò lưu bằng enum `member_role` — `owner`, `admin`, `viewer` (hiển thị "Thành viên"). `visibility='public'` = mở tham gia, `'private'` = chỉ theo lời mời (owner/admin thêm bằng email; người ngoài nhận 404, không lộ sự tồn tại). Liên kết sổ tay: người gọi phải là thành viên nhóm VÀ admin+ của sổ tay; gỡ: admin+ sổ tay hoặc admin nhóm. Thành viên nhóm thấy mọi sổ tay đã liên kết (sổ tay không truy cập được chỉ hiện tiêu đề + ổ khoá, không mô tả/emoji); người ngoài nhóm chỉ thấy những sổ tay họ đã là thành viên.

**Tìm kiếm toàn cục** (`GET /api/search?q=&types=&notebookId=&limit=`, `src/server/search/*`, trang `/search`)
- Phạm vi = sổ tay người gọi là thành viên (+ nhóm `public` = artifact công khai của cộng đồng, bỏ trùng với nhóm artifact của mình). Mỗi nhóm lọc đúng luật quyền: nguồn `shared` hoặc của mình (`canViewSource`), ghi chú `shared` hoặc của mình, artifact của mình / `notebook|link|public` / được chia sẻ riêng, tin nhắn chỉ trong kênh mình là thành viên (dùng chung điều kiện `messageMatches` với tìm trong sổ tay của P4; DM của người khác không bao giờ xuất hiện).
- Khớp: tiêu đề `ILIKE`; nội dung bằng `to_tsquery('simple', 'từ:* & từ:*')` (tiền tố, chuỗi tsquery dựng chỉ từ chữ/số Unicode nên không chèn được cú pháp). Đoạn nguồn dùng `ts_headline` (một đoạn/nguồn, xếp theo `ts_rank`); ghi chú/artifact/tin nhắn dùng `makeSnippet` ở máy chủ. Từ khớp được bao bằng ký tự điều khiển `\u0001…\u0002` (`HL_START/HL_END`) để client dựng `<mark>` — không HTML thô. **Phân biệt dấu** (không có `unaccent`); ⌘K ở máy khách vẫn không phân biệt dấu cho danh sách có sẵn.
- Liên kết sâu: nguồn `/n/<id>/sources/<sourceId>?chunk=<chunkId>`, ghi chú `/n/<id>/notes?note=`, artifact `/n/<id>/artifacts/<id>` (công khai: `/a/<id>`), tin nhắn `/n/<id>/team?channel=&message=`. Trang kết quả có lọc theo loại, `↑/↓` + `Enter`, `/` để tìm lại, URL đồng bộ `?q=`. Bảng lệnh ⌘K có mục "Tìm toàn bộ cho “…”" (luôn hiện cuối danh sách).

**Hoàn thiện**
- Hướng dẫn 3 bước ở dashboard rỗng (`OnboardingGuide`; mỗi nút tạo sổ tay rồi mở `sources?add=1` / `studio`); thanh mẹo lần đầu vào sổ tay (`TipBar`, localStorage `kbm:tip-dismissed`; server render luôn có thanh mẹo để không xê dịch bố cục lúc hydrate — người đã đóng thấy nó biến mất ngay sau hydrate).
- Dark mode: rà toàn bộ trang chính (chụp ảnh Playwright); bìa sổ tay pastel được làm dịu ở chế độ tối (`NotebookCover`). Responsive 390/820px: đo tràn ngang trên 31 trang × 2 cỡ; sửa lưới Explore (`grid-cols-1` + `min-w-0`).
- Rate limit (bảng `rate_limits`, 429 `rate_limited`, toast hiện thông điệp của máy chủ): sinh/tạo lại artifact 20/10 phút (`enforceArtifactRateLimit`, tính sau khi kiểm tra hợp lệ nên yêu cầu sai không tốn hạn mức), tin nhắn nhóm 120/phút, bình luận 20/phút, yêu cầu tham gia 10/giờ.
- `/dev/*`: `src/proxy.ts` rewrite sang 404 khi `NODE_ENV=production` (kể cả chưa đăng nhập) + các trang tự `notFound()`.
- Ranh giới lỗi: `error.tsx` cho `(app)` và `n/[notebookId]` (nút "Thử lại"), `not-found.tsx` cho sổ tay, `global-error.tsx`; chuỗi ở `community.{vi,en}.ts` (`error.*`).
- Truy cập: mọi nút chỉ có icon có `aria-label` (đã quét tự động toàn `src/`), hộp thoại có `DialogTitle`, vòng focus hiển thị trên nút/liên kết/thẻ.
- i18n mô-đun: `src/i18n/modules/community.{vi,en}.ts` (trải ở đầu `vi`/`en`).

**Triển khai**: `Dockerfile` (đa tầng, Chromium + tuỳ chọn LibreOffice), `docker-compose.yml` (`pgvector/pgvector:pg16`), `package.json` `build:server` bundle thêm `dist/migrate.js` (image tự migrate khi khởi động), `.env.example` đầy đủ; xem [08-trien-khai.md](08-trien-khai.md) và [09-kiem-thu.md](09-kiem-thu.md).

**Giới hạn đã biết**: tìm kiếm phân biệt dấu; Explore phân trang theo offset (có thể lệch khi dữ liệu đổi giữa hai lần tải); không có thông báo khi có bình luận mới; không có "huỷ yêu cầu tham gia" phía người gửi; nhóm chưa có chat/tài nguyên riêng (chỉ gom thành viên và liên kết sổ tay); Docker image chưa được build thử (không có daemon trong môi trường phát triển).

## 14. Ghi chú triển khai — rà soát bảo mật

Chi tiết từng phát hiện và trạng thái: [docs/10-ra-soat-bao-mat.md](10-ra-soat-bao-mat.md). Các điểm kiến trúc cần nhớ khi mở rộng:

- **Trích xuất tài liệu không chạy trong tiến trình chính**: `ingest/pipeline.ts` → `extractFileSandboxed/extractUrlSandboxed` (`ingest/extract-sandbox.ts`) chạy `extract.ts` trong `worker_threads` có timeout/giới hạn heap (`INGEST_EXTRACT_TIMEOUT_SEC`, `INGEST_EXTRACT_MAX_MB`). Production cần `dist/extract-worker.js` (do `pnpm build:server` tạo). Thêm loại tệp mới: chỉ sửa `extract.ts`, không gọi parser nặng ngoài worker.
- **Tải lên theo dòng**: mọi route nhận tệp dùng `storage/multipart.ts` (`receiveMultipart`) hoặc `formDataWithLimit`; không dùng `req.formData()` trực tiếp. `StorageAdapter.put` nhận `notebookId`/`origin` để tính quota.
- **Quyền đọc tệp**: thêm luật bằng `registerFileAccessRule`; ảnh của artifact phải được ghi bằng `registerArtifactFile` (không suy ra từ JSON).
- **Email là danh tính chỉ khi đã xác minh**: mọi chỗ khớp theo email dùng `verifiedEmailCondition()` / `requireTrustedEmail()` (`auth/email-verified.ts`).
- **Chính sách IP chung** cho URL do người dùng cung cấp: `server/net/ip-policy.ts` (đừng tự viết bảng dải IP mới).
- **Bất biến nguồn riêng tư**: artifact có `contains_private_sources` chỉ ở `private`; luồng mới tạo nội dung từ nguồn phải đi qua `resolveScopeSourceIds(..., { allowPrivate })` và `privateSourceIdsAmong`.
- **Route handler**: `handleRoute` từ chối request thay đổi trạng thái từ origin/site lạ; `parseBody` yêu cầu `Content-Type` JSON. Hạn mức thao tác tốn tiền ở `server/api/limits.ts`.
