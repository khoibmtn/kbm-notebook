# KBM Notebook

Ứng dụng web học tập và cộng tác tri thức với AI (kiểu NotebookLM + chat nhóm): gom nguồn tài liệu vào **sổ tay**, hỏi đáp có trích dẫn, tạo tài liệu/bài thuyết trình trong Studio và trao đổi cùng nhóm theo thời gian thực.

Trạng thái: **P0 – Nền tảng** (xem [docs/04-roadmap.md](docs/04-roadmap.md)). Đã có: đăng ký/đăng nhập, CRUD sổ tay, thành viên & lời mời, phân quyền, cài đặt (hồ sơ, khoá Gemini mã hoá, prompt), lớp `AiProvider`, lưu trữ tệp, hàng đợi job, Socket.IO, i18n vi/en. Các mô-đun Nguồn, Chat AI, Ghi chú, Studio, Chat nhóm hiện là trang "Đang phát triển".

## Công nghệ

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind CSS v4 + shadcn/ui · Drizzle ORM + PostgreSQL 16 (pgvector, pg_trgm) · better-auth · Socket.IO · `@google/genai` · Vitest · Playwright.

## Yêu cầu

- Node.js >= 22, pnpm >= 10
- PostgreSQL 16 có extension `vector` (pgvector >= 0.7) và `pg_trgm`

## Cài đặt

```bash
pnpm install
cp .env.example .env        # rồi chỉnh các giá trị (xem bảng dưới)
createdb kbm_notebook       # hoặc tạo DB tuỳ ý và đặt DATABASE_URL
pnpm db:migrate             # tạo bảng + extension
pnpm dev                    # http://localhost:3000
```

Sinh khoá bí mật:

```bash
openssl rand -base64 32     # BETTER_AUTH_SECRET
openssl rand -hex 32        # APP_ENCRYPTION_KEY (32 byte hex)
```

### Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Bí mật và URL gốc của better-auth |
| `NEXT_PUBLIC_APP_URL` | URL công khai của ứng dụng |
| `APP_ENCRYPTION_KEY` | Khoá AES-256-GCM (64 ký tự hex) để mã hoá API key/credential |
| `AI_PROVIDER` | `gemini` (mặc định) hoặc `mock` (dữ liệu giả lập cho dev/test) |
| `GEMINI_API_KEY` | Khoá Gemini dùng chung của máy chủ (tuỳ chọn; mỗi người dùng có thể nhập khoá riêng ở Cài đặt → AI) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Bật đăng nhập Google (tuỳ chọn) |
| `CONNECTORS_ALLOW_PRIVATE_HOSTS` | `true` (mặc định) cho phép người dùng trỏ NotebookLM Bridge tới localhost/LAN (có công tắc đồng ý riêng); đặt `false` trên máy chủ dùng chung để chặn SSRF vào mạng nội bộ |
| `STORAGE_DIR`, `MAX_UPLOAD_MB` | Thư mục lưu tệp (mặc định `./storage`) và giới hạn tải lên (mặc định 50) |
| `PORT` | Cổng máy chủ (mặc định 3000) |
| `GEMINI_CHAT_MODEL`, `GEMINI_ARTIFACT_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_IMAGE_MODEL` | Ghi đè model mặc định (tuỳ chọn) |

Nếu chưa có khoá Gemini: dùng `AI_PROVIDER=mock`, hoặc nhập khoá ở **Cài đặt → AI** rồi bấm "Kiểm tra key". Gọi tính năng AI khi chưa cấu hình trả HTTP 412 (`ai_not_configured`).

## Kết nối ngoài (NotebookLM, Google Drive)

Cài đặt → **Kết nối** có ba kênh; chi tiết, giới hạn và mô hình bảo mật ở [docs/07-ket-noi.md](docs/07-ket-noi.md):

