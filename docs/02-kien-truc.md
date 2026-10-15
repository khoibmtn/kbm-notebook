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
