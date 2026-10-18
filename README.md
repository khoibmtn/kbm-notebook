# KBM Notebook

Ứng dụng web học tập và cộng tác tri thức với AI (kiểu NotebookLM + chat nhóm): gom nguồn tài liệu vào **sổ tay**, hỏi đáp có trích dẫn, tạo tài liệu/bài thuyết trình trong Studio và trao đổi cùng nhóm theo thời gian thực.

Trạng thái: **P0–P6 đã hoàn thành** (xem [docs/04-roadmap.md](docs/04-roadmap.md)). Tất cả tính năng dưới đây chạy thật với PostgreSQL; chưa cấu hình AI thì giao diện báo rõ (HTTP 412), không có dữ liệu giả.

| Mô-đun | Trạng thái | Nội dung |
|---|---|---|
| Nền tảng (P0) | Hoàn thành | Đăng ký/đăng nhập (email + Google tuỳ chọn), sổ tay, thành viên & lời mời, phân quyền 4 vai trò, cài đặt (hồ sơ, khoá Gemini mã hoá, prompt), i18n vi/en, giao diện sáng/tối |
| Nguồn (P1) | Hoàn thành | Tải PDF/DOCX/PPTX/XLSX/MD/TXT/CSV/HTML, URL, văn bản; chunk + embedding pgvector; Source viewer có tô sáng trích dẫn |
| Chat AI + Ghi chú (P2) | Hoàn thành | Hỏi đáp streaming có trích dẫn `[n]`, từ chối khi thiếu bằng chứng, lưu Q&A, ghi chú Tiptap, ghi chú → nguồn |
| Studio (P3) | Hoàn thành | 10 loại artifact (báo cáo, quiz, thẻ nhớ, sơ đồ tư duy, bảng, **slide**, **infographic**…), phiên bản, nhân bản, chia sẻ, xuất PPTX/DOCX/PDF/PNG/SVG/CSV/MD |
| Chat nhóm (P4) | Hoàn thành | Kênh chung/chủ đề/DM realtime, mention, reaction, đính kèm, ghim, tìm kiếm, thông báo, thẻ artifact/nguồn/ghi chú |
| Kết nối (P5) | Hoàn thành; Bridge **thử nghiệm** | NotebookLM Bridge (không chính thức, có thể hỏng bất cứ lúc nào), NotebookLM Enterprise (Preview, không có hỏi đáp), Google Drive |
| Cộng đồng (P6) | Hoàn thành | **Khám phá** (artifact/sổ tay/nhóm công khai), thích & bình luận, công khai sổ tay `/p/<slug>` + yêu cầu tham gia, nhóm học tập `/g/<slug>` |
| Tìm kiếm toàn cục (P6) | Hoàn thành | `/search` + ⌘K: sổ tay, nguồn (đoạn trích), ghi chú, artifact, tin nhắn, cộng đồng; tôn trọng quyền xem |
| Hoàn thiện (P6) | Hoàn thành | Hướng dẫn làm quen, rà dark mode/responsive, giới hạn tần suất (429), ranh giới lỗi, truy cập (a11y) |
| Triển khai (P6) | Hoàn thành, **Docker chưa build thử** | `Dockerfile` + `docker-compose.yml` (pgvector pg16), [docs/08-trien-khai.md](docs/08-trien-khai.md) |

**Thử nghiệm / hạn chế đã biết**: NotebookLM Bridge dựa trên thư viện cộng đồng không chính thức; Enterprise chỉ quản lý notebook/nguồn (không hỏi đáp); tìm kiếm toàn cục phân biệt dấu tiếng Việt; Docker image chưa được build trong môi trường phát triển (không có daemon); realtime chạy trong một tiến trình (chưa có adapter Redis để nhân bản ngang).

## Công nghệ

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind CSS v4 + shadcn/ui · Drizzle ORM + PostgreSQL 16 (pgvector, pg_trgm) · better-auth · Socket.IO · `@google/genai` · Vitest · Playwright.

## Yêu cầu

- Node.js >= 22, pnpm >= 10
- PostgreSQL 16 có extension `vector` (pgvector >= 0.7) và `pg_trgm`

## Bắt đầu nhanh

