# 01 · Kết quả nghiên cứu môi trường & sản phẩm tham khảo

> Ngày khảo sát: 2026-10-15. Mọi nhận định về NotebookLM/Gemini Notebook dưới đây lấy từ nguồn công khai (tài liệu Google Cloud, blog Google, mã nguồn mở) và được ghi rõ giới hạn. Không có nhận định nào dựa trên việc "đã mở tab Chrome của người dùng" — môi trường này **không có** công cụ điều khiển trình duyệt Chrome của người dùng (không có tool `claude-in-chrome`), nên các tab Gemini Notebook đang mở **chưa được kiểm tra**.

## 1. Môi trường hiện có

| Hạng mục | Kết quả |
|---|---|
| Repository | `khoibmtn/kbm-notebook`, **trống** (chưa có commit), nhánh làm việc `claude/dazzling-rubin-xivuuk` |
| Runtime | Node 22.22, pnpm 10.28, bun 1.4, Python 3.13 |
| CSDL | PostgreSQL 16.15 cục bộ (đã khởi động, port 5432); **pgvector 0.8.1 đã build từ nguồn và cài**; `pg_trgm`, `uuid-ossp` có sẵn. DB `kbm_notebook`, user `kbm/kbm` |
| Công cụ chuyển đổi | LibreOffice (`soffice`), pandoc, Chromium (Playwright, `/opt/pw-browsers`) |
| Docker | Có binary nhưng **daemon không chạy** → không dùng container trong phiên này |
| Mạng ra ngoài | npm/pypi/github **OK**; `generativelanguage.googleapis.com` (Gemini API) và `oauth2.googleapis.com` **truy cập được**; `notebooklm.google.com`, `ai.google.dev`, `docs.cloud.google.com` **bị chặn** bởi proxy phiên |
| API key | **Không có** `GEMINI_API_KEY`/`GOOGLE_*`/`ANTHROPIC_API_KEY` trong môi trường → mọi tính năng AI chỉ kiểm thử được bằng provider giả lập trong test; khi chạy thật cần cấp key qua Settings hoặc `.env` |
| Trình duyệt người dùng | Không truy cập được (xem ghi chú đầu trang) |

## 2. NotebookLM / Gemini Notebook — chức năng tham chiếu

Nguồn: DigitalOcean guide 2026, 9to5google (12/2025), getalai (02/2026), plusai, blog.google (public notebooks 06/2025), Workspace admin help.

- **Bố cục 3 cột**: Sources (trái) · Chat (giữa) · Studio (phải). Mobile chuyển thành tab.
- **Sources**: PDF, Google Docs/Slides, URL, YouTube, text dán, Drive; "Discover sources" (tìm web); chọn/bỏ chọn nguồn áp dụng cho chat & Studio; xem hướng dẫn nguồn (source guide).
- **Chat**: trả lời có trích dẫn inline (số) → bấm mở đúng đoạn nguồn; "Save to note"; cấu hình chat (goal/persona, độ dài trả lời, custom prompt). Lịch sử chat được lưu (từ 2025).
- **Studio**: Audio Overview, Video Overview, Mind Map, Reports (briefing doc, study guide, FAQ, timeline, blog post...), Flashcards, Quiz, Infographic, Slide Deck, Data Table (12/2025). Mỗi loại có hộp "Customize" (prompt + tuỳ chọn: format, độ dài, ngôn ngữ, orientation…).
- **Slide deck của NotebookLM**: ảnh render bằng mô hình ảnh (Nano Banana Pro); sửa bằng cách ra lệnh (prompt-edit) rồi tạo lại; xuất PDF/PPTX nhưng PPTX là ảnh phẳng, **không chỉnh được từng phần tử**. Đây là điểm sản phẩm này **phải vượt**: slide là object gốc (text box, shape, chart) → PPTX chỉnh sửa tiếp được.
- **Chia sẻ**: Viewer (xem nguồn, chat, dùng artifact; không sửa) / Editor; public link chỉ cho tài khoản cá nhân, Workspace giới hạn cùng domain.
- **Hạn mức free**: 100 notebook, 50 nguồn/notebook, 50 câu hỏi/ngày (theo skill `notebooklm-export` của người dùng).

## 3. Tính khả thi tích hợp Google (kết luận quan trọng)

