# 09 · Kiểm thử

Bốn lớp kiểm thử, tất cả chạy được offline (không cần khoá Gemini nhờ `AI_PROVIDER=mock`).

| Lớp | Công cụ | Thư mục | Chạy bằng |
|---|---|---|---|
| Unit | Vitest (project `server`) | `tests/unit/**` | `pnpm test` |
| API / quyền | Vitest (project `server`) — gọi thẳng route handler với DB thật | `tests/api/**` | `pnpm test` |
| Component | Vitest + Testing Library (project `components`, jsdom) | `tests/components/**` | `pnpm test` |
| End-to-end | Playwright (Chromium, 1 worker) | `tests/e2e/**` | `pnpm e2e` |

Cổng chất lượng trước khi gộp: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`.

## 1. Chuẩn bị

- PostgreSQL 16 có `vector` + `pg_trgm`, tài khoản có quyền tạo DB (`kbm`/`kbm` trong ví dụ).
- `cp .env.example .env` (DB dev; e2e dùng DB dev này).
- Chromium cho Playwright: dùng bản cài sẵn trong `/opt/pw-browsers/chromium-1194/…` hoặc đặt `PW_CHROMIUM_PATH=/đường/dẫn/chrome`. Không chạy `playwright install` trong môi trường chặn mạng.

## 2. Unit + API + component (`pnpm test`)

```bash
pnpm test                                   # toàn bộ
npx vitest run --project server tests/api/community.test.ts     # một tệp
npx vitest run --project components         # chỉ component
```

- **DB test**: `globalSetup` (`tests/setup/global-setup.ts`) **xoá và tạo lại** DB `kbm_notebook_test` rồi chạy toàn bộ migration trong `drizzle/` mỗi lần chạy. Đổi DB bằng `TEST_DATABASE_URL` (tên DB phải chứa `test`, nếu không setup từ chối chạy). Khi nhiều người/tiến trình chạy song song trên cùng máy Postgres hãy dùng DB khác nhau: `TEST_DATABASE_URL=postgres://kbm:kbm@localhost:5432/kbm_notebook_test_alice pnpm test`.
- **Biến môi trường test** nằm trong `vitest.config.mts` (`AI_PROVIDER=mock`, khoá giả, `STORAGE_DIR=storage/.test`, `MAX_UPLOAD_MB=1`) — không đọc `.env`.
- **API test** dựng `Request` thật và gọi handler (`tests/helpers/users.ts`: `createTestUser` đăng ký + đăng nhập qua better-auth để lấy cookie; `makeRequest`, `params`). Không mock DB; mỗi bài test tạo người dùng/sổ tay mới nên độc lập.
- **Helper dữ liệu**: `tests/helpers/fixtures.ts` (`createNotebookWithMembers`, `insertSource`, `insertArtifact`), `artifacts.ts` (`insertReadySource` có chunk + embedding băm xác định, `runJobsOfType`), `team-chat.ts` (kênh, gửi tin), `fake-bridge.ts` (NotebookLM Bridge giả cho test connector).

### Provider AI giả lập (mock) và fixture

- `AI_PROVIDER=mock` → `MockAiProvider` (`src/server/ai/mock.ts`): embedding băm theo từ (xác định), `generateText/Stream` trả lời dựa trên ngữ cảnh. Với nguồn ngắn, cosine chỉ vượt ngưỡng "đủ bằng chứng" (0,25) khi câu hỏi trùng nhiều từ với đoạn văn — các test/e2e dùng nguồn ngắn và câu hỏi trùng từ.
- Sinh artifact: `mock-artifacts.ts` dựng JSON hợp schema từ chính các câu trong ngữ cảnh (tiêu đề gắn "[mock]"). Ghi đè đầu ra: `registerMockJson(key, json)` / `registerMockJsonFn` / `clearMockJson()` trong test, hoặc đặt thư mục `MOCK_AI_FIXTURES_DIR` chứa `artifact_<loại>.json` (vd. `artifact_quiz.json`) cho QA thủ công.
- Slide/infographic có fixture dev tại `src/app/(app)/dev/**/sample-*.json` (xem nhanh ở `/dev/slides`, `/dev/infographic` — **chỉ dev**, production trả 404).

### Các tệp test của P6

