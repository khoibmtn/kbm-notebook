# 11 · Kịch bản kiểm chứng với Gemini thật (docs/00 §6.1 bước 1 và 2)

> Mục đích: lần đầu chạy KBM Notebook với khoá Gemini thật trên máy cá nhân, trả lời ba câu hỏi: (a) các model ID mặc định còn đúng không, (b) chất lượng tiếng Việt của chat có trích dẫn và các artifact ra sao, (c) ngưỡng `INSUFFICIENT_SIMILARITY_THRESHOLD = 0.25` có phù hợp với embedding thật không. Kết quả ghi vào mục 6 của tài liệu này rồi cập nhật `docs/00-spec-du-an.md` §6.1.

Hai lớp kiểm chứng, làm theo thứ tự:

| Lớp | Công cụ | Thời gian | Tốn token |
|---|---|---|---|
| Tự động | `pnpm verify:gemini` (`scripts/verify-gemini.ts`) | 2–5 phút | thấp (một tài liệu mẫu 2 chunk, ~10 lời gọi) |
| Thủ công trên giao diện | checklist mục 4 với `docs/samples/mau-kiem-chung-gay-me.md` | 30–45 phút | vừa |

Script dùng đúng lớp mã của ứng dụng (`GeminiProvider`, `buildContext`, `postCheckAnswer`, `composePrompt`, `runGenerator`, engine slide/infographic) nên những gì script thấy là những gì app sẽ làm; phần thủ công bổ sung những thứ script không đo được: cảm nhận chất lượng tiếng Việt, giao diện, xuất tệp.

## 1. Chuẩn bị

1. Lấy khoá tại https://aistudio.google.com/apikey (gói miễn phí không cần thẻ). Gói miễn phí có hạn mức RPM/RPD thấp hơn hạn mức của app (Chat 60 câu/10 phút), nên có thể gặp HTTP 429 từ Google khi thử dồn dập; đây không phải lỗi của app.
2. Cấp khoá theo **một trong hai** cách:
   - **Khoá server** (nhanh cho kiểm chứng): trong `.env` đặt `AI_PROVIDER=gemini` và `GEMINI_API_KEY=...`, khởi động lại `pnpm dev`.
   - **Khoá người dùng**: giữ `AI_PROVIDER=gemini` trong `.env` (để trống `GEMINI_API_KEY`), đăng nhập app → Cài đặt → AI → dán khoá → bấm **Kiểm tra key** (gọi `listModels` thật). Script dùng khoá này bằng `--user <email đăng nhập>`.
   - `AI_PROVIDER=mock` phải được bỏ: với mock, app và script không gọi Google.
3. Đã có Chromium cho Playwright (`pnpm exec playwright install chromium`) để xuất PDF/PNG trong phần thủ công.
4. Không nạp tài liệu nhạy cảm (bệnh án thật) trong lần kiểm chứng: dữ liệu gửi qua gói miễn phí có thể được Google dùng để cải thiện sản phẩm.

## 2. Bước 2 của spec: model ID (làm trước vì rẻ nhất)

```bash
pnpm verify:gemini --only models
```

Script gọi `models.list` và đối chiếu 4 model mặc định trong `src/server/ai/provider.ts`:

| Vai trò | Mặc định hiện tại | Cách ghi đè |
|---|---|---|
| Chat | `gemini-flash-latest` | `GEMINI_CHAT_MODEL` hoặc Cài đặt → AI |
| Artifact (Studio) | `gemini-pro-latest` | `GEMINI_ARTIFACT_MODEL` hoặc Cài đặt → AI |
| Embedding | `gemini-embedding-001` (cắt 768 chiều) | `GEMINI_EMBEDDING_MODEL` (đổi model khác chiều cần migration, xem docs/08 §4) |
| Ảnh | `gemini-2.5-flash-image` | `GEMINI_IMAGE_MODEL` |

Cách đọc kết quả:

