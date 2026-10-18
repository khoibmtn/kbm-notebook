# 04 · Roadmap MVP & quy ước phát triển

## Thứ tự triển khai
| Phase | Nội dung | Tiêu chí hoàn thành |
|---|---|---|
| **P0 Nền tảng** | Scaffold Next 16 + Tailwind + shadcn; Drizzle schema đầy đủ (docs/03) + migration; better-auth (email/password + Google OAuth nếu có env); layout shell (sidebar, topbar, 3 cột); CRUD sổ tay; thành viên & mời; `requireNotebookRole`; `AiProvider` (gemini+mock); storage adapter; jobs worker; `server.ts` Socket.IO; i18n vi/en; Vitest + Playwright cấu hình; `.env.example`; README | `pnpm build` xanh, `pnpm test` xanh, đăng ký→tạo sổ tay→mời thành viên chạy thật |
| **P1 Sources** | Upload kéo thả (nhiều tệp), URL, text dán; ingest job: extract (PDF/DOCX/PPTX/XLSX/MD/TXT/CSV/HTML) → chunk (≈800 token, overlap 120, giữ page) → embed → pgvector; trạng thái realtime; source viewer (text theo trang, highlight đoạn); nguồn private; chọn nguồn; summary + key topics tự động; xoá/đổi tên | Upload PDF 50 trang → ready; retrieve trả chunk đúng trang; test unit cho chunker/extractor |
| **P2 Chat AI + Notes** | Conversations; streaming SSE; pipeline citation (docs/02 §3.3); chip `[n]` mở viewer; "Nguồn đã dùng"; insufficient evidence; lưu cặp hỏi-đáp; chuyển thành note (Tiptap); note → thêm vào Sources; system instruction notebook + prompt mặc định Settings; use_web toggle | Câu hỏi không có trong nguồn → trả lời nêu rõ thiếu bằng chứng; citation không hợp lệ bị loại (test) |
| **P3 Studio** | Framework artifact (job, versions, fork, share, delete, export); generators có JSON schema cho report/study_guide/faq/timeline/quiz/flashcards/mindmap/**slide_deck**/infographic/data_table; editor từng loại (slide editor: sửa text từng phần tử, thêm/xoá/kéo sắp xếp, đổi layout, speaker notes); export PPTX (pptxgenjs native) / DOCX / PDF / PNG / SVG / CSV / MD; hộp "Tuỳ chỉnh" với prompt mặc định (Settings) + prompt riêng + options | Tạo deck 20+ slide → sửa → xuất PPTX mở được trong PowerPoint/LibreOffice với text box thật (kiểm bằng `soffice --convert-to pdf` + unzip xml) |
| **P4 Team chat** | Channels general/topic/DM; Socket.IO; mention, reply, reaction, edit/delete/recall, attachments, pin, search, read receipts, typing, notifications; thẻ artifact/source/note; chat attachment → Sources; chọn tin nhắn → note / artifact | 2 user chat realtime (test Playwright 2 context); DM không rò rỉ (test API 403) |
| **P5 Connectors** | NotebookLM Bridge sidecar (Python FastAPI + notebooklm-py) + connector UI; Enterprise connector (REST v1alpha, OAuth token); Google Drive import; web grounding | Trạng thái kết nối thật; không có mock data; tài liệu hướng dẫn cài sidecar |
| **P6 Community & hoàn thiện** | Explore (artifact/notebook public), like/comment, tìm kiếm toàn cục (notebook/nguồn/note/artifact/tin nhắn), onboarding, dark mode, responsive, docs kỹ thuật | Lighthouse cơ bản, e2e smoke — **đã hoàn thành** (xem docs/02 §13, docs/08, docs/09) |
| **P7 Google Drive làm nơi lưu trữ · nguồn local/online** (đề xuất 2026-10-18, **đang nghiên cứu, chưa triển khai**) | Đăng nhập Google → Drive của email đó là nơi lưu trữ mặc định; Cài đặt cho thêm/thay Drive khác; sổ tay liên kết Gemini Notebook dùng nguồn của notebook đó; nguồn tự thêm mặc định nằm **local** (chỉ thiết bị/máy đang chạy) và chỉ thành **online** (đẩy lên Drive, mọi thiết bị dùng được) khi người dùng bật; chia sẻ sổ tay hỏi có đưa nguồn local lên online không | Tài liệu thiết kế trả lời các câu hỏi mở ở mục "Hạng mục nghiên cứu P7" bên dưới; prototype `GoogleDriveStorage` (StorageAdapter) có test; quyết định mô hình "local" trước khi code UI |

