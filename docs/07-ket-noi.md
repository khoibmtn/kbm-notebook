# 07 · Kết nối ngoài (P5): NotebookLM Bridge, NotebookLM Enterprise, Google Drive

Tài liệu này mô tả cách từng kênh kết nối hoạt động, giới hạn thật của chúng, mô hình bảo mật credential và cách cài đặt. Đây là hiện thực của quyết định sản phẩm ở [docs/01 §3](01-nghien-cuu.md): **không có API chính thức cho NotebookLM cá nhân**, nên có ba kênh thật:

| Kênh | Chính thức? | Làm được | Không làm được |
|---|---|---|---|
| **NotebookLM Bridge** (sidecar `bridge/notebooklm`) | **Không** — bọc thư viện cộng đồng `notebooklm-py` gọi endpoint nội bộ của Google | Liệt kê notebook, hỏi đáp có trích dẫn, thêm nguồn (text/URL/tệp), tạo ghi chú, **xuất văn bản nguồn** để nhập | Chạy ổn định lâu dài (Google đổi giao thức là hỏng), chia sẻ nhiều người trên một tài khoản an toàn |
| **NotebookLM Enterprise** (Discovery Engine `v1alpha`, **Preview**) | Có (bản alpha) | Liệt kê/tạo/lấy notebook, thêm nguồn text/URL, chia sẻ | **Không có hỏi đáp (chat)**, không có ghi chú, không xuất nội dung nguồn. Cần giấy phép Gemini/NotebookLM Enterprise + dự án GCP |
| **Google Drive** (Drive API v3, OAuth) | Có | Duyệt/tìm tệp, nhập vào Nguồn (Docs/Slides/Sheets → docx/pptx/xlsx) | Ghi vào Drive; quyền chỉ `drive.readonly` |

> Mọi trạng thái kết nối trong giao diện (chấm xanh/đỏ, "Sẵn sàng", `authenticated`, số notebook) đến từ **một lời gọi thật** tới dịch vụ. Không có chế độ giả. Khi dịch vụ lỗi, thông báo lỗi gốc được hiển thị.

## 1. Cài đặt cấp người dùng — Cài đặt → Kết nối

Dữ liệu lưu ở `user_settings.connectors_enc` (cột mới, migration `0001_connectors_enc.sql`): **một** chuỗi JSON mã hoá AES-256-GCM bằng `APP_ENCRYPTION_KEY`. API chỉ trả về dạng che (`tokenMask`, email service account…). Token/khoá không bao giờ quay lại trình duyệt, không có trong HTML.

### 1.1 NotebookLM Bridge

1. Cài và chạy sidecar theo [bridge/notebooklm/README.md](../bridge/notebooklm/README.md) (tóm tắt: `pip install -e .`, `notebooklm login`, đặt `BRIDGE_TOKEN`, chạy `uvicorn app.main:app --host 127.0.0.1 --port 8765`). **Nên dùng tài khoản Google riêng.**
2. Cài đặt → Kết nối → NotebookLM Bridge: nhập **Bridge URL** (`http://127.0.0.1:8765`) và **Token** (`BRIDGE_TOKEN`).
3. **Địa chỉ nội bộ/LAN**: vì người dùng chạy Bridge trên máy của mình, URL thường là `localhost`/LAN. Đây là SSRF có chủ đích nên phải **bật tường minh** công tắc "Cho phép địa chỉ nội bộ / LAN" (kèm cảnh báo). Quy tắc (`src/server/connectors/http.ts`):
   - **Mặc định máy chủ chặn hẳn** host nội bộ (`CONNECTORS_ALLOW_PRIVATE_HOSTS=false`) → `400 private_host_not_allowed`. Muốn dùng Bridge ở localhost/LAN, quản trị viên máy chủ phải đặt `CONNECTORS_ALLOW_PRIVATE_HOSTS=true` (chỉ khi máy chủ chạy riêng cho người/nhóm tin cậy); nếu không, Bridge phải ở địa chỉ công khai (nên đặt sau HTTPS).
   - Cờ máy chủ bật + công tắc người dùng tắt + host nội bộ → `400 private_host_requires_consent`.
   - Dù bật, **luôn chặn** (chính sách chung `src/server/net/ip-policy.ts`, cũng dùng cho tải URL làm nguồn): link-local / metadata đám mây (`169.254.0.0/16`), CGNAT `100.64.0.0/10` (gồm Alibaba `100.100.100.200`), `192.0.0.0/24` (Oracle), `198.18.0.0/15`, `0.0.0.0/8`, multicast/reserved, IPv6 `fe80::/10`, `ff00::/8`, `fd00:ec2::/32` (AWS IMDS), Teredo; IPv4 nhúng trong IPv6 (`::ffff:`, NAT64, 6to4) được giải ra và kiểm theo IPv4; chỉ http/https, không `user:pass@`; **không theo redirect**; DNS được kiểm tra lúc kết nối (chống DNS rebinding).
   - Thông báo lỗi của Bridge chỉ dựa trên mã lỗi đã biết + HTTP status; **không phản chiếu nội dung thô** máy chủ ở URL đó gửi về (URL do người dùng nhập có thể là dịch vụ bất kỳ). `health.detail` được làm sạch và cắt ngắn.
   - Token đi qua HTTP thường là không an toàn: dùng HTTPS (reverse proxy) hoặc VPN khi Bridge ở máy khác.