Deploy 0 đồng lên Google Cloud Run (free tier) + Supabase bằng GitHub Actions — pipeline mới soạn, chưa chạy thử: [docs/08-trien-khai.md](docs/08-trien-khai.md#14-deploy-0-đồng-cloud-run-free-tier--supabase-github-actions), `scripts/gcp-bootstrap.sh`, `.github/workflows/deploy-cloud-run.yml`.

Docker (khuyến nghị cho triển khai; xem [docs/08-trien-khai.md](docs/08-trien-khai.md)):

```bash
cp .env.example .env     # đặt POSTGRES_PASSWORD, BETTER_AUTH_SECRET, APP_ENCRYPTION_KEY, BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL
docker compose up -d --build
```

## Cài đặt (phát triển)

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
| `CONNECTORS_ALLOW_PRIVATE_HOSTS` | `false` (mặc định) chặn NotebookLM Bridge ở localhost/LAN để tránh SSRF vào mạng nội bộ của máy chủ. Chỉ đặt `true` khi máy chủ chạy riêng cho một người/nhóm tin cậy và Bridge nằm trên máy/LAN đó (người dùng vẫn phải bật công tắc "Cho phép địa chỉ nội bộ" ở từng kết nối). Metadata đám mây luôn bị chặn |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Email chưa xác minh không được dùng làm danh tính (lời mời theo email, chia sẻ artifact theo email, chấp nhận lời mời bằng liên kết). Mặc định `true` ở production, `false` ở dev/test để không cần máy chủ mail |
| `SMTP_URL`, `EMAIL_FROM` | Gửi email xác minh qua SMTP (vd. `smtps://user:pass@smtp.example.com:465`). Để trống = ghi liên kết xác minh ra log máy chủ (`ConsoleEmailSender`, dùng cho dev) |
| `STORAGE_DIR`, `MAX_UPLOAD_MB` | Thư mục lưu tệp (mặc định `./storage`) và giới hạn mỗi tệp tải lên (mặc định 50) |
| `MAX_NOTEBOOK_STORAGE_MB`, `MAX_UPLOAD_REQUEST_MB` | Tổng dung lượng tệp mỗi sổ tay (mặc định 2048) và kích thước tối đa một request tải lên (mặc định 512); vượt → 413 |
| `UPLOAD_MAX_FILES_PER_10MIN`, `UPLOAD_MAX_MB_PER_HOUR` | Hạn mức tải lên theo người dùng (mặc định 30 tệp / 10 phút, 300 MB / giờ); vượt → 429 |
| `MAX_INGEST_TOKENS_PER_DAY` | Ngân sách token xử lý nguồn (embedding + tóm tắt) mỗi người dùng mỗi ngày (mặc định 2.000.000); cạn → nguồn `failed` / 429 |
| `INGEST_EXTRACT_TIMEOUT_SEC`, `INGEST_EXTRACT_MAX_MB` | Giới hạn thời gian (mặc định 120 giây) và bộ nhớ (mặc định 1024 MB) của worker trích xuất văn bản từ một tệp/trang |
| `TRUSTED_ORIGINS` | Origin tin cậy thêm (phân tách bằng dấu phẩy) cho cookie đăng nhập, kiểm tra Origin của API và Socket.IO khi triển khai sau proxy/tên miền khác |
| `PORT` | Cổng máy chủ (mặc định 3000) |
| `GEMINI_CHAT_MODEL`, `GEMINI_ARTIFACT_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_IMAGE_MODEL` | Ghi đè model mặc định (tuỳ chọn) |
| `PW_CHROMIUM_PATH` | Đường dẫn Chromium dùng xuất PDF/PNG/SVG của Studio (mặc định tìm trong `/opt/pw-browsers`); thiếu Chromium thì PDF dự phòng bằng LibreOffice (`soffice`) |
| `MOCK_AI_FIXTURES_DIR` | Chỉ với `AI_PROVIDER=mock`: thư mục chứa `artifact_<loại>.json` (vd `artifact_quiz.json`) làm đầu ra mẫu của generator |

Bảng đầy đủ mọi biến (kể cả `TRUSTED_ORIGINS`, `DB_POOL_MAX`, `HOSTNAME_BIND`, `POSTGRES_*`, `TEST_DATABASE_URL`, `E2E_PORT`) ở [docs/08-trien-khai.md](docs/08-trien-khai.md) và `.env.example`.

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
| `pnpm build` | `next build` + bundle `server.ts` → `dist/server.js`, worker trích xuất → `dist/extract-worker.js` (bắt buộc có khi chạy production) và `migrate.ts` → `dist/migrate.js` |
| `pnpm start` | Chạy bản production (`node dist/server.js`) |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm test` | Vitest (unit + API + component). Tự tạo lại DB `kbm_notebook_test` và migrate; cần quyền tạo DB trên máy chủ Postgres (đổi bằng `TEST_DATABASE_URL`) |
| `pnpm e2e` | Playwright e2e (tự chạy `pnpm dev` ở cổng `E2E_PORT`, mặc định 3200; dùng Chromium cài sẵn, có thể đặt `PW_CHROMIUM_PATH`). Dừng dev server đang chạy trước vì Next chỉ cho một tiến trình dev mỗi thư mục |
| `pnpm db:generate` | Sinh migration từ `src/server/db/schema.ts` |
| `pnpm db:migrate` | Áp dụng migration trong `drizzle/` |
| `cd bridge/notebooklm && pytest` | Test sidecar NotebookLM Bridge (không cần đăng nhập Google) |
| `pnpm db:push` | Đẩy schema trực tiếp (chỉ dùng khi dev) |
| `pnpm verify:gemini` | Kiểm chứng Gemini thật ngoài giao diện: model ID, embedding/ngưỡng, chat có trích dẫn, quiz/slide/infographic, ảnh, web grounding ([docs/11-kiem-chung-gemini.md](docs/11-kiem-chung-gemini.md)) |

## Cấu trúc

```
src/app            Route (App Router) + API route handlers
src/components     UI (ui/ = shadcn, notebook/, dashboard/, settings/, auth/, shared/, community/, studio/, chat/, team-chat/…)
src/server         Code chỉ chạy server: db, auth, ai, storage, jobs, notebooks, settings, chat, artifacts, team-chat, connectors, community, search
src/lib, src/i18n  Tiện ích dùng chung, validator zod, từ điển vi/en
server.ts          Custom server (Next + Socket.IO + worker)
drizzle/           Migration SQL
tests/             unit, api, components, e2e
docs/              Thiết kế: nghiên cứu, kiến trúc, mô hình dữ liệu, roadmap, UI, slide engine (06), kết nối ngoài (07), triển khai (08), kiểm thử (09)
bridge/notebooklm/ Sidecar NotebookLM Bridge (Python, không chính thức)
```

Chi tiết kiến trúc, hợp đồng (`AiProvider`, `StorageAdapter`, jobs, realtime, phân quyền) và các lưu ý triển khai P0: [docs/02-kien-truc.md](docs/02-kien-truc.md) (mục 6). Lược đồ dữ liệu: [docs/03-mo-hinh-du-lieu.md](docs/03-mo-hinh-du-lieu.md). Quy ước mã nguồn và roadmap: [docs/04-roadmap.md](docs/04-roadmap.md).

## Quy ước chính

- Mọi route handler: `const { user } = await requireUser(); await requireNotebookRole(user.id, id, "viewer")`, bọc bằng `handleRoute()`; lỗi trả `{ "error": { "code", "message" } }`.
- Validate input bằng zod (`src/lib/validators/*`, `parseBody`).
- Chuỗi giao diện qua `t("khoá")` / `useT()`; `src/i18n/vi.ts` là nguồn chính.
- Không dữ liệu giả trong UI; tính năng chưa có hiển thị "Đang phát triển".
- Code server-only đặt trong `src/server/**` và `import "server-only"`.

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [docs/00-spec-du-an.md](docs/00-spec-du-an.md) | **Spec bàn giao: mục tiêu, hiện trạng, cài đặt máy cá nhân, backlog** |
| [docs/01-nghien-cuu.md](docs/01-nghien-cuu.md) | Nghiên cứu sản phẩm |
| [docs/02-kien-truc.md](docs/02-kien-truc.md) | Kiến trúc + ghi chú triển khai từng phase (§6–§13) |
| [docs/03-mo-hinh-du-lieu.md](docs/03-mo-hinh-du-lieu.md) | Lược đồ dữ liệu, ma trận quyền |
| [docs/04-roadmap.md](docs/04-roadmap.md) | Roadmap và quy ước mã nguồn |
| [docs/05-thiet-ke-ui.md](docs/05-thiet-ke-ui.md) | Ngôn ngữ thiết kế UI |
| [docs/06-slide-engine.md](docs/06-slide-engine.md) | Engine slide / infographic |
| [docs/07-ket-noi.md](docs/07-ket-noi.md) | NotebookLM Bridge/Enterprise, Google Drive |
| [docs/08-trien-khai.md](docs/08-trien-khai.md) | Triển khai production: Docker, biến môi trường, nginx, sao lưu, OAuth Google, Gemini |
| [docs/09-kiem-thu.md](docs/09-kiem-thu.md) | Chạy unit/API/e2e, DB test, mock provider, danh mục QA thủ công |
| [docs/11-kiem-chung-gemini.md](docs/11-kiem-chung-gemini.md) | Kịch bản kiểm chứng Gemini thật: script, checklist giao diện, hiệu chỉnh ngưỡng thiếu bằng chứng |
| [docs/12-luu-tru-google-drive.md](docs/12-luu-tru-google-drive.md) | Nghiên cứu P7 (chưa triển khai): Google Drive làm nơi lưu trữ, nguồn local/online — quyết định, thiết kế, kế hoạch |