## Hạng mục nghiên cứu P7 — Google Drive làm nơi lưu trữ, nguồn local/online

Yêu cầu của chủ dự án (2026-10-18), ghi lại để nghiên cứu trước khi triển khai. Chưa có code nào cho mục này.

### Workflow mong muốn

1. **Đăng nhập Google** → hệ thống ghi nhận email; Google Drive gắn với email đó là **nơi lưu trữ** mặc định của người dùng. Cài đặt có mục **thêm/thay nơi lưu trữ** bằng một Google Drive khác.
2. **Tạo/mở sổ tay:** nếu sổ tay **liên kết với một Gemini Notebook (NotebookLM)** thì dùng nguồn của notebook đó.
3. **Thêm tài liệu vào nguồn của chính sổ tay:** mặc định tài liệu được **sao chép vào thư mục local của hệ thống** và dùng ở local. Hệ quả: không truy vấn được nguồn này từ thiết bị di động hoặc thiết bị khác; trên thiết bị khác, các nguồn này **ẩn hẳn** hoặc hiện kèm ghi chú "nguồn local".
4. **Bật online** cho nguồn: nguồn được đẩy lên Google Drive, trở thành nguồn online, truy cập từ mọi thiết bị.
5. **Chia sẻ sổ tay:** hỏi người dùng có chia sẻ nguồn local không; nếu có thì đưa nguồn local lên online và thành viên khác cũng dùng được.

### Hiện trạng liên quan (để không làm lại)

- Đăng nhập Google đã có (better-auth, scope `openid email profile`); Drive chỉ xin thêm scope **`drive.readonly`** khi bấm "Kết nối Google Drive" và chỉ dùng để **nhập** tệp (docs/07 §1.3, §4). Ghi lên Drive cần scope khác (`drive.file`: chỉ tệp do app tạo — đủ cho kho lưu trữ riêng của app).
- Lưu trữ tệp đi qua `StorageAdapter` (`src/server/storage/adapter.ts`: `put`/`getStream`/`delete`), hiện chỉ có `LocalDiskStorage` (`./storage` của **máy chạy server**). Mọi route phục vụ tệp đều qua `/api/files/[id]` có kiểm quyền.
- Liên kết sổ tay với NotebookLM đã có qua **Bridge** (không chính thức): hỏi đáp dùng nguồn của notebook ngoài, nhập `fulltext` về làm nguồn local; **không tải được tệp gốc** từ NotebookLM.
- Token OAuth Google lưu trong bảng `accounts` chưa mã hoá ở tầng ứng dụng (docs/10 M-8) — phải xử lý trước khi giữ refresh token dùng lâu dài cho Drive.

### Câu hỏi mở phải chốt trước khi thiết kế chi tiết

1. **"Local" là gì?** Kiến trúc hiện tại là web app: tệp nằm trên **máy chạy server**, không phải trên thiết bị của người dùng. Nếu server chạy trên laptop của anh (localhost) thì điện thoại không vào được app chứ không chỉ không thấy nguồn; nếu server ở cloud thì mọi thiết bị đều thấy mọi nguồn. Do đó "nguồn local" chỉ có nghĩa khi (a) app chạy theo kiểu **mỗi người một instance trên máy mình** (desktop/self-host) và các instance đồng bộ với nhau qua Drive, hoặc (b) "local" được định nghĩa là **"chỉ lưu trên server này, chưa đồng bộ lên Drive"** và việc ẩn/ghi chú trên thiết bị khác thực ra là "trên instance khác". Cần chọn mô hình triển khai trước.
2. **Nhận diện thiết bị:** nếu theo mô hình (a), cần `device_id`/`instance_id` để biết nguồn nằm ở đâu, và cơ chế đồng bộ metadata (DB) giữa các instance — DB hiện là Postgres trung tâm, không có đồng bộ ngang.
3. **Vector/chunk ở đâu?** Nguồn online trên Drive chỉ là tệp gốc; chunk + embedding nằm trong Postgres của instance đã ingest. Thiết bị/instance khác muốn truy vấn phải ingest lại (tốn token) hoặc dùng chung một Postgres.
4. **Quyền trên Drive khi chia sẻ:** tệp nằm trong Drive của chủ nguồn. Thành viên khác đọc qua (i) server dùng token của chủ nguồn (server-side proxy, như Bridge hiện nay) hay (ii) chia sẻ tệp Drive tới email thành viên (lộ cấu trúc thư mục, phụ thuộc Google)? Khuyến nghị (i) để giữ nguyên bất biến "server kiểm quyền".
5. **Nhiều Drive:** "thêm/thay nơi lưu trữ" nghĩa là mỗi người dùng có nhiều tài khoản lưu trữ, mỗi nguồn ghi rõ nằm ở tài khoản nào; thay Drive có di chuyển tệp cũ không?
6. **Hạn mức & chi phí:** Drive API quota, dung lượng Drive miễn phí 15 GB (chung với Gmail/Photos), tốc độ đọc khi xuất PDF/trích xuất lại.
7. **Tương tác với NotebookLM:** sổ tay liên kết Gemini Notebook "dùng nguồn từ notebook đó" — giữ như hiện nay (hỏi qua Bridge) hay nhập toàn bộ về? Bridge không chính thức, có thể hỏng.