4. **Kiểm tra kết nối** → `POST /api/connectors/bridge/test` → server gọi `GET /health?refresh=true` (+ `GET /notebooks` nếu đã đăng nhập) và hiện: phiên bản, `authenticated`, `account`, số notebook; hoặc `Bridge chưa đăng nhập Google` (bridge chạy nhưng cần `notebooklm login`), hoặc lỗi thật (sai token → `401`, không kết nối được…).

### 1.2 NotebookLM Enterprise (Preview)

- **Số dự án** (project *number*, dãy số), **location** (`global` | `us` | `eu` → host `{location}-discoveryengine.googleapis.com`).
- **Xác thực** một trong hai:
  - *Access token OAuth* dán tay (ngắn hạn ≈ 1 giờ, vd. `gcloud auth print-access-token`).
  - *Service account JSON* (mã hoá khi lưu) — server dùng `google-auth-library` mint token với scope `https://www.googleapis.com/auth/cloud-platform`.
- **Kiểm tra** → gọi `GET …/v1alpha/projects/{n}/locations/{loc}/notebooks:listRecentlyViewed` và hiện số notebook hoặc lỗi Google (401 hết hạn, 403 thiếu quyền/Discovery Engine API…).
- Giới hạn cần nhớ: API **không có chat** → kết nối Enterprise không dùng được trong khung Chat (`retrieve()` ném `501 not_supported`); không có ghi chú; không xuất nội dung nguồn. Chỉ thêm nguồn text/URL và chia sẻ (helper ở `providers/notebooklm-enterprise.ts`). Chưa kiểm thử được với dự án GCP thật (xem "Giới hạn đã biết").

### 1.3 Google Drive

