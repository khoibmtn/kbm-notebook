# 12 · Nghiên cứu P7: Google Drive làm nơi lưu trữ, nguồn local/online

> Trạng thái: **bản nghiên cứu để chủ dự án quyết định** (soạn 2026-10-18). Chưa có code. Yêu cầu gốc và 7 câu hỏi mở ở `docs/04-roadmap.md` mục "Hạng mục nghiên cứu P7". Tài liệu này trả lời từng câu hỏi bằng phương án đề xuất, nêu lựa chọn thay thế và hệ quả, rồi phác thảo thiết kế và kế hoạch triển khai. Mục 0 là bảng quyết định để anh tích chọn.

## 0. Bảng quyết định (điền cột "Chọn")

| # | Câu hỏi | Đề xuất của tôi | Thay thế | Chọn |
|---|---|---|---|---|
| Q1 | "Local" là gì, triển khai theo mô hình nào? | **Một Postgres trung tâm + nhiều instance app** (laptop của anh = instance "desktop", Cloud Run = instance "cloud"). "Local" = tệp chỉ nằm trên đĩa của **instance đã tải lên**, chưa có bản trên Drive | A: một server cloud duy nhất, không có khái niệm local (đơn giản nhất, nhưng bỏ workflow local/online); C: mỗi instance một DB riêng + đồng bộ (quá nặng) | |
| Q2 | Nhận diện "thiết bị" | "Thiết bị" = **instance app** (`INSTANCE_ID` + nhãn), không phải trình duyệt/điện thoại. Điện thoại là trình duyệt mở instance cloud | Nhận diện theo trình duyệt (cookie) — vô nghĩa vì tệp không nằm ở trình duyệt | |
| Q3 | Chunk/embedding của nguồn local nằm ở đâu, thiết bị khác có hỏi đáp được không? | Chunk nằm trong Postgres trung tâm, nên **vẫn hỏi đáp được từ mọi instance**; chỉ **không xem/xuất tệp gốc**. Thẻ nguồn trên instance khác hiện huy hiệu "Local · trên <nhãn máy>" và **vẫn chọn được** vào phạm vi | B: ẩn hẳn và loại khỏi phạm vi trên instance khác (đúng nguyên văn yêu cầu, nhưng bỏ phí chunk đã có và làm kết quả chat khác nhau giữa các máy) | |
| Q4 | Thành viên khác đọc tệp trên Drive của chủ nguồn bằng cách nào? | **Server đọc bằng token của chủ nguồn** (server-side proxy), phục vụ qua `/api/files/[id]` với luật quyền hiện có. Thành viên không bao giờ nhận quyền Drive trực tiếp | Chia sẻ tệp Drive tới email thành viên (lộ cấu trúc Drive, phụ thuộc Google, khó thu hồi) | |
| Q5 | Nhiều Google Drive cho một người dùng? | Bảng `user_storage_accounts`, mỗi người **nhiều** tài khoản, **một** mặc định. Tệp ghim vào tài khoản đã lưu; "thay" Drive = đổi mặc định cho tệp mới, tệp cũ **không tự di chuyển** (có job "Di chuyển" tuỳ chọn ở đợt sau) | Một Drive duy nhất/người (đơn giản, nhưng không đáp ứng "thêm/thay") | |
| Q6 | Hạn mức, chi phí | Dùng scope `drive.file` (không nhạy cảm, không cần thẩm định bảo mật), upload resumable; 15 GB miễn phí dùng chung Gmail/Photos; giữ quota `MAX_NOTEBOOK_STORAGE_MB` của app như hiện nay | — | |
| Q7 | Sổ tay liên kết Gemini Notebook "dùng nguồn từ notebook đó" | Giữ cơ chế Bridge hiện có: hỏi đáp qua Bridge + "Nhập nguồn" tạo nguồn local như mọi nguồn khác. **Không** cố sao chép tệp gốc NotebookLM lên Drive (Bridge không lấy được tệp gốc) | Chờ API chính thức (không có mốc) | |
| Q8 (phát sinh) | Scope `drive.readonly` của tính năng "Nhập từ Drive" hiện tại | Chuyển dần sang **Google Picker + `drive.file`** để toàn bộ app chỉ dùng scope không nhạy cảm | Giữ `drive.readonly` (thuộc nhóm *restricted*: khi công khai app phải qua thẩm định bảo mật CASA) | |