### Phác thảo kỹ thuật (để ước lượng, chưa phải quyết định)

- Schema: `user_storage_accounts(id, user_id, provider 'google-drive', email, root_folder_id, credential_enc, is_default)`; `sources.storage` ∈ `local | online`; `files.remote_id`, `files.storage_account_id`; job `sync_source_online` (đẩy tệp, cập nhật trạng thái, phát realtime).
- `GoogleDriveStorage implements StorageAdapter` (thư mục `KBM Notebook/<notebookId>/`), `StorageRouter` chọn adapter theo `files.storage_account_id`; tệp local giữ `LocalDiskStorage`.
- OAuth: xin `drive.file` khi người dùng chọn Drive làm nơi lưu trữ; mã hoá token (`encryptOAuthTokens` của better-auth hoặc `credential_enc` riêng); làm mới token như `connectors/drive.ts`.
- UI: huy hiệu "Local"/"Online" trên thẻ nguồn, công tắc "Bật online", hộp thoại chia sẻ hỏi "Đưa N nguồn local lên online?", Cài đặt → Lưu trữ (danh sách Drive, đặt mặc định).
- Kiểm thử: StorageAdapter giả Drive (như `fake-bridge`), test quyền `/api/files` với nguồn online của người khác, test luồng chia sẻ.

### Rủi ro

- Phụ thuộc Google OAuth verification cho scope `drive.file` khi công khai app.
- Mất đồng bộ giữa tệp trên Drive và chunk trong Postgres (người dùng xoá tệp trên Drive).
- Mô hình "mỗi người một instance" đụng tới phần realtime/team chat đang là một tiến trình trung tâm.

### Đầu ra của bước nghiên cứu

Một tài liệu `docs/12-luu-tru-google-drive.md` trả lời 7 câu hỏi mở, kèm sơ đồ dữ liệu và luồng; một prototype `GoogleDriveStorage` chạy được với tài khoản thật (put/get/delete + test); ước lượng khối lượng; sau đó mới đưa vào phase triển khai.

## Quy ước mã nguồn (bắt buộc cho mọi agent)
- TypeScript strict; không `any` trừ khi bắt buộc kèm comment.
- Mọi route handler: `const { user } = await requireUser(); await requireNotebookRole(user.id, notebookId, 'viewer')`.
- Input validate bằng Zod (`src/lib/validators/*`); lỗi trả `{ error: { code, message } }` + status chuẩn (400/401/403/404/409/412/429/500).
- Không dữ liệu giả trong UI: trạng thái rỗng phải là "chưa có dữ liệu"; tính năng chưa cấu hình phải nói rõ.
- Chuỗi UI qua `t('key')` (`src/i18n/vi.ts` là nguồn chính, `en.ts` song song).
- Server-only code trong `src/server/**` (import `server-only`).
- Test tối thiểu: unit cho logic thuần (chunk, citations, permissions), API test cho quyền (403), e2e smoke cho luồng chính.
- Commit theo module: `feat(sources): ...`, `feat(studio): ...`.