- **pass**: cả 4 tên có trong danh sách → giữ nguyên.
- **warn "KHÔNG thấy trong danh sách"**: alias `-latest` đôi khi không được liệt kê nhưng vẫn gọi được; kết luận dựa vào các bước `chat`, `quiz`, `image` phía sau. Nếu các bước đó báo lỗi 404 "model not found" thì chọn tên mới từ danh sách `candidates` trong báo cáo JSON (`text`, `embedding`, `image`) và thử lại bằng `--chat-model`/`--artifact-model`, sau đó ghi vào `.env`.
- Quyết định cần ghi: tên model chốt cho 4 vai trò, và có đổi mặc định trong `provider.ts` + `.env.example` hay không (chỉ đổi khi alias không còn hoạt động).

## 3. Bước 1 của spec, phần tự động

```bash
pnpm verify:gemini                 # khoá server
pnpm verify:gemini --user ten@email.com      # khoá đã lưu ở Cài đặt → AI
pnpm verify:gemini --skip image,web          # tiết kiệm hạn mức khi chạy lại
```

Tài liệu mẫu `docs/samples/mau-kiem-chung-gay-me.md` được cắt chunk bằng đúng chunker của pipeline ingest, rồi:

| Bước | Kiểm gì | Tiêu chí pass | Khi fail/warn thì xem |
|---|---|---|---|
| `embedding` | Embed 2 chunk + 4 câu hỏi; max cosine mỗi câu so với ngưỡng 0,25 | câu *direct* và *paraphrase* ≥ 0,25; câu *unrelated* < 0,25; 768 chiều | mục 5 (hiệu chỉnh ngưỡng) |
| `chat` | Hỏi câu có trong nguồn và câu cùng chuyên ngành nhưng nguồn không có; hậu kiểm `[n]` | câu có nguồn: có `[n]`, không bị loại số bịa, không gắn cờ; câu ngoài nguồn: bị gắn cờ (`not_found`/`low_similarity`/`no_citations`) | prompt `defaultChatSystemPrompt` (`src/server/ai/prompts/defaults.ts`) |
| `stream` | Streaming: thời gian tới token đầu, số chunk, trích dẫn | có delta; có `[n]` | độ trễ > 5 s → cân nhắc model nhẹ hơn cho chat |
| `quiz` | `runGenerator("quiz")` với prompt mặc định, 5 câu mcq/tf | ≥ 1 câu hợp lệ, mọi câu có trích dẫn | `src/server/artifacts/generators/quiz.ts`, câu hỏng bị loại chứ không sửa |
| `slides` | Engine slide, 8 slide, súc tích, không ảnh | đúng 8 slide, mọi slide có ghi chú, có slide chart/table (tài liệu có số liệu) | `SlideGenerationError` liệt kê lỗi schema; docs/06 §3 |
| `infographic` | Engine infographic, dọc | ≥ 1 khối `stat`/`chart`; mọi số liệu phải có trong nguồn (engine tự kiểm) | lỗi "số liệu không có trong nguồn" = model bịa số → cần siết prompt |
| `image` | `generateImage` 16:9 → lưu `outputs/verify-gemini-<thời gian>.png` | ≥ 10 KB, mở xem được | model ảnh (bước 2) |
| `web` | `generateText` + `googleSearch` | ≥ 1 nguồn web trong `groundingChunks` | khoá/model không hỗ trợ grounding → tính năng "Web" của sổ tay sẽ không có nguồn |

Mỗi lần chạy ghi `outputs/verify-gemini-<thời gian>.json` (gitignore) gồm câu trả lời đầy đủ, danh sách câu hỏi quiz, tiêu đề slide, nguồn web và tổng token đã dùng. Mở JSON để chấm chất lượng tiếng Việt theo mục 4.3.

Mã thoát: `0` không có fail, `1` có fail, `2` lỗi cấu hình (không có khoá, không tìm thấy người dùng…).

## 4. Bước 1 của spec, phần thủ công trên giao diện

Chạy `pnpm dev`, đăng nhập, tạo sổ tay "Kiểm chứng Gemini". Ghi thời gian, lỗi console, và chấm điểm theo 4.3 vào mục 6.

