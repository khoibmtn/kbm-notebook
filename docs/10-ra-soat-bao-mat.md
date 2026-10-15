# 10 · Rà soát bảo mật & tính đúng đắn

Tài liệu này tóm tắt kết quả rà soát code (nhánh `claude/dazzling-rubin-xivuuk`, 39 phát hiện: 1 Critical, 6 High, 15 Medium, 17 Low) và **trạng thái xử lý từng mục**. Mỗi mục đã sửa có test hồi quy (đường dẫn ở cột cuối / mục 4). Nguyên tắc: sửa tận gốc những mục rõ ràng và rẻ; mục nào cố ý chưa sửa thì ghi rõ lý do và biện pháp bù (mục 3).

Ký hiệu trạng thái: **Đã sửa** · **Sửa một phần** (ghi phần còn lại) · **Bỏ qua** (có lý do).

## 1. Bảng phát hiện và trạng thái

### Critical / High

| ID | Phát hiện (tóm tắt) | Trạng thái | Cách xử lý |
|---|---|---|---|
| C-1 | Tệp tải lên làm treo event-loop của cả tiến trình (XLSX khai báo vùng `A1:XFD1048576`; regex PPTX O(n²)) | **Đã sửa** | Trích xuất chạy trong `worker_threads` có timeout cứng (`INGEST_EXTRACT_TIMEOUT_SEC`, mặc định 120 s) và giới hạn bộ nhớ (`INGEST_EXTRACT_MAX_MB`); quá hạn/hết RAM → worker bị dừng, nguồn `failed` kèm thông báo tiếng Việt. PPTX parse bằng `fast-xml-parser` (giới hạn độ sâu thẻ/entity), tối đa 2000 slide. XLSX: thu hẹp `!ref` về vùng dữ liệu thật và từ chối > 500.000 ô trước `sheet_to_json`. |
| H-1 | Upload đệm cả body vào RAM, không rate-limit/quota/dọn rác | **Đã sửa** | `src/server/storage/multipart.ts`: stream multipart (busboy) thẳng xuống đĩa; 413 theo `Content-Length` trước khi đọc body, đếm byte cả khi chunked; hạn mức theo người dùng (30 tệp/10 phút, 300 MB/giờ) qua `rate_limits`; quota `MAX_NOTEBOOK_STORAGE_MB` (mặc định 2048) theo `files.notebook_id`; job `cleanup_orphan_files` mỗi giờ (tệp chat chưa gắn tin nhắn > 24 giờ); xoá nguồn trả lại dung lượng. Ảnh artifact (1 tệp ≤ `MAX_UPLOAD_MB`) vẫn đọc vào RAM nhưng có trần + hạn mức. |
| H-2 | SSRF qua Bridge URL (mặc định cho phép host nội bộ; thiếu dải CGNAT/IMDS IPv6; phản chiếu lỗi thô) | **Đã sửa** | `CONNECTORS_ALLOW_PRIVATE_HOSTS` mặc định `false`; chính sách IP dùng chung `src/server/net/ip-policy.ts` (CGNAT, `192.0.0.0/24`, `198.18.0.0/15`, `fd00:ec2::/32`, Teredo, 6to4/NAT64 nhúng IPv4); lỗi Bridge chỉ dùng mã lỗi đã biết + HTTP status, `health.detail` được làm sạch/cắt ngắn. |
| H-3 | `/api/files/[id]?share=` quét `jsonb_path_exists` toàn bảng khi chưa đăng nhập | **Đã sửa** | Quy token về MỘT artifact bằng chỉ mục unique `share_token`, rồi chỉ tra khoá chính `artifact_files(artifact_id,file_id)` + phiên bản hiện tại của artifact đó; rate-limit 300 lượt/phút/IP. Bảng `artifact_files` (backfill trong migration). |
| H-4 | Email chưa xác minh được dùng làm danh tính | **Đã sửa** | better-auth `emailVerification` + `EmailSender` (`ConsoleEmailSender` mặc định, SMTP qua nodemailer khi có `SMTP_URL`); cổng `emailVerified` cho (a) thêm thẳng thành viên theo email (chưa xác minh → tạo lời mời), (b) khớp `artifact_shares.email`, (c) chấp nhận lời mời bằng liên kết (403 `email_not_verified`); banner “Email chưa xác minh” + nút gửi lại. `AUTH_REQUIRE_EMAIL_VERIFICATION` mặc định `true` ở production, `false` ở dev/test. Đăng nhập Google: đã được nhà cung cấp xác minh. |
| H-5 | Nguồn riêng tư lộ qua artifact / ghi chú chia sẻ | **Đã sửa** | Phạm vi có nguồn riêng tư → artifact mặc định `private` + cờ `artifacts.contains_private_sources` (có trong DTO); chuyển sang `notebook|link|public` → 409 `private_sources_not_shareable`; artifact đang chia sẻ không được dùng nguồn riêng tư khi tạo lại (409 / tự loại khỏi phạm vi mặc định); bản sao giữ riêng tư; `content.evidence[].text` của nguồn riêng tư bị bỏ nếu artifact không riêng tư; “Lưu thành ghi chú” từ câu trả lời có nguồn riêng tư → ghi chú `private`. Migration đưa artifact cũ chứa trích đoạn nguồn riêng tư về `private` và thu hồi `share_token`. |
| H-6 | Artifact vẫn xem được sau khi xoá sổ tay | **Đã sửa** | `canViewArtifact` và `findArtifactByToken` kiểm `notebooks.deleted_at IS NULL` (và `artifacts.deleted_at`); `/api/files?share=` cũng join `notebooks`. |