Nếu anh chọn đúng các đề xuất, kế hoạch ở mục 7 là 3 đợt; đợt 1 (Drive làm kho lưu trữ + bật online trên một server) có thể bắt đầu ngay.

## 1. Mục tiêu và workflow mong muốn

Theo yêu cầu 2026-10-18:

1. Đăng nhập Google → Drive của email đó là nơi lưu trữ mặc định; Cài đặt cho thêm/thay Drive khác.
2. Sổ tay liên kết Gemini Notebook → dùng nguồn của notebook đó.
3. Thêm tài liệu vào nguồn của sổ tay → mặc định **local**; thiết bị khác không truy vấn được (ẩn hoặc ghi chú "nguồn local").
4. Bật **online** → đẩy lên Drive, mọi thiết bị dùng được.
5. Chia sẻ sổ tay → hỏi có đưa nguồn local lên online không; có → đẩy lên, thành viên khác dùng được.

Mục tiêu ngầm mà tôi suy ra và dùng làm tiêu chí thiết kế: (a) dữ liệu nằm trong Drive **của chính người dùng**, không phụ thuộc đĩa máy chủ; (b) chỉ đẩy lên cloud những gì người dùng chủ động muốn; (c) làm việc được trên laptop lẫn điện thoại.

## 2. Sự kiện nền

### 2.1 Mã nguồn hiện có

| Thành phần | Hiện trạng | Ảnh hưởng tới P7 |
|---|---|---|
| Lưu tệp | `StorageAdapter` (`put`/`getStream`/`delete`, `src/server/storage/adapter.ts`), chỉ có `LocalDiskStorage` ghi `STORAGE_DIR` của **máy chạy server**, khoá `YYYY/MM/<uuid>`, ghi `.part` rồi `rename` | Thêm adapter Drive và bộ định tuyến theo `storage_key` |
| Bảng `files` | `storage_key unique`, `owner_id`, `notebook_id`, `origin`, `sha256`, `size_bytes` | Thêm `storage_account_id`, `instance_id`, `remote_id` |
| Phục vụ tệp | Chỉ qua `/api/files/[id]` với chuỗi luật `canAccessFile` (`registerFileAccessRule`) | Giữ nguyên: Drive chỉ là backend, quyền vẫn do server quyết |
| Google OAuth | better-auth, scope `openid email profile`; Drive xin thêm `drive.readonly` khi bấm "Kết nối Google Drive" (`linkSocial`); token trong bảng `accounts`, làm mới bằng refresh token ở `src/server/connectors/drive.ts` | Cần thêm scope `drive.file`; tái dùng cơ chế refresh; token chưa mã hoá ở tầng app (docs/10 M-8) |
| Nhập từ Drive | `importDriveFiles` tải về `files` (`origin='drive'`) rồi ingest như tệp thường | Nguồn nhập từ Drive hiện cũng là bản sao local trên server |
| NotebookLM | Bridge (không chính thức): hỏi đáp, `fulltext` để nhập nguồn; **không tải được tệp gốc** | Q7 |
| Ingest | chunk + embedding vào Postgres (`source_chunks`), job worker trong tiến trình | Q3 |
| Realtime/jobs | Socket.IO + worker **trong một tiến trình**; nhiều instance thì sự kiện chỉ tới client cùng tiến trình (docs/08 §1) | Mô hình nhiều instance phải chấp nhận giới hạn này |

### 2.2 Google Drive API (kiểm tra 2026-10-18)