- Cần máy chủ có `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Nếu thiếu, giao diện nói rõ ("Máy chủ chưa cấu hình đăng nhập Google") và **không** hiện nút kết nối.
- "Kết nối Google Drive" gọi `connectGoogleDrive()` (better-auth `linkSocial` với scope `drive.readonly`, xin **chỉ khi bấm nút**). Trạng thái "đã cấp quyền" đọc từ cột `accounts.scope`; hiệu lực thật được kiểm khi duyệt/nhập.
- OAuth redirect URI cần đăng ký trên Google Cloud Console: `{BETTER_AUTH_URL}/api/auth/callback/google`.

## 2. Kết nối notebook vào sổ tay

`notebook_connections` (+ cache `connection_sources`). API (JSON camelCase; lỗi `{ error: { code, message } }`):

| Phương thức · đường dẫn | Quyền | Ghi chú |
|---|---|---|
| `GET /api/connectors` | đăng nhập | Cài đặt che secret + trạng thái Drive + `privateHostsAllowedByServer` |
| `PUT/DELETE /api/connectors/bridge` · `…/enterprise` | đăng nhập | Lưu/xoá cài đặt (token bỏ trống = giữ token cũ) |
| `POST /api/connectors/bridge/test` · `…/enterprise/test` | đăng nhập | Gọi thật; rate-limit 30 lần/10 phút |
| `GET /api/connectors/bridge/notebooks` · `…/enterprise/notebooks` | đăng nhập | Danh sách notebook ngoài cho hộp thoại chọn |
| `GET /api/notebooks/[id]/connections` | viewer+ | Nhãn, provider, trạng thái, nguồn đã cache. **Không có credential** |
| `POST /api/notebooks/[id]/connections` | editor+ | `{provider, externalId, label?, sharedWithMembers}`: gọi thật Bridge `GET /notebooks/{externalId}` (hoặc Enterprise `GET notebooks/{id}`), chụp credential, cache nguồn. 412 nếu chưa cấu hình, 502 nếu notebook không tồn tại/bridge lỗi, 409 nếu đã kết nối |
| `PATCH …/connections/[connId]` | chủ kết nối (chia sẻ/credential), chủ hoặc admin+ (nhãn) | `{sharedWithMembers?, label?, refreshCredentials?: true}` |
| `DELETE …/connections/[connId]` | chủ kết nối hoặc admin+ | |
| `POST …/connections/[connId]/sync` | editor+ và dùng được | Làm mới cache `connection_sources` |
| `GET …/connections/[connId]/sources` | editor+ và dùng được | Nguồn **hiện tại** của notebook ngoài (không cache) |
| `POST …/connections/[connId]/notes` | editor+ và dùng được | `{title, content}` → Bridge `POST /notebooks/{id}/notes`. Enterprise: `501` |
| `POST …/connections/[connId]/sources` | editor+ và dùng được | `{sourceId}` → text/URL (Bridge + Enterprise), tệp (chỉ Bridge, multipart) |
| `POST …/connections/[connId]/import` | editor+ và dùng được | `{externalSourceIds[], visibility}` → nguồn `text` cục bộ + job `ingest_source` |
| `GET /api/notebooks/[id]/drive/files?q=&pageToken=` | editor+ | Drive `files.list` |
| `POST /api/notebooks/[id]/drive/import` | editor+ | `{fileIds[], visibility}` → `sources(kind='drive', metadata.driveFileId)` |

### Mô hình bảo mật credential

- Credential **thuộc người tạo** (`owner_user_id`). Khi tạo kết nối, credential hiện tại của họ được **chụp** (snapshot) vào `credential_enc` (AES-256-GCM). Hệ quả: nếu sau đó họ đổi/xoá cài đặt Bridge thì kết nối cũ vẫn chạy bằng token đã chụp; muốn dùng credential mới → menu thẻ kết nối → **Cập nhật thông tin xác thực** (gọi thử bằng credential mới trước khi thay). Với Enterprise dùng access token ngắn hạn, kết nối sẽ chuyển `error` khi token hết hạn → cập nhật credential (hoặc dùng service account).
- Thành viên khác chỉ dùng được khi `shared_with_members = true` (mặc định **tắt**), và chỉ qua server. Kết nối chưa chia sẻ của người khác: **hiển thị** (nhãn, provider, trạng thái) nhưng ẩn danh sách nguồn/số nguồn/chi tiết lỗi; mọi thao tác dùng (hỏi đáp, sync, ghi ngược, nhập) → **403**. Khi chia sẻ, thành viên hỏi đáp **bằng tài khoản NotebookLM của chủ kết nối** (cùng hạn mức) — câu hỏi của họ nằm trong lịch sử chat NotebookLM của chủ kết nối, nên chỉ chia sẻ khi mọi thành viên chấp nhận điều đó (L-4). Khi một thành viên bị xoá/tự rời sổ tay, mọi kết nối họ sở hữu trong sổ tay đó bị xoá (credential không ở lại).
- DTO tạo bằng ánh xạ tường minh từng trường (`toConnectionDto`) nên `credentialEnc`/`config` không thể lọt ra ngoài; có test khẳng định JSON không chứa "credential"/token.
- Trạng thái kết nối được ghi từ kết quả lời gọi thật: thành công → `ready`; lỗi phía bên ngoài → `error` + `last_error` (cắt 500 ký tự).
- Rủi ro cần biết: Bridge là credential **toàn quyền** của tài khoản Google (xem cảnh báo ở README sidecar). Không chia sẻ một Bridge cho nhiều người.

## 3. Hỏi đáp qua kết nối

- Composer → nút phạm vi → mục "Kết nối ngoài" liệt kê kết nối **dùng được** (của mình hoặc đã chia sẻ) kèm chấm trạng thái; Enterprise hiện mờ ("không có chat"). Lựa chọn lưu theo sổ tay trong `localStorage`.
- `scope.connectionIds` → `resolveChatConnections()` (404→bỏ qua, người khác chưa chia sẻ→**403**, Enterprise→bỏ qua) → `NotebookLmBridgeProvider.retrieve()` gọi `POST /notebooks/{externalId}/ask` (timeout 60 s).
- Ánh xạ bằng chứng (`bridgeResultToEvidence`): mỗi `references[]` (khử trùng lặp, tối đa 12) → `Evidence{provider:'notebooklm-bridge', kind:'chunk', sourceId: ID nguồn ngoài, sourceTitle, locator{startChar,endChar,section:'NotebookLM'}, text: cited_text, connectionId, externalUrl}`; thêm **một** bằng chứng `kind:'external_answer'` ở cuối = câu trả lời của NotebookLM (đã xoá `[n]` riêng của bridge để không lẫn số trích dẫn), nhãn "Câu trả lời của NotebookLM · {nhãn kết nối}".
- Gộp: bằng chứng cục bộ trước → kết nối → web; `buildContext` đánh số `[1..n]` liên tục; hậu kiểm `[n]` giữ nguyên. `insufficientEvidence` không áp ngưỡng cosine cho bằng chứng không có `similarity`.
- Chip `[n]` của bằng chứng ngoài mở **popover** (trích đoạn, tên nguồn ngoài, liên kết "Mở trong NotebookLM" → `https://notebooklm.google.com/notebook/{externalId}`), không có trình xem cục bộ. "Nguồn đã dùng" của nguồn ngoài là liên kết.
- Lỗi: một kết nối lỗi trong khi vẫn có bằng chứng khác → vẫn trả lời, phát `scope_adjusted{reason:'connection_error', detail}` (toast lỗi thật, trạng thái kết nối → `error`); **không có bằng chứng nào khác** → `502 connector_error` với thông báo của bridge (câu hỏi không bị lưu). `connections_unavailable` chỉ còn khi không có kết nối nào dùng được (id lạ, hoặc chỉ Enterprise).
- Web grounding (P2, `allow_web`): Cài đặt sổ tay có giải thích ("cho phép AI dùng Google Search khi người dùng bật tuỳ chọn web"); `scope_adjusted` (`web_not_allowed`, `connections_unavailable`, `connection_error`) hiện thành toast trong khung Chat.