### 4.1 Nguồn và chat có trích dẫn

1. Thêm nguồn: kéo thả `docs/samples/mau-kiem-chung-gay-me.md`; trạng thái phải đi `pending → processing → ready` (embedding thật chạy ở đây). Mở Source viewer, xem tóm tắt và `key_topics` tự sinh có đúng tiếng Việt, đúng nội dung không.
2. Thêm nguồn thứ hai bằng URL (một bài tổng quan công khai về PONV) để có nguồn khác loại.
3. Hỏi 4 câu trong khung Chat và quan sát:
   - "Thang điểm Apfel gồm những yếu tố nào và nguy cơ PONV khi có 3 yếu tố là bao nhiêu?" → kỳ vọng trả lời 4 yếu tố và 61% kèm `[n]`, chip mở đúng đoạn trong viewer.
   - "Người bệnh được uống nước lọc muộn nhất mấy tiếng trước gây mê?" → 2 giờ, `[n]` trỏ mục 4.
   - "Liều khởi mê propofol ở người lớn?" → phải nói rõ không tìm thấy trong nguồn (thanh cảnh báo thiếu bằng chứng), không bịa.
   - "So sánh ASA III và ASA IV dạng bảng" → kiểm tra Markdown bảng và trích dẫn.
4. Lưu cặp hỏi-đáp, chuyển một câu trả lời thành ghi chú, rồi "Thêm vào nguồn" ghi chú đó (đường ingest lần hai).
5. Bật "cho phép nguồn Internet" trong Cài đặt sổ tay, bật "Web" ở nút phạm vi, hỏi "Khuyến cáo PONV mới nhất năm nay là gì?" → có nguồn web trong "Nguồn đã dùng", chip mở popover URL.

### 4.2 Studio

Tạo mỗi loại một lần với prompt mặc định, ghi thời gian sinh và lỗi (nếu có):

| Loại | Thao tác thêm | Kiểm tra |
|---|---|---|
| Bài thuyết trình | Tuỳ chỉnh: 12 slide, có ảnh minh hoạ (tối đa 2) | Có slide chart/table từ bảng Apfel hoặc nhịn ăn; ảnh xuất hiện ở slide `image_text`; sửa một slide bằng AI; xuất **PPTX** mở bằng PowerPoint/Keynote có text box thật; xuất **PDF** |
| Quiz | 10 câu, trộn mcq/tf/short | Đáp án đúng với nguồn, giải thích tiếng Việt tự nhiên, trích dẫn mở được |
| Thẻ ghi nhớ | mặc định | Xuất CSV/Anki |
| Sơ đồ tư duy | độ sâu 3 | Nhãn không bị cắt vô nghĩa; xuất PNG/SVG |
| Infographic | ngang | Số liệu khớp nguồn 100%; xuất SVG/PDF |
| Báo cáo | kiểu briefing, dài "vừa" | Cấu trúc, tiếng Việt, xuất DOCX |
| Bảng dữ liệu | gợi ý cột "Số yếu tố Apfel, Nguy cơ" | Dữ liệu đúng bảng gốc |

### 4.3 Thang chấm chất lượng tiếng Việt (1–5, ghi cho từng mục)

| Tiêu chí | 1 | 3 | 5 |
|---|---|---|---|
| Đúng nguồn | bịa hoặc sai số liệu | đúng nhưng thiếu ý | đúng và đủ, nêu rõ phần nguồn không có |
| Trích dẫn | thiếu hoặc sai vị trí | có nhưng gộp lỏng | mỗi ý một `[n]` đúng đoạn |
| Tiếng Việt | lẫn tiếng Anh, dịch máy | đọc được, hơi cứng | tự nhiên, đúng thuật ngữ y khoa |
| Cấu trúc | một khối văn bản | có đầu mục | đúng định dạng loại artifact |