| Tệp | Kiểm tra |
|---|---|
| `tests/api/community.test.ts` | thích/bình luận (artifact riêng tư → 404, công khai → được, quyền xoá bình luận), Explore (lọc/sắp xếp/phân trang, ẩn tên sổ tay riêng), sổ tay công khai (chỉ owner; **không lộ nguồn/ghi chú/chat**), luồng yêu cầu tham gia (thông báo, chấp nhận/từ chối, quyền, 409) |
| `tests/api/groups.test.ts` | tạo nhóm, nhóm mở/kín, thêm bằng email, vai trò, liên kết sổ tay (cần thành viên nhóm **và** admin sổ tay), ổ khoá |
| `tests/api/search.test.ts` | tìm kiếm toàn cục: chỉ sổ tay mình là thành viên, nguồn/ghi chú/artifact riêng và DM bị ẩn, snippet đánh dấu, liên kết sâu, nhóm cộng đồng |
| `tests/api/rate-limits.test.ts` | 429 `rate_limited` cho sinh artifact (20/10 phút), tin nhắn nhóm (120/phút), bình luận (20/phút) |
| `tests/unit/community-utils.test.ts` | `slugify`, `buildTsQuery` (an toàn), `makeSnippet`, `splitHighlight`, validator tìm kiếm |
| `tests/e2e/community.spec.ts` | Explore → mở artifact công khai → thích → bình luận; ⌘K → tìm toàn cục → mở kết quả; công khai sổ tay → yêu cầu tham gia → chủ duyệt (hai context); nhóm học tập |

## 3. End-to-end (`pnpm e2e`)

```bash
rm -rf .next                  # tránh cache cũ
pkill -f "tsx.*server.ts" || true   # Next chỉ cho MỘT dev server mỗi thư mục
pnpm e2e                      # tự chạy `pnpm dev` ở cổng E2E_PORT (mặc định 3200)
E2E_PORT=4001 npx playwright test tests/e2e/community.spec.ts    # một tệp, cổng khác
```

- `playwright.config.ts` khởi động `pnpm dev` với `AI_PROVIDER=mock`, `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` theo cổng; `reuseExistingServer` khi không phải CI nên có thể tự chạy dev server trước (với các biến trên) để tái sử dụng giữa nhiều lần chạy.
- E2E dùng **DB dev** (`DATABASE_URL` trong `.env`) — mỗi test đăng ký người dùng mới với email theo `Date.now()` nên không đụng dữ liệu cũ. Dữ liệu thử tích luỹ trong DB dev; xoá bằng cách tạo lại DB dev khi cần.
- Mặc định `expect.timeout` 15 giây vì lần mở trang đầu tiên ở dev bị Turbopack biên dịch.
- Thiết lập dữ liệu trong test đi qua API thật (đăng ký, tạo sổ tay, thêm nguồn, tạo artifact), chờ job hoàn tất rồi mới thao tác giao diện.
- Ảnh chụp lỗi, trace: `test-results/` (đã gitignore).

## 4. Kiểm tra bản production

```bash
pnpm build
PORT=4100 BETTER_AUTH_URL=http://localhost:4100 NEXT_PUBLIC_APP_URL=http://localhost:4100 pnpm start &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4100/dev/slides        # 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4100/dev/infographic   # 404
```

`src/proxy.ts` trả 404 cho `/dev/*` khi `NODE_ENV=production` (kể cả chưa đăng nhập) và các trang `/dev/*` tự `notFound()`.

## 5. Danh mục kiểm thử thủ công (QA) theo mô-đun

Dùng `AI_PROVIDER=mock` cho luồng không cần Gemini thật; các mục có `[AI]` nên thử thêm với khoá Gemini thật.

**Xác thực & sổ tay (P0)**
- Đăng ký / đăng nhập / đăng xuất; vào `/` khi chưa đăng nhập bị chuyển về `/login?next=…`; đăng nhập Google nếu đã cấu hình.
- Dashboard rỗng hiện hướng dẫn 3 bước (Tạo sổ tay → Thêm nguồn → Hỏi/Studio); tạo sổ tay, đổi emoji/màu, tìm theo tên.
- Mời thành viên (email có/chưa có tài khoản → liên kết mời), đổi vai trò, xoá, rời; owner chuyển quyền/xoá sổ tay; viewer không thấy nút sửa.
- Lần đầu mở sổ tay có thanh mẹo; "Đã hiểu" ẩn và nhớ (localStorage).

**Nguồn (P1)**
- Tải PDF/DOCX/PPTX/XLSX/MD/TXT/CSV/HTML (kéo thả nhiều tệp), thêm URL, dán văn bản; trạng thái chuyển `pending → processing → ready` theo thời gian thực.
- Mở Source viewer, đoạn trích dẫn được cuộn tới và tô sáng (`?chunk=`); đổi tên, đổi riêng tư/chia sẻ, xoá; nguồn riêng tư của người khác không hiện.
- Tệp quá `MAX_UPLOAD_MB`, URL nội bộ (SSRF) bị từ chối với thông báo rõ.