| Kênh | Tình trạng | Dùng trong sản phẩm |
|---|---|---|
| **NotebookLM cá nhân (consumer) API chính thức** | **Không tồn tại** (Google chưa công bố API tự phục vụ; forum Google AI Dev xác nhận) | Không thể tích hợp trực tiếp bằng API chính thức |
| **NotebookLM Enterprise API** (Discovery Engine `v1alpha`, thuộc Gemini Enterprise) | Chính thức nhưng **Preview/alpha**; cần GCP project + license Gemini/NotebookLM Enterprise; có `notebooks.create/get/list`, quản lý sources, `audioOverviews`, `:share`. **Không có endpoint chat/hỏi đáp** theo tài liệu và wrapper `nblm-rs`. | Connector "Enterprise" (quản lý notebook/nguồn/chia sẻ). Không kiểm thử được ở đây vì không có GCP project |
| **notebooklm-py** (MIT, không chính thức, v0.8.5) | Dựa trên endpoint nội bộ, đăng nhập bằng cookie/master token; hỗ trợ đầy đủ: notebooks, sources (url/text/file/drive), `chat.ask` trả `AskResult{answer, references[ChatReference{source_id, cited_text, start_char,end_char…}]}`, notes CRUD, sharing, generate+download mọi artifact (slide PPTX, report, quiz JSON, flashcards, mind map JSON, infographic, data table). Có MCP & REST server. **Rủi ro**: vỡ khi Google đổi API; vi phạm ToS tiềm ẩn; cần phiên Google đăng nhập trên máy người dùng. | Connector "NotebookLM Bridge": sidecar Python (FastAPI) bọc notebooklm-py, chạy trên máy/máy chủ của người dùng, app gọi qua HTTP + token. Đánh dấu rõ **Experimental / unofficial**, có thể bật/tắt |
| **Gemini API** (`@google/genai` 2.30) | Chính thức, truy cập được. Models (theo tài liệu/changelog Google): `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`; ảnh `gemini-3.1-flash-image` (Nano Banana 2); embedding `gemini-embedding-001` (3072, MRL 768/1536), `gemini-embedding-2-preview` (đa phương thức). **File Search** (RAG quản lý, trích dẫn theo trang qua `groundingMetadata`); **Google Search grounding** (nguồn Internet). | Provider AI chính. Model ID cấu hình được trong Settings vì danh sách đổi nhanh; mặc định `gemini-3-flash-preview` (nhanh) và `gemini-3.1-pro-preview` (artifact chất lượng cao) |
| **Google OAuth / Drive API** | Chính thức; cần Client ID/Secret | Đăng nhập Google; nhập tài liệu từ Drive (scope `drive.readonly`) |
| **Google Docs/Slides export** | Chính thức qua Drive API upload+convert | Giai đoạn sau |

**Kết luận**: Không giả lập tích hợp. Lớp `KnowledgeProvider` trừu tượng hoá 4 nguồn: `local` (kho tri thức nội bộ, đầy đủ), `web` (Google Search grounding, chỉ khi người dùng bật), `notebooklm-bridge` (unofficial, cấu hình), `notebooklm-enterprise` (official preview, cấu hình). UI hiển thị trạng thái kết nối thật (chưa cấu hình / lỗi / sẵn sàng), không bao giờ hiển thị dữ liệu giả.

## 4. Chat chuyên nghiệp (Telegram/Zalo) — tính năng tham chiếu

Trả lời tin nhắn (quote), nhắc tên `@`, reaction emoji, sửa/xoá/thu hồi (Zalo "thu hồi" = gỡ với mọi người, để lại dấu), đính kèm tệp/ảnh, ghim tin, tìm kiếm trong hội thoại, trạng thái đã gửi/đã xem, "đang nhập…", thông báo chưa đọc theo kênh, chuyển tiếp. Sản phẩm bổ sung tương tác học tập: chia sẻ artifact/nguồn vào chat dưới dạng thẻ, chuyển tệp từ chat vào Sources, chuyển đoạn hội thoại thành Note, tạo artifact từ hội thoại.

## 5. Rủi ro kỹ thuật chính & cách xử lý

1. **Không có API NotebookLM chính thức cho tài khoản cá nhân** → Bridge không chính thức + Enterprise connector; kho tri thức nội bộ là trục chính.
2. **Trích dẫn giả** → Pipeline chỉ cho phép citation tham chiếu đến chunk thực sự được retrieve; hậu kiểm bằng regex, loại citation không hợp lệ, gắn cờ "thiếu bằng chứng" khi retrieval rỗng/điểm thấp.
3. **Không có API key trong môi trường build** → `AiProvider` có `MockProvider` cho test; mọi tính năng AI có trạng thái "chưa cấu hình key" rõ ràng.
4. **Slide PPTX chỉnh sửa được** → mô hình slide JSON có cấu trúc (layout + elements) → `pptxgenjs` xuất text box/shape/chart gốc; ảnh AI là tuỳ chọn.
5. **Realtime chat** → Socket.IO trên custom server Node; fallback polling.
6. **Phân quyền** → mọi route handler đi qua `requireNotebookRole()`; chat riêng kiểm tra membership kênh; nguồn riêng tư không lộ qua chia sẻ sổ tay.
7. **Model ID Gemini thay đổi nhanh** → cấu hình trong Settings + kiểm tra `models.list` khi lưu key.
8. **Tài liệu lớn/ingest chậm** → hàng đợi job trong Postgres, worker trong process, trạng thái từng nguồn (pending/processing/ready/failed).

## 6. Nguồn tham khảo
- https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks
- https://github.com/K-dash/nblm-rs · https://github.com/teng-lin/notebooklm-py (v0.8.5, MIT)
- https://discuss.ai.google.dev/t/how-to-access-notebooklm-via-api/5084
- https://blog.google/technology/google-labs/notebooklm-public-notebooks/
- https://9to5google.com/2025/12/19/notebooklm-gemini-3-data-tables/ · https://getalai.com/blog/how-to-edit-notebooklm-slides · https://plusai.com/blog/notebooklm-slides-review
- https://www.digitalocean.com/resources/articles/what-is-notebooklm
- https://developers.googleblog.com/gemini-embedding-available-gemini-api/ · https://ai.google.dev/gemini-api/docs/gemini-3 · https://ai.google.dev/gemini-api/docs/changelog
- https://blog.logrocket.com/best-auth-library-nextjs-2026/ (Auth.js bảo trì, khuyến nghị Better Auth)