- **Scope:** `drive.file` (tạo và truy cập tệp do app tạo hoặc người dùng chọn qua Picker) được Google xếp **không nhạy cảm**, chỉ cần xác minh app cơ bản; `drive.readonly` và `drive` thuộc nhóm **restricted**, khi công khai app phải qua quy trình thẩm định bảo mật riêng. Google khuyến nghị dùng `drive.file`. Nguồn: [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Requesting Minimum Scopes](https://support.google.com/cloud/answer/13807380?hl=en).
- **Quota API:** 12.000 truy vấn / 60 giây cho mỗi dự án và cho mỗi người dùng; không tính phí; vượt → 403/429, cần exponential backoff. Nguồn: [Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits). Một bài bên thứ ba nói dự án tạo từ 5/2026 dùng mô hình "đơn vị quota" có trọng số — chưa kiểm chứng trên trang chính thức, cần xem lại khi tạo dự án GCP.
- **Dung lượng:** 15 GB miễn phí **dùng chung** Drive + Gmail + Photos; tệp tối đa 5 TB; upload tối đa 750 GB/ngày. Nguồn: [Google Drive (Wikipedia)](https://en.wikipedia.org/wiki/Google_Drive), [filesize.org](https://filesize.org/limits/google-drive/). Có nguồn nói tài khoản mới chỉ 5 GB nếu chưa xác minh số điện thoại — chưa kiểm chứng.
- **Upload:** `files.create` với `uploadType=resumable` cho tệp > 5 MB (theo tài liệu Drive API; cần xác nhận lại khi làm prototype).

## 3. Mô hình kiến trúc đề xuất (trả lời Q1, Q2)

```
                 ┌──────────────── Postgres trung tâm (Supabase) ────────────────┐
                 │ users, notebooks, sources, source_chunks (vector), files,       │
                 │ user_storage_accounts, app_instances, jobs, …                  │
                 └───────▲──────────────────────────────────▲─────────────────────┘
                         │                                  │
   ┌─────────────────────┴───────────┐        ┌─────────────┴───────────────────┐
   │ Instance "desktop" (laptop anh) │        │ Instance "cloud" (Cloud Run)    │
   │ STORAGE_DIR = ~/kbm/storage     │        │ STORAGE_DIR = đĩa tạm           │
   │ tệp LOCAL nằm ở đây             │        │ không giữ tệp local lâu dài     │
   └──────────────┬──────────────────┘        └──────────────┬──────────────────┘
                  │  bật online / chia sẻ: upload             │ đọc tệp online bằng token chủ nguồn
                  └──────────────────▶ Google Drive của từng người dùng ◀─────────┘
                                      (thư mục "KBM Notebook/…", scope drive.file)
```

- **Instance** = một tiến trình `server.ts` có `INSTANCE_ID` (ổn định, lưu trong `.env`) và `INSTANCE_LABEL` ("MacBook của Khôi", "Cloud"). Khi khởi động, instance ghi/cập nhật dòng `app_instances`.
- **Nguồn local** = `sources.storage='local'`, tệp gốc trong `files` có `instance_id` = instance đã tải lên. Mọi instance đều thấy **metadata và chunk** (vì DB chung); chỉ instance sở hữu mới đọc được **byte** tệp.
- **Nguồn online** = tệp đã có `remote_id` trên Drive của một `user_storage_accounts`; mọi instance đọc byte qua Drive bằng token của chủ tài khoản lưu trữ.
- Điện thoại/máy khác chỉ cần mở instance cloud. Nếu anh **không** triển khai cloud, mô hình vẫn đúng với một instance (laptop), chỉ là không có "thiết bị khác" để kiểm chứng.

**Vì sao không chọn A (một server cloud duy nhất):** đơn giản hơn hẳn, nhưng mọi nguồn mặc định đã "online" trên đĩa server, mất ý nghĩa local/online theo yêu cầu. **Vì sao không chọn C (mỗi instance một DB):** phải đồng bộ hai chiều toàn bộ schema (sổ tay, thành viên, chat, artifact) — tương đương viết lại tầng dữ liệu.

**Giới hạn phải chấp nhận:** realtime (chat nhóm, trạng thái job) chỉ tới client cùng instance; job worker của instance nào chạy job của instance đó (cần cột `jobs.instance_id` cho job đụng tệp local). Hai instance cùng DB là cấu hình chưa được kiểm thử trong dự án.

## 4. Trả lời từng câu hỏi

### Q1 · "Local" là gì

**Định nghĩa đề xuất:** nguồn local là nguồn mà tệp gốc **chỉ** nằm trên đĩa của instance đã tải lên và chưa có bản sao trên Drive. Trạng thái là thuộc tính của **nguồn** (không phải của tệp đính kèm chat hay ảnh artifact — hai loại này ở đợt 1 vẫn theo đĩa instance như hiện nay).

Hệ quả: định nghĩa này áp dụng được cho cả hai cách chạy (chỉ laptop; laptop + cloud). Khi chỉ có một instance, "bật online" vẫn có giá trị: sao lưu tệp vào Drive của người dùng và chuẩn bị cho ngày có instance thứ hai.

### Q2 · Nhận diện thiết bị

`INSTANCE_ID` (uuid, sinh một lần, lưu `.env`) + `INSTANCE_LABEL`. Bảng `app_instances(id, label, last_seen_at, storage_dir_hint)`. UI dùng nhãn để hiện "Local · trên MacBook của Khôi". Không dùng cookie/trình duyệt làm "thiết bị".

### Q3 · Chunk và hỏi đáp trên thiết bị khác

Chunk/embedding của nguồn local đã nằm trong Postgres chung ngay sau khi ingest trên instance gốc. Hai lựa chọn:

- **B1 (đề xuất):** instance khác **vẫn hỏi đáp được** trên nguồn local (chunk có sẵn, không tốn token), thẻ nguồn có huy hiệu "Local · trên <nhãn>", nút xem/xuất tệp gốc bị vô hiệu kèm gợi ý "Bật online để xem từ máy này". Trích dẫn `[n]` vẫn mở được **đoạn văn** (text chunk có trong DB), chỉ không mở được tệp gốc theo trang.
- **B2 (đúng nguyên văn yêu cầu):** instance khác ẩn hẳn nguồn local khỏi danh sách và phạm vi chat.

Tôi đề xuất B1 vì (1) không bỏ phí embedding đã trả tiền; (2) câu trả lời nhất quán giữa các máy; (3) B2 dễ gây hiểu nhầm "mất nguồn". Nếu anh chọn B2, cần thêm luật ở `listSources`/`resolveScopeSourceIds` theo `instance_id` của request.

### Q4 · Quyền trên Drive khi chia sẻ

Server đọc tệp online bằng token của **chủ tài khoản lưu trữ** (snapshot giống `notebook_connections.credential_enc` của Bridge), phục vụ cho thành viên qua `/api/files/[id]` theo luật hiện có. Không bao giờ gọi `permissions.create` của Drive cho thành viên. Khi chủ nguồn rời sổ tay hoặc gỡ Drive: tệp vẫn thuộc Drive của họ → nguồn chuyển trạng thái `online_unavailable` (chunk còn, tệp gốc mất); đợt 3 có job "sao chép sang Drive của chủ sổ tay" khi người dùng đồng ý.

### Q5 · Nhiều Drive

`user_storage_accounts(id, user_id, provider='google-drive', account_row_id → accounts.id, email, root_folder_id, is_default, status, created_at)`. Thêm Drive = `linkSocial` better-auth với tài khoản Google khác (tạo thêm dòng `accounts` cho cùng user) + xin scope `drive.file`. "Thay" = đổi `is_default`; tệp đã lưu giữ nguyên tài khoản cũ; "Di chuyển tất cả" là job tuỳ chọn ở đợt 3 (tải về rồi tải lên, cập nhật `remote_id`).

### Q6 · Hạn mức và chi phí

- Scope `drive.file`: app chỉ thấy tệp do chính nó tạo → đủ cho kho lưu trữ riêng, không cần thẩm định bảo mật.
- Quota API 12.000 truy vấn/phút là dư thừa so với quy mô cá nhân/nhóm nhỏ; vẫn phải có backoff cho 403/429.
- Dung lượng người dùng do Google quản lý; app giữ `MAX_NOTEBOOK_STORAGE_MB` để không đẩy quá nhiều lên Drive mà không biết.
- Chi phí vận hành: Drive miễn phí; chi phí thật là token Gemini khi ingest, không đổi so với hiện nay.

### Q7 · Sổ tay liên kết Gemini Notebook

Giữ nguyên P5: liên kết = `notebook_connections` (Bridge). "Dùng nguồn từ notebook đó" = chọn kết nối trong phạm vi chat (đã có) và/hoặc "Nhập nguồn" (fulltext → nguồn **local** của instance đang nhập, sau đó bật online như mọi nguồn). Không có cách hợp lệ nào kéo tệp gốc từ NotebookLM; Enterprise cũng không xuất tệp. Khi Google có API chính thức, thay lớp `KnowledgeProvider` là đủ.

### Q8 (phát sinh) · Scope của "Nhập từ Drive"

Tính năng nhập hiện xin `drive.readonly` (restricted). Để toàn app chỉ dùng scope không nhạy cảm, đợt 2 thay bằng **Google Picker API** (người dùng chọn tệp trong hộp thoại của Google) + `drive.file`: tệp được chọn tự động nằm trong phạm vi app. Việc này độc lập với P7 nhưng nên làm cùng vì chung màn hình OAuth.

## 5. Thiết kế dữ liệu và luồng

### 5.1 Schema (migration `0004_storage_accounts`)

```
app_instances(id text pk, label text, last_seen_at timestamptz)
user_storage_accounts(id uuid pk, user_id → users, provider text 'google-drive', account_row_id → accounts.id,
                      email text, root_folder_id text, is_default bool, status text 'ready'|'error', last_error text,
                      created_at)   -- unique (user_id, email)
files  + storage_account_id uuid null → user_storage_accounts
       + remote_id text null              -- Drive fileId
       + instance_id text null → app_instances   -- nơi giữ byte khi local
sources + storage text 'local'|'online' default 'local'
        + online_requested_at timestamptz null
jobs   + instance_id text null            -- job phải chạy trên instance giữ tệp
```

`storage_key` giữ unique; quy ước tiền tố: `local:<YYYY/MM/uuid>` (tương thích ngược với khoá cũ không tiền tố) và `gdrive:<storage_account_id>:<remote_id>`. Tệp **chưa** gắn `instance_id` (dữ liệu cũ) coi là thuộc instance mặc định đặt trong migration.

### 5.2 Storage

- `GoogleDriveStorage implements StorageAdapter`: `put` (resumable upload vào thư mục `KBM Notebook/<notebookId>/`, trả `remote_id`), `getStream` (`files.get?alt=media`, stream), `delete` (`files.delete`, bỏ qua 404). Lấy token qua `getDriveAccessToken`-style với tài khoản lưu trữ chỉ định; backoff 403/429.
- `StorageRouter` chọn adapter theo tiền tố `storage_key`; code gọi `getStorage()` hiện nay đổi sang `storageFor(file)`.
- Cache đọc tuỳ chọn (`STORAGE_CACHE_DIR`, LRU theo dung lượng) để xuất PDF/trích xuất lại không tải Drive nhiều lần.

### 5.3 Luồng

**Đăng nhập Google lần đầu → chọn Drive làm nơi lưu trữ**
1. Người dùng đăng nhập Google (scope cơ bản). Dashboard/Cài đặt → Lưu trữ hiện "Chưa có nơi lưu trữ online; dùng Drive của khoibm.tn@gmail.com?".
2. Bấm đồng ý → `linkSocial` xin thêm `drive.file` → callback → tạo `user_storage_accounts` (mặc định), tạo thư mục gốc "KBM Notebook" (lưu `root_folder_id`).
3. Không có Drive thì app vẫn chạy như hiện nay (mọi nguồn local).

**Thêm nguồn (mặc định local)**: không đổi so với hiện nay, chỉ ghi thêm `files.instance_id` = instance hiện tại, `sources.storage='local'`.

**Bật online một nguồn**
1. UI: công tắc trên thẻ nguồn (chỉ chủ nguồn hoặc admin+, và chỉ khi người dùng có Drive mặc định; nếu không → mời cấu hình).
2. `POST /api/notebooks/[id]/sources/[sourceId]/online` → `online_requested_at`, enqueue `sync_source_online` với `instance_id` = instance giữ tệp (job chỉ được claim bởi instance đó; nếu instance đó không chạy, UI hiện "Chờ máy <nhãn> bật").
3. Job: đọc tệp local → upload Drive → cập nhật `files.remote_id/storage_account_id/storage_key` → `sources.storage='online'` → phát `source:status`. Byte local giữ làm cache hoặc xoá theo cấu hình.

**Mở sổ tay trên instance khác**: `GET sources` trả thêm `storage`, `instanceLabel`, `fileAvailableHere` (tính từ `files.instance_id === INSTANCE_ID || remote_id != null`). UI: huy hiệu và vô hiệu nút xem/xuất khi `false` (B1) hoặc ẩn (B2).

**Chia sẻ sổ tay (mời thành viên, công khai, link)**
1. Trước khi lưu, server đếm nguồn local của người gọi trong sổ tay.
2. UI hỏi: "Sổ tay có N nguồn local chỉ có trên máy này. Đưa lên online để thành viên dùng được?" [Đưa lên online] [Giữ local] [Huỷ].
3. "Đưa lên online" → enqueue N job như luồng trên; lời mời vẫn gửi ngay; nguồn chưa xong hiện "đang đưa lên online" cho thành viên.
4. Người **không** có Drive mặc định → thông báo rõ và vẫn cho chia sẻ (nguồn local của họ không đọc được tệp gốc từ instance khác).

**Sổ tay liên kết Gemini Notebook**: không đổi (Bridge). Tuỳ chọn UI nhỏ: ở màn tạo sổ tay thêm bước "Liên kết notebook NotebookLM" mở ngay hộp Kết nối notebook.

### 5.4 Bảo mật

- Token Drive dùng lâu dài → **mã hoá** bằng `APP_ENCRYPTION_KEY` (giải quyết luôn docs/10 M-8 cho provider google, có kịch bản migrate dữ liệu `accounts` hiện có).
- Chỉ server gọi Drive; trình duyệt không bao giờ nhận token hay URL `alt=media` trực tiếp.
- Luật `canAccessFile` giữ nguyên; thêm kiểm tra `fileAvailableHere` để trả 409 `file_not_on_this_instance` thay vì 500.
- SSRF không phát sinh (host cố định `www.googleapis.com`).
- Nguồn riêng tư (`visibility='private'`) khi bật online vẫn riêng tư; chia sẻ sổ tay không bao giờ bật online nguồn riêng tư của người khác (bất biến H-5).

## 6. Kiểm thử

- Unit: `GoogleDriveStorage` với máy chủ Drive **giả** (như `tests/helpers/fake-bridge.ts`): create/get/delete, resumable theo chunk, 403/429 → backoff.
- API: luật `fileAvailableHere`; thành viên đọc tệp online của chủ nguồn qua `/api/files` (token chủ nguồn, không lộ token); job `sync_source_online` chỉ chạy trên đúng instance; chia sẻ với/không Drive.
- e2e: bật online một nguồn → huy hiệu đổi; hộp thoại chia sẻ hỏi N nguồn local.
- Thủ công với Drive thật: upload 50 MB resumable, mở từ instance thứ hai, thu hồi quyền trên Google → app báo `online_unavailable`.

## 7. Kế hoạch triển khai (ước lượng thô, một người làm)

| Đợt | Nội dung | Ước lượng | Điều kiện |
|---|---|---|---|
| **1 · Kho Drive + bật online (một instance)** | Migration 0004 (trừ phần instance), `user_storage_accounts`, OAuth `drive.file`, `GoogleDriveStorage` + router, công tắc "Bật online", Cài đặt → Lưu trữ (thêm/đặt mặc định), mã hoá token | 2–3 tuần | OAuth Client trên Google Cloud Console (anh tự tạo), tài khoản Google thử |
| **2 · Nhiều instance** | `INSTANCE_ID/LABEL`, `app_instances`, `files.instance_id`, `jobs.instance_id`, huy hiệu/ẩn theo Q3, chạy thử laptop + Cloud Run cùng Supabase; Picker + `drive.file` thay `drive.readonly` | 2 tuần | Đã deploy cloud (docs/08 §14) |
| **3 · Chia sẻ & di chuyển** | Hộp thoại chia sẻ hỏi nguồn local, trạng thái `online_unavailable`, job di chuyển giữa Drive, sao chép sang Drive chủ sổ tay khi người tạo rời | 1–2 tuần | Đợt 1–2 |

Prototype trước khi cam kết đợt 1: `GoogleDriveStorage` chạy thật (put/get/delete 1 tệp 20 MB) với scope `drive.file` — khoảng 1–2 ngày, kết quả ghi vào mục 9.

## 8. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Google đổi hạn mức/quota model (đã có tin về "quota unit" từ 5/2026) | Backoff + giới hạn song song upload; đo lại khi tạo dự án GCP |
| Người dùng xoá tệp trong Drive bằng tay | Trạng thái `online_unavailable`, chunk còn; nút "Tải lại tệp" |
| Hai instance cùng DB chưa được kiểm thử (realtime, job) | Đợt 2 có bộ test hai tiến trình; `jobs.instance_id` tránh instance cloud claim job đụng tệp laptop |
| Refresh token hết hạn/thu hồi (tài khoản Google ở chế độ *Testing* hết hạn sau 7 ngày) | Chuyển OAuth consent sang *In production*; UI "Kết nối lại" như `drive_reauth_required` hiện có |
| 15 GB dùng chung Gmail/Photos | Hiển thị dung lượng Drive còn lại (`about.get`) trong Cài đặt → Lưu trữ |

## 9. Kết quả prototype (điền sau)

| Mục | Ngày | Kết quả |
|---|---|---|
| OAuth `drive.file` + tạo thư mục gốc | | |
| Upload resumable 20 MB | | |
| Stream tải về qua `/api/files` | | |
| Xoá + 404 idempotent | | |
| Thu hồi quyền trên Google → app báo đúng | | |
