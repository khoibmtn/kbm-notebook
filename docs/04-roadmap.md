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
| **P6 Community & hoàn thiện** | Explore (artifact/notebook public), like/comment, tìm kiếm toàn cục (notebook/nguồn/note/artifact/tin nhắn), onboarding, dark mode, responsive, docs kỹ thuật | Lighthouse cơ bản, e2e smoke |

## Quy ước mã nguồn (bắt buộc cho mọi agent)
- TypeScript strict; không `any` trừ khi bắt buộc kèm comment.
- Mọi route handler: `const { user } = await requireUser(); await requireNotebookRole(user.id, notebookId, 'viewer')`.
- Input validate bằng Zod (`src/lib/validators/*`); lỗi trả `{ error: { code, message } }` + status chuẩn (400/401/403/404/409/412/429/500).
- Không dữ liệu giả trong UI: trạng thái rỗng phải là "chưa có dữ liệu"; tính năng chưa cấu hình phải nói rõ.
- Chuỗi UI qua `t('key')` (`src/i18n/vi.ts` là nguồn chính, `en.ts` song song).
- Server-only code trong `src/server/**` (import `server-only`).
- Test tối thiểu: unit cho logic thuần (chunk, citations, permissions), API test cho quyền (403), e2e smoke cho luồng chính.
- Commit theo module: `feat(sources): ...`, `feat(studio): ...`.