Điểm trung bình dưới 3 ở tiêu chí nào thì ghi nhận prompt cần chỉnh (`src/server/ai/prompts/defaults.ts` hoặc `src/server/artifacts/slides/prompts.ts`), kèm ví dụ cụ thể để sửa.

## 5. Hiệu chỉnh ngưỡng "thiếu bằng chứng"

Ngưỡng 0,25 (`INSUFFICIENT_SIMILARITY_THRESHOLD` ở `src/lib/chat.ts`) được chọn khi chỉ có embedding giả lập. Với `gemini-embedding-001`, cosine giữa hai đoạn tiếng Việt **không liên quan** thường không gần 0 như mock, nên phải đo:

1. Lấy bốn giá trị `maxSimilarity` ở bước `embedding` của script (direct, paraphrase, related, unrelated).
2. Ngưỡng tốt nằm **giữa** câu liên quan thấp nhất (paraphrase) và câu không liên quan; script in `suggestedThreshold` là điểm giữa.
3. Kiểm tra lại trên giao diện: với ngưỡng mới, câu "Liều khởi mê propofol" phải bị gắn cờ, hai câu có trong nguồn không bị gắn cờ. Cần thêm ít nhất 3 tài liệu thật khác (bài giảng dài, hướng dẫn, một tệp PDF) để không hiệu chỉnh theo một mẫu.
4. Đổi hằng số trong `src/lib/chat.ts`, chạy `pnpm test` (các test chat dùng mock đã được viết để vượt ngưỡng bằng cách trùng từ; nếu nâng ngưỡng làm test rớt thì chỉnh test, không hạ ngưỡng lại), ghi giá trị mới vào docs/02 §9 bước 4.

## 6. Kết quả (điền sau khi chạy)

| Mục | Ngày | Kết quả | Ghi chú / quyết định |
|---|---|---|---|
| Model chat | 2026-10-18 | `gemini-3.5-flash` pass (8,4 s), `gemini-3-flash-preview` pass (7,4 s); `gemini-flash-latest`, `gemini-3.8-flash` 503 quá tải; `gemini-flash-lite-latest` fail (trích dẫn `[5.1]`) | Google: `gemini-2.5-flash` không còn cho người dùng mới. Đề xuất mặc định `gemini-3.5-flash` — chờ chủ dự án |
| Model artifact | | | chưa thử |
| Model embedding | 2026-10-18 | `gemini-embedding-001` 768 chiều chạy đúng qua ingest thật | giữ |
| Model ảnh | | | chưa thử |
| Embedding: direct / paraphrase / related / unrelated | 2026-10-18 | trên tài liệu thật (DOCX 25 chunk): câu hỏi liên quan đạt 0,83 / 0,78 | chưa đo câu không liên quan; chạy `pnpm verify:gemini --only embedding` khi Gemini hết quá tải |
| Chat có trích dẫn (điểm 4.3) | 2026-10-18 | Đúng nguồn 5, trích dẫn 5, tiếng Việt 5, cấu trúc 5 (câu hỏi SGLT2 trên bản tổng quan; `[n]` mở đúng đoạn) | mẫu 1 câu; cần thêm 3–5 câu khác loại |
| Streaming (token đầu) | 2026-10-18 | có stream, trả lời đủ trong ~12 s | chưa đo token đầu |
| Quiz | | | chưa thử |
| Slide deck + PPTX/PDF | | | chưa thử |
| Infographic | | | chưa thử |
| Ảnh AI | | | chưa thử |
| Web grounding | | | chưa thử |
| Ingest nguồn thật (MD, URL, PDF) | 2026-10-18 | text 67k ký tự từ NotebookLM → 25 chunk ready; tóm tắt AI thất bại vì 503 → dùng tóm tắt trích xuất (đúng thiết kế) | chưa thử PDF/URL |

Sau khi điền: cập nhật `docs/00-spec-du-an.md` §6.1 (đánh dấu đã kiểm chứng), đổi mặc định model/ngưỡng nếu có, và mở việc chỉnh prompt thành các commit `feat(ai): …` riêng.
