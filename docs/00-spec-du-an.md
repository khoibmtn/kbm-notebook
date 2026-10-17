# 00 · Spec dự án KBM Notebook (bàn giao sang Claude Code trên máy cá nhân)

> Cập nhật: 2026-10-17. Tài liệu này là điểm vào duy nhất cho người (hoặc Claude Code) tiếp quản dự án. Chi tiết kỹ thuật sâu nằm trong `docs/01`–`docs/10`; quy tắc làm việc hằng ngày nằm trong `CLAUDE.md` ở thư mục gốc.

## 1. Lấy mã nguồn về máy

Toàn bộ mã nguồn nằm trên GitHub, nhánh `main` (PR #1 đã merge ngày 2026-10-17):

```bash
git clone https://github.com/khoibmtn/kbm-notebook.git
cd kbm-notebook
claude            # mở Claude Code; CLAUDE.md được nạp tự động
```

Nếu `git clone` lấy nhầm nhánh khác (nhánh mặc định của repo chưa đổi), chạy thêm `git checkout main`. Nên đổi nhánh mặc định của repo sang `main` trong Settings → General → Default branch, và làm việc trên `main` hoặc nhánh tính năng mới tách từ `main`.

## 2. Mục tiêu sản phẩm (yêu cầu gốc của chủ dự án)

Ứng dụng web học tập và cộng tác tri thức bằng AI, chất lượng sản phẩm thực tế, ưu tiên desktop, responsive tablet/mobile.

1. **Sổ tay học tập:** nhiều sổ tay độc lập; mỗi sổ tay có nguồn riêng, System Instruction riêng, chọn nguồn cho từng tác vụ, bật nguồn Internet khi cho phép.
2. **Nguồn tri thức:** kéo thả, tải lên, quản lý tài liệu; kết nối Gemini Notebook/NotebookLM cá nhân hoặc được chia sẻ bằng phương thức chính thức khi có, không giả lập tích hợp.
3. **Chat AI và ghi chú:** trả lời có căn cứ, trích dẫn đến tài liệu và vị trí; liệt kê nguồn thực sự dùng; nói rõ khi thiếu bằng chứng; lưu cặp hỏi-đáp; chuyển câu trả lời thành ghi chú sửa được; lưu ngược vào nguồn hoặc NotebookLM khi có quyền.
4. **Studio:** notes, reports, mindmaps, slide decks, infographics, quizzes, flashcards, study guides…; prompt mặc định trong Settings + prompt tuỳ chỉnh; mỗi sản phẩm là artifact mở lại, sửa, nhân bản, phiên bản, chia sẻ, xoá. **Slide deck ưu tiên cao:** không giới hạn cứng 15 slide, sửa từng thành phần, thêm/xoá/sắp xếp slide, xuất **PPTX sửa tiếp được**. Xuất DOCX/PPTX/PDF theo loại.
5. **Chia sẻ và phân quyền:** view-only và editable; vai trò owner/admin/member; kiểm tra phía server; chia sẻ sổ tay không kéo theo nguồn riêng tư hay quyền vào notebook ngoài.
6. **Chat cộng tác** kiểu Telegram/Zalo trong mỗi sổ tay: kênh chung + chat riêng, nhắc tên, trả lời, emoji, sửa/xoá/thu hồi, đính kèm, thông báo, tìm kiếm, đã xem; đưa artifact/nguồn vào chat, chuyển tệp chat vào nguồn, chuyển thảo luận thành note/artifact.
7. **Định hướng cộng đồng học thuật:** thư viện tri thức, nhóm học tập, chia sẻ artifact, thảo luận, tìm kiếm, ôn tập. Khu vực chính: Sources, Chat, Studio, Notes, Community, Settings.
8. **Nguyên tắc:** MVP dùng được thật trước, không mockup tĩnh, không dữ liệu giả che chức năng chưa làm, nêu rõ giới hạn kỹ thuật và phương án thay thế.

## 3. Hiện trạng (đã làm xong, có test)

| Hạng mục | Kết quả kiểm tra gần nhất |
|---|---|
| Lint, typecheck | Sạch |
| Vitest (unit, API, component) | 705/705 |
| Playwright e2e | 31/31 |
| Sidecar Python pytest | 100/100 |
| `pnpm build` production | Thành công |
| Duyệt thực tế bằng trình duyệt (bản production, AI mock) | 27 màn hình, không lỗi console; PPTX xuất ra mở được bằng LibreOffice |

| Module | Trạng thái | Nội dung chính |
|---|---|---|
| P0 Nền tảng | Xong | Đăng ký/đăng nhập email + Google (tuỳ chọn), xác minh email, sổ tay, thành viên, lời mời, 4 vai trò, Settings (khoá Gemini mã hoá AES-GCM, prompt mặc định), i18n vi/en, sáng/tối |
| P1 Nguồn | Xong | PDF/DOCX/PPTX/XLSX/CSV/MD/TXT/HTML/URL/văn bản; trích xuất trong worker thread có timeout; chunk giữ trang; embedding pgvector; tìm kiếm lai vector + full-text + RRF; nguồn riêng tư; viewer tô sáng đoạn trích |
| P2 Chat AI + Ghi chú | Xong | Streaming SSE, hậu kiểm `[n]`, "Nguồn đã dùng", cảnh báo thiếu bằng chứng, lưu Q&A, ghi chú Tiptap, ghi chú → nguồn, nguồn Internet khi sổ tay cho phép |
| P3 Studio | Xong | 11 loại artifact; slide editor sửa từng phần tử, kéo sắp xếp, sửa một slide bằng AI; xuất PPTX gốc (text box, chart, table, notes), DOCX, PDF, PNG/SVG, CSV/Anki, MD; phiên bản, nhân bản, chia sẻ private/notebook/link/public |
| P4 Chat nhóm | Xong | Kênh chung, chủ đề, DM riêng tư; mention, reply, reaction, sửa/xoá/thu hồi, đính kèm, ghim, tìm kiếm, đã xem, đang nhập, thông báo; thẻ artifact/nguồn/ghi chú |
| P5 Kết nối | Xong, **Bridge thử nghiệm** | NotebookLM Bridge (sidecar bọc `notebooklm-py`, không chính thức), NotebookLM Enterprise API (preview, không có hỏi đáp), Google Drive import |
| P6 Cộng đồng | Xong | Explore, like/bình luận, sổ tay công khai `/p/<slug>` + yêu cầu tham gia, nhóm học tập `/g/<slug>`, tìm kiếm toàn cục `/search` + ⌘K |
| Bảo mật | Xong mục Critical/High | 39 phát hiện; tồn đọng xem `docs/10-ra-soat-bao-mat.md` |
| Triển khai | **Đã soạn, chưa chạy thật** | Dockerfile, docker-compose, pipeline Cloud Run 0 đồng + Supabase, `render.yaml` |

## 4. Kiến trúc tóm tắt

```
Trình duyệt ──HTTP/SSE──▶ server.ts (Node 22)
                           ├─ Next.js 16 App Router (UI + /api/*)
                           ├─ Socket.IO /rt (chat nhóm, trạng thái job)
                           └─ Job worker (ingest_source, generate_artifact, export_artifact, cleanup)
                                   │
           PostgreSQL 16 + pgvector + pg_trgm  ◀─┘   Lưu tệp: ./storage (local disk)
           Gemini API (chat, embedding, ảnh)         Chromium (xuất PDF/PNG)
           NotebookLM Bridge (tuỳ chọn, http://localhost:8765)
```

Hợp đồng lõi nằm ở `docs/02-kien-truc.md` §3: `AiProvider` (gemini | mock), `KnowledgeProvider` (local | web | notebooklm-bridge | notebooklm-enterprise), pipeline trích dẫn, `requireNotebookRole`, `StorageAdapter`, jobs, realtime.

## 5. Chạy trên máy cá nhân

### 5.1 Phần mềm cần có

| Phần mềm | macOS | Windows |
|---|---|---|
| Git | có sẵn hoặc `brew install git` | Git for Windows |
| Node.js 22 + pnpm 10 | `brew install node@22`, `corepack enable` | Dùng **WSL2 (Ubuntu)**, cài như Linux |
| PostgreSQL 16 + pgvector | `brew install postgresql@16 pgvector` hoặc Docker | Trong WSL2: Docker Desktop với image `pgvector/pgvector:pg16` |
| Chromium cho xuất PDF | `pnpm exec playwright install chromium` | như macOS, chạy trong WSL2 |
| Python 3.11+ (chỉ khi dùng Bridge) | `brew install python` | trong WSL2 |
| Claude Code | `npm i -g @anthropic-ai/claude-code` | trong WSL2 |

Windows nên dùng WSL2. Script `pnpm start` dùng cú pháp biến môi trường kiểu Unix và Next/Socket.IO chạy ổn định hơn trên Linux.

Cách nhanh nhất cho database là Docker:

```bash
docker run -d --name kbm-pg -p 5432:5432 \
  -e POSTGRES_USER=kbm -e POSTGRES_PASSWORD=kbm -e POSTGRES_DB=kbm_notebook \
  pgvector/pgvector:pg16
```

### 5.2 Cấu hình `.env`

```bash
cp .env.example .env
openssl rand -base64 32   # dán vào BETTER_AUTH_SECRET
openssl rand -hex 32      # dán vào APP_ENCRYPTION_KEY
```

Giá trị tối thiểu cho máy cá nhân:

```dotenv
DATABASE_URL=postgres://kbm:kbm@localhost:5432/kbm_notebook
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
AI_PROVIDER=gemini            # hoặc mock nếu chưa có khoá
GEMINI_API_KEY=               # lấy miễn phí tại aistudio.google.com
AUTH_REQUIRE_EMAIL_VERIFICATION=false
CONNECTORS_ALLOW_PRIVATE_HOSTS=true   # chỉ khi chạy Bridge ở localhost
```

Khoá Gemini cũng có thể nhập trong ứng dụng: Settings → AI, rồi bấm "Kiểm tra key".

### 5.3 Chạy

```bash
pnpm install
pnpm db:migrate
pnpm dev                  # mở http://localhost:3000
```

Kiểm tra trước khi giao việc cho Claude Code: `pnpm lint && pnpm typecheck && pnpm test`. `pnpm test` cần quyền tạo database (user `kbm` ở trên đủ quyền nếu là superuser; với Docker image pgvector thì user mặc định là superuser).

### 5.4 NotebookLM Bridge (tuỳ chọn)

Chạy trên chính máy anh, dùng phiên đăng nhập Google của anh. Đây là thư viện **không chính thức**, có thể hỏng khi Google thay đổi; nên dùng tài khoản Google riêng.

```bash
cd bridge/notebooklm
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]" "notebooklm-py[browser]==0.8.5"
.venv/bin/playwright install chromium
.venv/bin/notebooklm login            # đăng nhập Google trong cửa sổ trình duyệt
BRIDGE_TOKEN=$(openssl rand -hex 24) .venv/bin/uvicorn app.main:app --port 8765
```

Sau đó trong ứng dụng: Settings → Kết nối → NotebookLM Bridge, nhập `http://localhost:8765` và token, bấm "Kiểm tra kết nối". Chi tiết: `bridge/notebooklm/README.md`, `docs/07-ket-noi.md`.

## 6. Việc còn dở, theo thứ tự ưu tiên

### 6.1 Kiểm chứng với dịch vụ thật (chưa từng chạy thật)

Môi trường phát triển trước đây không có khoá AI và không có tài khoản Google, nên các đường sau mới chỉ chạy bằng mock hoặc server giả:

1. **Gemini thật:** chat có trích dẫn, embedding, sinh slide deck/quiz/infographic, sinh ảnh, web grounding. Cần đánh giá chất lượng nội dung tiếng Việt và ngưỡng `INSUFFICIENT_SIMILARITY_THRESHOLD` (0.25) với embedding thật.
2. **Model ID:** mặc định `gemini-flash-latest`, `gemini-pro-latest`, `gemini-embedding-001`; ảnh `gemini-2.5-flash-image` cần đối chiếu danh sách model hiện hành (`listModels`).
3. **NotebookLM Bridge** với tài khoản Google thật: health, liệt kê notebook, hỏi đáp, đẩy ghi chú, nhập nguồn, tải artifact.
4. **Google OAuth và Drive import:** cần tạo OAuth Client trên Google Cloud Console, redirect `http://localhost:3000/api/auth/callback/google`.
5. **Docker image** và `docker compose up`: chưa build lần nào.

### 6.2 Triển khai: quyết định đang chờ chủ dự án

| Phương án | Trạng thái | Ghi chú |
|---|---|---|
| Google Cloud Run free tier + Supabase | Pipeline đã soạn (`.github/workflows/deploy-cloud-run.yml`, `scripts/gcp-bootstrap.sh`), chưa chạy | 0 đồng ở mức demo; cần gắn thẻ vào GCP |
| Cloudflare Containers (dùng gói Workers Paid $5 sẵn có) + Supabase qua Hyperdrive + R2 + Cron Triggers | Mới phân tích, chưa làm | Cần thêm `StorageAdapter` cho R2 và một Worker đứng trước container; xem phân tích trong lịch sử dự án |
| Tự host bằng docker-compose | Có sẵn tệp | Chưa build thử |

### 6.3 Backlog sản phẩm

- Mind map: nhãn dài ngắt dòng sai quanh nút (đo chữ trước khi font tải xong).
- Tìm kiếm toàn cục phân biệt dấu tiếng Việt; cần `unaccent`.
- Explore phân trang theo offset; nên chuyển keyset.
- Chưa có thông báo khi có bình luận mới; người gửi chưa huỷ được yêu cầu tham gia.
- Nhóm học tập chưa có chat/tài nguyên riêng.
- Infographic chưa có UI thêm/xoá/sắp xếp khối và chưa sửa dữ liệu biểu đồ trong view.
- Nguồn YouTube, OCR PDF scan, ghi chú diễn giả trong PPTX nguồn chưa hỗ trợ.
- Realtime chạy trong một tiến trình; nhân bản ngang cần Redis adapter.
- Tồn đọng bảo mật mức Medium/Low: M-5, M-7, M-8, M-9, M-11, M-12, M-13 và một số mục Low (bảng ở `docs/10`).

## 7. Đề xuất cách giao việc cho Claude Code trên máy

Mỗi phiên một mục tiêu rõ, ví dụ:

1. "Đọc `docs/00-spec-du-an.md` và `CLAUDE.md`, cài đặt và chạy dự án trên máy này, báo lại lỗi nếu có."
2. "Tôi đã nhập Gemini key. Chạy kiểm chứng mục 6.1 bước 1 với tài liệu mẫu tiếng Việt, đánh giá chất lượng trích dẫn và slide deck, đề xuất chỉnh prompt."
3. "Chạy NotebookLM Bridge với tài khoản Google của tôi và kiểm tra mục 6.1 bước 3."
4. "Triển khai lên Cloudflare Containers theo mục 6.2."

Trên máy cá nhân, Claude Code còn có thể dùng tiện ích **Claude in Chrome** để xem trực tiếp các Gemini Notebook đang mở, việc mà môi trường cloud trước đây không làm được.
