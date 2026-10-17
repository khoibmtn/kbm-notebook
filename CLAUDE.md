# CLAUDE.md · KBM Notebook

Hướng dẫn cho Claude Code khi làm việc trong repo này. Đọc kèm `docs/00-spec-du-an.md` (spec đầy đủ, hiện trạng, backlog).

## Người dùng và cách làm việc

- Chủ dự án: bác sĩ gây mê hồi sức, lãnh đạo bệnh viện, Trưởng phòng KHTH. Không phải lập trình viên chuyên nghiệp.
- **Trả lời và ghi tài liệu bằng tiếng Việt.** Thuật ngữ kỹ thuật giữ tiếng Anh.
- Súc tích, làm ngay khi đủ thông tin. Chỉ hỏi khi quyết định thực sự thuộc về chủ dự án (chi phí, dữ liệu thật, thao tác không hoàn tác).
- **Xác nhận trước** khi xoá dữ liệu, xoá DB, force-push, gửi email/tin nhắn thật, deploy ra Internet.
- Không bao giờ tuyên bố một tính năng "hoàn thành" khi chưa chạy kiểm tra thật. Ghi rõ cái gì đã kiểm, cái gì chưa.

## Sản phẩm

Ứng dụng web học tập và cộng tác tri thức bằng AI, kiểu NotebookLM + chat nhóm Telegram/Zalo: Sổ tay → Nguồn (upload, pgvector) → Chat AI có trích dẫn `[n]` → Ghi chú → Studio (slide PPTX gốc, quiz, flashcards, mind map, infographic, báo cáo…) → Chat nhóm realtime → Cộng đồng/Explore. Toàn bộ P0–P6 đã xong (xem spec).

## Stack

Next.js 16 (App Router, Turbopack, `src/proxy.ts` thay middleware, `params`/`cookies()` là async) · React 19 · TypeScript strict · Tailwind v4 + shadcn/ui · Drizzle ORM + PostgreSQL 16 (`vector`, `pg_trgm`) · better-auth · Socket.IO trên custom server `server.ts` · `@google/genai` (Gemini) · Vitest · Playwright. Sidecar Python `bridge/notebooklm/` (FastAPI, không chính thức).

## Lệnh

```bash
pnpm install
pnpm db:migrate            # áp dụng drizzle/0000→0003 (tự CREATE EXTENSION vector, pg_trgm)
pnpm dev                   # http://localhost:3000 (Next + Socket.IO + job worker)
pnpm lint && pnpm typecheck
pnpm test                  # Vitest; tự DROP/CREATE DB kbm_notebook_test (tên phải chứa "test")
pnpm e2e                   # Playwright; tự chạy dev server ở E2E_PORT (mặc định 3200)
pnpm build && pnpm start   # production: dist/server.js, dist/extract-worker.js, dist/migrate.js
cd bridge/notebooklm && .venv/bin/pytest -q   # sidecar
```

**Cổng kiểm tra trước mỗi commit:** `pnpm lint`, `pnpm typecheck`, `pnpm test`. Trước khi push thay đổi UI lớn: thêm `pnpm build` và `pnpm e2e`.

## Quy ước bắt buộc

- Route handler: bọc `handleRoute()`; đầu hàm `requireUser()` rồi `requireNotebookRole(user.id, notebookId, "viewer"|"editor"|"admin"|"owner")`. Không có membership → 404, thiếu quyền → 403. Lỗi luôn là `{ error: { code, message } }`.
- Input validate bằng zod (`src/lib/validators/*`, `parseBody`/`parseQuery`). Không `any`.
- Code chỉ chạy server nằm trong `src/server/**` và `import "server-only"`.
- Chuỗi giao diện qua `t("khoá")`/`useT()`. Khoá mới đặt trong `src/i18n/modules/<module>.vi.ts` + `.en.ts`, spread vào `vi.ts`/`en.ts`. `en.ts` phải đủ khoá (kiểu `MessageKey` ép buộc).
- **Không dữ liệu giả trong UI.** Tính năng chưa cấu hình phải báo rõ (vd HTTP 412 khi thiếu khoá AI).
- **Trích dẫn:** chỉ `[n]` trỏ tới bằng chứng thực sự truy xuất được giữ lại (`src/server/ai/citations.ts`). Không nới lỏng hậu kiểm này.
- Nguồn `private`, DM, ghi chú private không bao giờ lọt sang nội dung chia sẻ (xem `docs/10`, H-5).
- Schema đổi → sửa `src/server/db/schema.ts` rồi `pnpm db:generate`. Migration mới đánh số tiếp (`0004_…`). Không sửa migration cũ.
- Test API chạy tuần tự theo tệp (`fileParallelism: false`) vì dùng chung DB và hàng đợi job. Test mới có enqueue job dùng helper `parkJobs` trong `tests/helpers/artifacts.ts`.
- Commit theo module: `feat(sources): …`, `fix(security): …`, `docs: …`. Không ghi tên model AI trong code/commit.

## Bẫy đã biết

- `server.ts` (tsx/esbuild) và bundle Next là **hai instance module trong cùng tiến trình**. Trạng thái dùng chung (io, pool, worker) để trên `globalThis`. Job handler chỉ đăng ký trong module graph của `server.ts`; route chỉ `enqueue`. Không import tĩnh `next/headers` trong module mà `server.ts` nạp.
- `pnpm dev` không hot-reload code `src/server/**` mà `server.ts` nạp: sửa xong phải khởi động lại.
- Next chỉ cho **một** dev server mỗi thư mục. Dừng `pnpm dev` trước khi chạy `pnpm e2e`. HMR lặp vô hạn → xoá `.next`.
- Trích xuất tài liệu chạy trong `worker_threads` (`dist/extract-worker.js` bắt buộc khi production).
- Chromium cho xuất PDF/PNG: tìm theo `PW_CHROMIUM_PATH` → `PLAYWRIGHT_BROWSERS_PATH` → mặc định của Playwright. Máy cá nhân: `pnpm exec playwright install chromium`.
- Production mặc định bật xác minh email (`AUTH_REQUIRE_EMAIL_VERIFICATION`). Không có `SMTP_URL` thì link xác minh chỉ in ra log server.
- `CONNECTORS_ALLOW_PRIVATE_HOSTS=false` mặc định. Muốn nối NotebookLM Bridge chạy ở `localhost` phải đặt `true`.
- `AI_PROVIDER=mock` cho dev/test không cần khoá. Câu trả lời và artifact sẽ có tiền tố `[mock]`.

## Bản đồ tài liệu

| Tệp | Nội dung |
|---|---|
| `docs/00-spec-du-an.md` | **Spec bàn giao: mục tiêu, hiện trạng, cài đặt máy cá nhân, backlog** |
| `docs/02-kien-truc.md` | Kiến trúc, hợp đồng lõi, ghi chú triển khai từng phase (§6–§14) |
| `docs/03-mo-hinh-du-lieu.md` | Lược đồ DB, ma trận quyền |
| `docs/04-roadmap.md` | Roadmap, quy ước |
| `docs/05-thiet-ke-ui.md` | Ngôn ngữ thiết kế UI |
| `docs/06-slide-engine.md` | Engine slide/infographic, xuất PPTX |
| `docs/07-ket-noi.md` | NotebookLM Bridge, Enterprise, Google Drive |
| `docs/08-trien-khai.md` | Docker, Cloud Run 0 đồng, biến môi trường |
| `docs/09-kiem-thu.md` | Cách chạy test, checklist QA |
| `docs/10-ra-soat-bao-mat.md` | 39 phát hiện bảo mật và trạng thái xử lý |