**Chat AI & Ghi chú (P2)** `[AI]`
- Hỏi câu có trong nguồn → trả lời có chip `[n]`, hover xem trích đoạn, bấm mở viewer; câu không có trong nguồn → nêu rõ thiếu bằng chứng.
- Dừng khi đang stream; lưu cặp Q&A; chuyển thành ghi chú; ghi chú → thêm vào Nguồn; chọn phạm vi nguồn; bật "tìm kiếm web" ở cài đặt sổ tay.
- Hội thoại là riêng từng người (người khác, kể cả owner, không thấy).

**Studio (P3)** `[AI]`
- Tạo từng loại: báo cáo, hướng dẫn, FAQ, timeline, quiz, thẻ nhớ, sơ đồ tư duy, bảng, bài thuyết trình, infographic; hộp "Tuỳ chỉnh" (prompt riêng, tuỳ chọn).
- Sửa nội dung, lưu phiên bản, khôi phục, nhân bản, tạo lại, xoá; xung đột phiên bản (mở hai tab).
- Xuất: PPTX (mở bằng PowerPoint/LibreOffice, text box thật), DOCX, PDF (cần Chromium), PNG/SVG, CSV, MD, Anki TSV.
- Chia sẻ: riêng tư / sổ tay / ai có liên kết (xoay token) / công khai (chỉ owner); chia sẻ theo email với quyền xem/sửa.

**Chat nhóm (P4)**
- Hai trình duyệt: tin nhắn tức thời, đang nhập, đã xem, reaction, trả lời, sửa/thu hồi/xoá, ghim, đính kèm tệp/ảnh, mention `@` → thông báo.
- Kênh chủ đề, DM (người thứ ba không thấy, API trả 403/404), tìm kiếm trong kênh; thẻ artifact/nguồn/ghi chú mở đúng đích; "chuyển vào Nguồn", "tạo ghi chú từ tin nhắn".
- Dưới 1024px: tab "Nhóm", huy hiệu chưa đọc.

**Kết nối (P5)**
- Cài đặt → Kết nối: lưu cấu hình Bridge/Enterprise, "Kiểm tra kết nối" gọi thật (trạng thái chỉ hiện sau khi gọi); Google Drive: cấp quyền, chọn tệp, nhập thành nguồn.
- Hỏi qua NotebookLM Bridge (cần sidecar chạy thật, xem `bridge/notebooklm/README.md`); credential không bao giờ trả về client.

**Cộng đồng (P6)**
- Cài đặt sổ tay (owner) → "Công khai sổ tay": bật, đổi slug, slug trùng báo lỗi; mở `/p/<slug>` khi chưa đăng nhập: chỉ thấy tiêu đề/mô tả/emoji/artifact công khai.
- Người lạ bấm "Yêu cầu tham gia" → owner/admin có thông báo + mục "Yêu cầu tham gia" ở trang Thành viên → chấp nhận (thành Người xem) / từ chối; người gửi nhận thông báo.
- Đặt một artifact ở chế độ "Công khai" → xuất hiện ở `/explore` (lọc loại, sắp xếp, tìm tiêu đề, "Tải thêm"); mở `/a/<id>` đọc được mọi loại; thích/bỏ thích, bình luận markdown, xoá bình luận của mình; khách không thể thích/bình luận.
- Nhóm: tạo nhóm mở/kín, tham gia (mở), thêm bằng email (kín), liên kết sổ tay (chỉ sổ tay bạn là admin), người chưa vào sổ tay chỉ thấy tiêu đề + ổ khoá.

**Tìm kiếm toàn cục & tiện ích (P6)**
- `⌘K`/`Ctrl+K` → gõ từ khoá → "Tìm toàn bộ cho …" → `/search?q=`: kết quả theo nhóm, đoạn trích đánh dấu, `↑/↓` + `Enter`, `/` để tìm lại; mở kết quả tới đúng nguồn (`?chunk=`), ghi chú, artifact, tin nhắn (`message=`).
- Không rò rỉ: người ngoài sổ tay không thấy gì; nguồn/ghi chú/artifact riêng và DM của người khác không xuất hiện.
- Giao diện tối (Cài đặt → Giao diện hoặc menu tài khoản): rà từng trang chính; thu nhỏ 390px/820px: không cuộn ngang.
- Giới hạn tần suất: gửi nhanh >120 tin/phút hoặc tạo >20 artifact/10 phút → toast báo thử lại sau.
- Lỗi hiển thị: ép lỗi trang (ví dụ tạm đổi `DATABASE_URL` sai) → màn hình "Đã xảy ra lỗi" có nút "Thử lại"; sổ tay không tồn tại → trang "Không tìm thấy sổ tay".