### Medium

| ID | Phát hiện | Trạng thái | Cách xử lý / lý do |
|---|---|---|---|
| M-1 | Khách (token/public) thấy `generationConfig` và lịch sử phiên bản | **Đã sửa** | `ArtifactAccess.internal` (thành viên, người tạo, được chia sẻ riêng); khách: `generationConfig = null`, danh sách phiên bản chỉ có bản hiện tại, bản cũ → 404. |
| M-2 | `share_token` sống lại khi bật lại link | **Đã sửa** | Token bị xoá khi rời link/public; bật lại `link` luôn sinh token mới. |
| M-3 | Quyền đọc ảnh dựa vào `fileId` trong JSON client sửa được | **Đã sửa** | Luật truy cập chỉ dùng `artifact_files` do server ghi (upload ảnh, ảnh AI); fork sao chép liên kết; backfill chỉ nhận tệp do chủ artifact/thành viên sở hữu. |
| M-4 | Ngưỡng “thiếu bằng chứng” bị tắt bởi 1 bằng chứng thiếu similarity; không cảnh báo khi không có `[n]` | **Đã sửa** | Cosine được tính cho cả đoạn chỉ khớp từ khoá; chỉ xét đoạn `kind=chunk` có similarity (web/`external_answer` không tắt cảnh báo); `insufficientReason` (`no_evidence`, `not_found`, `low_similarity`, `no_citations`) lưu ở `messages.insufficient_reason`, UI có thông báo riêng cho `no_citations`. |
| M-5 | Trích dẫn artifact không đối chiếu với nguồn thật | **Sửa một phần** | PATCH nội dung: `content.evidence` chỉ được giữ hoặc bỏ bớt mục có sẵn (400 `evidence_tampered`); mọi số `citations`/`[n]` phải trỏ vào `evidence` (400 `invalid_citation`). **Chưa làm:** cờ “0 trích dẫn” cho artifact do AI sinh (cần thiết kế UI riêng). |
| M-6 | Xoá thành viên không dọn kết nối/lời mời | **Đã sửa** | `removeMember` xoá `notebook_connections` của họ và lời mời chưa chấp nhận họ tạo; `acceptInvite` kiểm người mời còn là thành viên và còn đủ quyền gán vai trò (409 `invite_revoked`). |
| M-7 | Thiếu rate-limit cho thao tác tốn tiền/CPU | **Sửa một phần** | `src/server/api/limits.ts`: ai-edit 20, xuất PDF/PNG/SVG 10, thêm URL nguồn 30 (mỗi 10 phút/người dùng); tạo/tạo lại artifact 20/10 phút (`ARTIFACT_RATE`), gửi tin nhắn nhóm 120/phút và bình luận 20/phút do P6 bổ sung; `MAX_INGEST_TOKENS_PER_DAY`; tên mô hình client gửi phải khớp `[A-Za-z0-9._-]`. **Chưa làm:** hạn mức tạo DM/thông báo và allowlist mô hình theo cấu hình (cần quyết định sản phẩm — chặn tên mô hình đắt tiền). |
| M-8 | Token Google lưu rõ trong `accounts` | **Bỏ qua** | Bật `encryptOAuthTokens` cần migrate dữ liệu hiện có và đổi đường đọc token của `connectors/drive.ts` (đọc trực tiếp bảng `accounts`); rủi ro hỏng liên kết Drive đang dùng. Biện pháp bù: mã hoá đĩa/sao lưu ở tầng hạ tầng, scope chỉ `drive.readonly`. Nên làm ở đợt riêng cùng kịch bản migrate. |
| M-9 | `.env.example` có khoá mẫu; không có chốt chặn production | **Sửa một phần** | `NODE_ENV=production` từ chối khởi động nếu `APP_ENCRYPTION_KEY` toàn số 0 hoặc `BETTER_AUTH_SECRET` chứa `change-me`. **Chưa làm:** key-id/xoay khoá trong định dạng ciphertext (đổi định dạng dữ liệu, cần kế hoạch migrate). |
| M-10 | Lọc nhiều sổ tay sau khi quét HNSW | **Đã sửa** | Truy vấn vector chạy trong transaction với `hnsw.ef_search = 100` và `hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8; bản cũ bỏ qua, thử trong savepoint). Test xác nhận tham số được áp dụng; tái hiện lỗi gốc cần kho dữ liệu lớn nên không có test hành vi đầy đủ. |
| M-11 | Truy vấn không `LIMIT` | **Sửa một phần** | Lượt hỏi chỉ đọc 60 tin nhắn gần nhất; danh sách ghi chú chỉ lấy 4000 ký tự đầu `content_md`. **Chưa làm:** phân trang `GET /conversations/:id`, danh sách nguồn/artifact, và rút gọn `messages.citations` (đổi cấu trúc dữ liệu đã lưu). |
| M-12 | Job dài bị `requeueStaleJobs` chạy trùng; worker chung tiến trình | **Sửa một phần** | Heartbeat 60 s làm mới `locked_at` khi job đang chạy. Trích xuất tài liệu (nguồn treo chính) đã tách sang worker thread (C-1). **Chưa làm:** tách worker job thành tiến trình riêng (thay đổi triển khai). |
| M-13 | `xlsx` 0.18.5 có CVE; giải nén không giới hạn | **Sửa một phần** | Mọi trích xuất (XLSX/DOCX/PPTX/PDF/HTML) chạy trong worker thread có timeout + giới hạn heap → prototype pollution/ReDoS/zip-bomb không còn ảnh hưởng tiến trình chính; giới hạn ô XLSX và số slide PPTX. **Chưa làm:** nâng `xlsx` — bản ≥ 0.20.3 chỉ phát hành qua CDN của SheetJS (không có trên npm registry), không cài được trong môi trường build offline. |
| M-14 | Thiếu header bảo mật | **Đã sửa** | `next.config.ts` → `src/lib/security-headers.ts`: `frame-ancestors 'self'`, `object-src 'none'`, `base-uri`, `form-action`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; trang `/s`, `/a`, `/invite` dùng `no-referrer`. **Chưa làm:** CSP `script-src` đầy đủ (cần nonce cho script nội tuyến của Next). |
| M-15 | Vòng lặp redirect `/login` ⇄ `/` với cookie cũ | **Đã sửa** | `proxy` không redirect `/login`, `/register` theo cookie; hai trang tự kiểm session thật rồi mới chuyển về trang đích. |

### Low

| ID | Phát hiện | Trạng thái | Cách xử lý / lý do |
|---|---|---|---|
| L-1 | Socket.IO không kiểm Origin | **Sửa một phần** | `allowRequest` kiểm Origin (cùng host hoặc `TRUSTED_ORIGINS`). **Chưa làm:** kiểm lại session định kỳ, throttle `join:*`. |
| L-2 | Chromium `--no-sandbox` + JS bật | **Bỏ qua** | Phụ thuộc môi trường chạy (container không-root/seccomp); tắt JS làm hỏng mind map (markmap). Nội dung vào HTML đều đã escape/parse chặt. |
| L-3 | Bằng chứng web là tóm tắt chung | **Bỏ qua** | Cần ánh xạ `groundingSupports` của Gemini → URL (đổi hành vi sản phẩm). |
| L-4 | Kết nối Bridge chia sẻ: câu hỏi của mọi người vào tài khoản của chủ kết nối | **Bỏ qua** | Là hành vi có chủ đích, đã ghi nhận trong tài liệu kết nối; cảnh báo ở điểm hỏi là việc UI. |
| L-5 | Tệp “đã thu hồi”/mồ côi còn trên đĩa | **Sửa một phần** | Xoá nguồn xoá tệp gốc nếu không còn tham chiếu; job dọn tệp chat mồ côi > 24 giờ (gồm tệp của tin đã thu hồi). Thu hồi tin vẫn giữ tệp cho chủ tệp tới khi bị dọn (hành vi có test). |
| L-6 | Regex id uuid lỏng → 500 | **Đã sửa** | Dùng `isUuid()` chặt. |
| L-7 | `JSON.parse` không bọc lỗi | **Đã sửa** | Body hỏng → 400 `invalid_json`. |
| L-8 | Race khi chuyển quyền / tạo chủ đề trùng | **Sửa một phần** | `transferOwnership` khoá hàng chủ sở hữu (`FOR UPDATE`), yêu cầu thứ hai → 409 `not_owner`. **Chưa làm:** unique index tên chủ đề (dữ liệu cũ có thể trùng làm migration thất bại). |
| L-9 | Admin xoá hộ tin trong DM | **Đã sửa** | Quyền kiểm duyệt không áp dụng cho kênh `dm`. |
| L-10 | Rò metadata realtime | **Đã sửa** | Xoá nguồn riêng tư và `job:progress` của nguồn riêng tư chỉ báo cho chủ nguồn; thẻ tham chiếu không còn khả dụng không trả `title`. |
| L-11 | Mô hình embedding khác nhau giữa người dùng | **Bỏ qua** | Cần cố định mô hình ở cấp sổ tay/server + lưu `embedding_model` + embedding lại; thay đổi dữ liệu lớn (đã ghi nhận trong docs). |
| L-12 | `renderUserPrompt` diễn giải `$&` | **Đã sửa** | Dùng hàm thay thế. |
| L-13 | Editor đặt được `link`; viewer thấy email thành viên | **Bỏ qua** | Quyết định sản phẩm (ma trận quyền). Nếu muốn giới hạn: kiểm `role >= admin` trong `setVisibility` và che email trong `listMembers`. |
| L-14 | Khử trùng “chuyển tệp chat vào Nguồn” lộ nguồn riêng tư | **Đã sửa** | Chỉ khử trùng theo nguồn người gọi xem được. |
| L-15 | `.env.example` thiếu biến | **Đã sửa** | Bổ sung mọi biến thực dùng; route upload chat dùng `env().MAX_UPLOAD_MB`. |
| L-16 | Content-Type do client khai | **Sửa một phần** | Chỉ MIME trong allowlist mới inline; MIME không hợp lệ → `application/octet-stream` (không còn 500). **Chưa làm:** sniff byte khi lưu. |
| L-17 | Không kiểm Origin cho request thay đổi trạng thái | **Đã sửa** | `handleRoute` từ chối POST/PUT/PATCH/DELETE có `Sec-Fetch-Site: cross-site|same-site` hoặc `Origin` lạ (403 `forbidden_origin`); `parseBody` yêu cầu `Content-Type` JSON (415). Kiểm ở route wrapper (không ở `proxy`) vì Next đệm body ở middleware, làm hỏng upload lớn. |

## 2. Thay đổi kiến trúc đáng chú ý

- **Worker trích xuất** (`ingest/extract-sandbox.ts`, `ingest/extract-worker.ts`): `pipeline.ts` gọi `extractFileSandboxed/extractUrlSandboxed`. Dev/test: worker được esbuild đóng gói vào `node_modules/.cache/kbm-extract-worker/` lúc dùng lần đầu; production: `pnpm build` tạo `dist/extract-worker.js` (cạnh `dist/server.js`, hoặc đặt `EXTRACT_WORKER_PATH`). Thiếu tệp này ở production thì nguồn lỗi tạm thời “Thiếu tệp dist/extract-worker.js”.
- **Tải lên theo dòng** (`storage/multipart.ts`, `storage/quota.ts`): `receiveMultipart()` trả các tệp đã ghi (`files`) và tệp bị từ chối (`rejected`: 415/413/429…); tệp lỗi không để lại dòng/byte nào.
- **Dung lượng theo sổ tay**: `files.notebook_id` + `files.origin` (`source_upload`, `chat_upload`, `artifact_image`, `export`, `drive`).
- **Xác minh email**: `src/server/auth/email-verified.ts` (`verifiedEmailCondition`, `requireTrustedEmail`), `src/server/email/index.ts`. Banner ở `(app)/layout.tsx`; chuỗi UI ở `src/i18n/modules/security.*.ts`.
- **Nguồn riêng tư và artifact**: `resolveScopeSourceIds(..., { allowPrivate })`, `stripPrivateEvidenceText`, `artifacts.contains_private_sources`; job `generate_artifact` ép `private` + thu hồi `share_token` nếu nội dung có nguồn riêng tư.

## 3. Mục cố ý chưa sửa — tóm tắt

M-8 (mã hoá token OAuth), M-9 (xoay khoá), nâng `xlsx` (M-13), tách tiến trình worker (M-12), phân trang đầy đủ (M-11), CSP `script-src` (M-14), L-2, L-3, L-4, L-11, L-13 và các phần “Chưa làm” ở bảng trên. Lý do nằm ở từng dòng; không mục nào bị bỏ vì khó chứng minh — đều cần quyết định sản phẩm, thay đổi định dạng dữ liệu, hoặc thay đổi hạ tầng.

## 4. Biến môi trường mới

`AUTH_REQUIRE_EMAIL_VERIFICATION`, `SMTP_URL`, `EMAIL_FROM`, `MAX_NOTEBOOK_STORAGE_MB`, `MAX_UPLOAD_REQUEST_MB`, `UPLOAD_MAX_FILES_PER_10MIN`, `UPLOAD_MAX_MB_PER_HOUR`, `MAX_INGEST_TOKENS_PER_DAY`, `INGEST_EXTRACT_TIMEOUT_SEC`, `INGEST_EXTRACT_MAX_MB`, `EXTRACT_WORKER_PATH` (tuỳ chọn). **Đổi mặc định:** `CONNECTORS_ALLOW_PRIVATE_HOSTS` từ `true` → `false`. Chi tiết ở `README.md` và `.env.example`.

## 5. Migration

`drizzle/0003_security_indexes.sql` (một tệp): `artifact_files`, `artifacts.contains_private_sources`, `files.notebook_id/origin` (+ chỉ mục), `messages.insufficient_reason`, rồi **backfill dữ liệu cũ** (điền `files.notebook_id/origin`, dựng `artifact_files` từ các phiên bản hiện có, gắn cờ và đưa artifact chứa trích đoạn nguồn riêng tư về `private`). Phần backfill được test trên DB tạm (`tests/api/migration-0003.test.ts`).

> Đã đánh số sau migration P6 `0002_community_search` (journal idx 3, snapshot `0003_snapshot.json` sinh trên schema đã hợp nhất). Nếu thêm migration khác trước nó, đổi tên và chạy lại `pnpm db:generate`.

## 6. Vận hành sau proxy

- Rate-limit truy cập tệp chia sẻ theo IP đọc `X-Real-IP` / phần tử cuối của `X-Forwarded-For`: reverse proxy phải **đặt** (ghi đè) các header này, nếu không mọi khách chung một nhóm.
- Kiểm tra Origin dùng `Host`/`X-Forwarded-Host`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `TRUSTED_ORIGINS`.
- Production cần SMTP (`SMTP_URL`) để người dùng nhận được email xác minh; nếu không, liên kết chỉ nằm trong log máy chủ.

## 7. Kiểm thử hồi quy

`tests/unit/extract-sandbox.test.ts` (C-1), `tests/api/upload-limits.test.ts` (H-1), `tests/unit/connectors.test.ts` + `tests/unit/ssrf.test.ts` (H-2), `tests/api/artifact-files.test.ts` (H-3, M-3), `tests/api/email-verification.test.ts` + `tests/components/verify-email.test.tsx` (H-4), `tests/api/artifact-security.test.ts` + `tests/api/chat.test.ts` (H-5, H-6, M-1, M-2, M-5), `tests/unit/citations.test.ts` (M-4), `tests/api/member-removal.test.ts` (M-6), `tests/api/rate-limits-security.test.ts` (M-7; tạo/tạo lại artifact dùng `ARTIFACT_RATE` của P6, test ở `rate-limits.test.ts`), `tests/unit/env-guard.test.ts` (M-9), `tests/api/vector-multi-notebook.test.ts` (M-10), `tests/api/bounded-queries.test.ts` (M-11), `tests/unit/jobs.test.ts` (M-12), `tests/unit/security-headers.test.ts` (M-14), `tests/unit/proxy.test.ts` (M-15), `tests/api/low-findings.test.ts` + `tests/api/csrf-origin.test.ts` + `tests/unit/request-origin.test.ts` + `tests/api/team-chat-realtime.test.ts` (L-*), `tests/api/migration-0003.test.ts` (migration).