## 4. Ghi ngược & nhập

- **Lưu vào NotebookLM**: menu ghi chú (Ghi chú → ⋯) và hành động dưới mỗi câu trả lời → ghi chú tạo trong notebook ngoài (tiêu đề = tên ghi chú / câu hỏi; câu trả lời đã bỏ `[n]` cục bộ và kèm danh sách nguồn). Chỉ bật khi có kết nối Bridge dùng được; nhiều kết nối → chọn đích.
- **Đẩy nguồn sang NotebookLM**: menu thẻ nguồn. Text → add text; URL/YouTube → add URL; tệp → upload multipart (giới hạn của bridge `BRIDGE_MAX_UPLOAD_MB`). Nguồn riêng tư của người khác → 404.
- **Nhập nguồn vào sổ tay**: menu thẻ kết nối → liệt kê nguồn thật → chọn → mỗi nguồn gọi `GET /notebooks/{id}/sources/{sid}/fulltext` của bridge → nguồn `text` cục bộ (`metadata.importedFrom`) + job `ingest_source`. **Sidecar đã được bổ sung endpoint này** (dùng `sources.get_fulltext` của `notebooklm-py`, có pytest). Bridge cũ chưa có endpoint → `501 bridge_fulltext_unsupported` ("Bridge chưa hỗ trợ xuất văn bản nguồn"), không tạo nguồn.
- **Từ Google Drive** (tab trong "Thêm nguồn"): tệp thường tải `files.get?alt=media`; Google Docs/Slides/Sheets `files.export` sang docx/pptx/xlsx; lưu vào `files` + `sources(kind='drive', metadata{driveFileId, driveMimeType, driveModifiedTime})` + `ingest_source`. Token lấy từ `accounts`; hết hạn → làm mới trực tiếp bằng refresh token tại `oauth2.googleapis.com/token` (cần `GOOGLE_CLIENT_ID/SECRET`) rồi lưu lại; bị thu hồi → 412 `drive_reauth_required` (UI mời kết nối lại). Lỗi theo từng tệp được báo, không làm hỏng cả lô.