- **NotebookLM Bridge** (thử nghiệm, **không chính thức**): sidecar Python/FastAPI do bạn tự chạy ([bridge/notebooklm/README.md](bridge/notebooklm/README.md)) bọc thư viện cộng đồng `notebooklm-py`. Cho phép liệt kê notebook, hỏi đáp có trích dẫn, ghi ghi chú/nguồn ngược sang NotebookLM và nhập nguồn về. Nhập URL + `BRIDGE_TOKEN` rồi bấm **Kiểm tra kết nối** (gọi `GET /health` thật). Có thể hỏng bất cứ lúc nào khi Google đổi giao thức; nên dùng tài khoản Google riêng.
- **NotebookLM Enterprise** (Preview): API chính thức của Google Cloud (Discovery Engine v1alpha) — quản lý notebook/nguồn/chia sẻ, **không có hỏi đáp**. Nhập số dự án, location và access token hoặc service account JSON.
- **Google Drive**: nhập tệp vào Nguồn (Docs/Slides/Sheets → docx/pptx/xlsx). Cần `GOOGLE_CLIENT_ID/SECRET` trên máy chủ; người dùng tự cấp quyền `drive.readonly`.

Trong sổ tay: cột Nguồn → **Kết nối ngoài** → "Kết nối notebook"; bật kết nối trong nút phạm vi của khung Chat để hỏi đáp qua NotebookLM. Credential được mã hoá phía máy chủ, thuộc người tạo kết nối và chỉ dùng chung với thành viên khi họ bật "Chia sẻ với thành viên". Trạng thái kết nối luôn đến từ lời gọi thật, không có dữ liệu giả.

## Lệnh

| Lệnh | Tác dụng |
|---|---|
| `pnpm dev` | Chạy custom server (`server.ts`: Next + Socket.IO + job worker) bằng `tsx` |
| `pnpm build` | `next build` + bundle `server.ts` → `dist/server.js` |
| `pnpm start` | Chạy bản production (`node dist/server.js`) |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm test` | Vitest (unit + API + component). Tự tạo lại DB `kbm_notebook_test` và migrate; cần quyền tạo DB trên máy chủ Postgres (đổi bằng `TEST_DATABASE_URL`) |
| `pnpm e2e` | Playwright smoke test (tự chạy `pnpm dev` ở cổng 3200; dùng Chromium cài sẵn, có thể đặt `PW_CHROMIUM_PATH`). Dừng dev server đang chạy trước vì Next chỉ cho một tiến trình dev mỗi thư mục |
| `pnpm db:generate` | Sinh migration từ `src/server/db/schema.ts` |
| `pnpm db:migrate` | Áp dụng migration trong `drizzle/` |
| `cd bridge/notebooklm && pytest` | Test sidecar NotebookLM Bridge (không cần đăng nhập Google) |
| `pnpm db:push` | Đẩy schema trực tiếp (chỉ dùng khi dev) |

## Cấu trúc

```
src/app            Route (App Router) + API route handlers
src/components     UI (ui/ = shadcn, notebook/, dashboard/, settings/, auth/, shared/)
src/server         Code chỉ chạy server: db, auth, ai, storage, jobs, notebooks, settings, chat/realtime
src/lib, src/i18n  Tiện ích dùng chung, validator zod, từ điển vi/en
server.ts          Custom server (Next + Socket.IO + worker)
drizzle/           Migration SQL
tests/             unit, api, components, e2e
docs/              Thiết kế: nghiên cứu, kiến trúc, mô hình dữ liệu, roadmap, UI, kết nối ngoài (07)
bridge/notebooklm/ Sidecar NotebookLM Bridge (Python, không chính thức)
```

Chi tiết kiến trúc, hợp đồng (`AiProvider`, `StorageAdapter`, jobs, realtime, phân quyền) và các lưu ý triển khai P0: [docs/02-kien-truc.md](docs/02-kien-truc.md) (mục 6). Lược đồ dữ liệu: [docs/03-mo-hinh-du-lieu.md](docs/03-mo-hinh-du-lieu.md). Quy ước mã nguồn và roadmap: [docs/04-roadmap.md](docs/04-roadmap.md).

## Quy ước chính

- Mọi route handler: `const { user } = await requireUser(); await requireNotebookRole(user.id, id, "viewer")`, bọc bằng `handleRoute()`; lỗi trả `{ "error": { "code", "message" } }`.
- Validate input bằng zod (`src/lib/validators/*`, `parseBody`).
- Chuỗi giao diện qua `t("khoá")` / `useT()`; `src/i18n/vi.ts` là nguồn chính.
- Không dữ liệu giả trong UI; tính năng chưa có hiển thị "Đang phát triển".
- Code server-only đặt trong `src/server/**` và `import "server-only"`.