Mã lỗi hay gặp: `connector_not_configured` (412/400), `connector_error` (502, kèm lỗi gốc), `private_host_requires_consent` / `private_host_not_allowed` / `blocked_url` (400), `not_supported` (501), `bridge_fulltext_unsupported` (501), `google_not_configured` / `drive_not_connected` / `drive_scope_missing` / `drive_reauth_required` (412), `credential_unreadable` (409).

## 5. Giới hạn đã biết

- **Bridge không chính thức**: có thể hỏng bất cứ lúc nào; chưa kiểm thử với Google thật trong môi trường này (chỉ với Bridge giả đúng hợp đồng JSON + pytest cho sidecar).
- **Enterprise**: chưa kiểm thử với dự án GCP thật; tên trường phản hồi được parse "lỏng" theo tài liệu v1alpha và có thể đổi. Không có chat/ghi chú/xuất nguồn. Không có URL notebook công khai ổn định → thẻ không có liên kết "Mở".
- **Drive**: tệp Google gốc export tối đa 10 MB (giới hạn của Drive); chỉ các định dạng pipeline ingest hỗ trợ; chưa đồng bộ lại khi tệp Drive đổi (nhập là bản chụp).
- Token OAuth trong bảng `accounts` do better-auth lưu (không mã hoá ở mức ứng dụng; có thể bật `encryptOAuthTokens` của better-auth sau).
- Chưa có job nền `sync_connection`; đồng bộ cache là thao tác thủ công.
- Mỗi lần hỏi đáp gọi Bridge là một lượt dùng hạn mức của tài khoản NotebookLM (≈ 50 câu/ngày với tài khoản miễn phí).

## 6. Kiểm thử

- Unit: `tests/unit/connectors.test.ts` (ánh xạ bằng chứng, URL Enterprise, mint token service account với thư viện giả, MIME export Drive, truy vấn Drive, chính sách URL Bridge, DTO không lộ credential).
- API: `tests/api/connectors.test.ts` với **Bridge giả** (`tests/helpers/fake-bridge.ts`, máy chủ HTTP đúng hợp đồng sidecar) + `fetch` giả cho Google: cài đặt mã hoá, kiểm tra kết nối thật (đúng/sai token/chưa đăng nhập/không có máy chủ), tạo kết nối xác thực với bridge, snapshot credential, sync, quyền (403/chia sẻ/xoá), hỏi đáp gộp bằng chứng và đánh số `[n]`, ghi ngược, nhập, Enterprise, Drive (liệt kê/tìm/refresh token/nhập/export).
- Component: `tests/components/connectors.test.tsx` (popover nguồn ngoài, thẻ kết nối).
- e2e: `tests/e2e/connectors.spec.ts` (Cài đặt → kiểm tra bridge → kết nối notebook → hỏi đáp → chip nguồn ngoài → lưu ghi chú → nhập nguồn → chia sẻ/gỡ).
- Sidecar: `cd bridge/notebooklm && pytest` (có test endpoint `fulltext`).
