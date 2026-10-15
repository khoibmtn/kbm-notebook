# 08 · Triển khai production

> **Không có máy chủ riêng / muốn 0 đồng?** Xem [mục 14: Deploy 0 đồng — Cloud Run free tier + Supabase](#14-deploy-0-đồng-cloud-run-free-tier--supabase-github-actions).

Tài liệu này hướng dẫn đưa KBM Notebook lên máy chủ thật: PostgreSQL 16 + pgvector, ứng dụng (Docker hoặc chạy trực tiếp), reverse proxy có WebSocket, sao lưu, đăng nhập Google và khoá Gemini.

> **Giới hạn kiểm chứng.** Môi trường phát triển của dự án không có Docker daemon, nên `Dockerfile` và `docker-compose.yml` **chưa được build/chạy thử ở đó**. Hai tệp đã được rà soát cẩn thận về cú pháp và thứ tự lệnh, và mọi lệnh bên trong (`pnpm build`, `node dist/migrate.js`, `node dist/server.js`) đã chạy được ngoài Docker. Lần build đầu tiên trên máy của bạn hãy kiểm tra theo mục [Kiểm chứng sau khi triển khai](#9-kiểm-chứng-sau-khi-triển-khai).

## 1. Kiến trúc triển khai

```
Trình duyệt ──HTTPS──▶ nginx (TLS, WebSocket) ──▶ app (Node 22: Next.js + Socket.IO + job worker, cổng 3000)
                                                    ├─▶ PostgreSQL 16 + pgvector + pg_trgm
                                                    ├─▶ thư mục lưu tệp (volume /data/storage)
                                                    ├─▶ Gemini API (ra Internet)
                                                    └─▶ (tuỳ chọn) NotebookLM Bridge – sidecar riêng, xem bridge/notebooklm/README.md
```

- **Một tiến trình duy nhất** (`dist/server.js`) chạy cả web, realtime (Socket.IO tại `/socket.io`, namespace `/rt`) và hàng đợi job (ingest nguồn, sinh/xuất artifact). Chưa hỗ trợ chạy nhiều bản sao song song cho realtime (phòng Socket.IO nằm trong bộ nhớ); muốn mở rộng cần thêm adapter Redis (ngoài phạm vi hiện tại).
- Job worker lấy việc từ bảng `jobs` bằng khoá hàng nên an toàn nếu tình cờ có hai tiến trình, nhưng sự kiện realtime chỉ tới được client kết nối cùng tiến trình.

## 2. Cách nhanh nhất: Docker Compose

Yêu cầu: Docker 24+ với Compose v2.

```bash
git clone <repo> kbm-notebook && cd kbm-notebook
cp .env.example .env
# Sửa .env: tối thiểu các biến dưới đây
openssl rand -base64 32   # → BETTER_AUTH_SECRET
openssl rand -hex 32      # → APP_ENCRYPTION_KEY
#   POSTGRES_PASSWORD=<mật khẩu mạnh>
#   BETTER_AUTH_URL=https://notebook.example.com
#   NEXT_PUBLIC_APP_URL=https://notebook.example.com
#   GEMINI_API_KEY=...        (hoặc để trống và để người dùng tự nhập khoá ở Cài đặt → AI)
docker compose up -d --build
docker compose logs -f app    # thấy "KBM Notebook sẵn sàng tại ..."
```

Compose dựng hai dịch vụ:

| Dịch vụ | Image | Ghi chú |
|---|---|---|
| `db` | `pgvector/pgvector:pg16` | Volume `pgdata`; không công bố cổng ra ngoài; healthcheck `pg_isready` |
| `app` | build từ `Dockerfile` | Volume `storage` → `/data/storage`; công bố `127.0.0.1:${APP_PORT:-3000}`; `shm_size: 1gb` cho Chromium |

`Dockerfile` (đa tầng): `deps` (cài phụ thuộc) → `build` (`pnpm build` = `next build` + bundle `server.ts` → `dist/server.js` và `migrate.ts` → `dist/migrate.js`) → `prod-deps` (`pnpm install --prod`) → `runtime` (`node:22-bookworm-slim` + `chromium` + phông chữ Noto/Liberation + `tini`). Lệnh khởi động: `node dist/migrate.js && node dist/server.js` — **migration được áp dụng tự động mỗi lần container khởi động** (idempotent; tự `CREATE EXTENSION vector, pg_trgm`).

- **Chromium cho PDF**: image cài `chromium` và đặt `PW_CHROMIUM_PATH=/usr/bin/chromium`. Studio dùng nó để xuất PDF slide/infographic/tài liệu và PNG/SVG sơ đồ tư duy. Chromium chạy với `--no-sandbox` (đã cấu hình trong mã) và bị chặn mọi request mạng.
- **LibreOffice (tuỳ chọn)**: `WITH_LIBREOFFICE=true docker compose build` thêm `libreoffice-writer/impress` (~500 MB). Chỉ dùng làm đường dự phòng xuất PDF qua DOCX khi Chromium không chạy được.
- Chạy với người dùng không phải root (`node`). Volume `storage` phải ghi được bởi UID 1000 (Docker volume mới tạo thì tự đúng; bind-mount thì `chown 1000:1000`).

## 3. Chạy trực tiếp (không Docker)

```bash
# Yêu cầu: Node >= 22, pnpm >= 10, PostgreSQL 16 có pgvector >= 0.7 và pg_trgm
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env && $EDITOR .env
pnpm db:migrate        # áp dụng drizzle/*.sql (0000 … 0002)
pnpm build             # next build + dist/server.js + dist/migrate.js
pnpm start             # NODE_ENV=production node dist/server.js
```

Chạy dưới `systemd`:

```ini
[Service]
User=kbm
WorkingDirectory=/opt/kbm-notebook
EnvironmentFile=/opt/kbm-notebook/.env
ExecStart=/usr/bin/node dist/server.js
Environment=NODE_ENV=production
Restart=on-failure
```

Cài Chromium cho PDF: `apt install chromium` (đặt `PW_CHROMIUM_PATH=/usr/bin/chromium`) hoặc `npx playwright-core install chromium` (đặt `PLAYWRIGHT_BROWSERS_PATH`).

## 4. PostgreSQL 16 + pgvector

- Dùng image `pgvector/pgvector:pg16` (đã gồm contrib: `pg_trgm`). Cài tay: `apt install postgresql-16 postgresql-16-pgvector`.
- Đám mây: **Supabase** (PG 15/17, có sẵn `vector` + `pg_trgm`) và Cloud SQL PG 16 đều dùng được; `DATABASE_URL` có `sslmode=require` được hỗ trợ (bật TLS không xác minh CA). Xem mục 14.
- Tài khoản ứng dụng cần quyền `CREATE EXTENSION` lần đầu (hoặc tạo trước bằng superuser): `CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;`.
- Chiều vector cố định 768 (`gemini-embedding-001`, cắt về 768). Đổi model embedding khác chiều cần migration riêng.
- Tìm kiếm toàn cục dùng chỉ mục GIN (`tsvector` kiểu `simple`, `pg_trgm`) do migration `0002_community_search` tạo; tìm kiếm **phân biệt dấu tiếng Việt** (gõ "ty thể", không phải "ty the").
- Khuyến nghị: `shared_buffers` ≈ 25% RAM, `max_connections` ≥ `DB_POOL_MAX` + dự phòng (mặc định pool 10).

## 5. Biến môi trường

Mọi khoá có trong `.env.example`. **Bắt buộc**: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, và (khi lên production) `BETTER_AUTH_URL` + `NEXT_PUBLIC_APP_URL` là URL công khai.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | — | Chuỗi kết nối PostgreSQL |
| `DB_POOL_MAX` | `10` | Số kết nối tối đa của pool |
| `BETTER_AUTH_SECRET` | — | Bí mật ≥ 16 ký tự (khuyến nghị `openssl rand -base64 32`). Đổi giá trị = đăng xuất mọi người |
| `BETTER_AUTH_URL` | `http://localhost:3000` | URL gốc công khai (dùng cho cookie, callback OAuth) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | URL công khai hiển thị cho client (liên kết mời…) |
| `TRUSTED_ORIGINS` | — | Origin bổ sung được tin cậy (phân tách dấu phẩy), vd. khi truy cập bằng nhiều tên miền |
| `APP_ENCRYPTION_KEY` | — | 64 ký tự hex (32 byte) — khoá AES-256-GCM mã hoá API key/credential. **Mất khoá = mất các khoá Gemini/kết nối đã lưu.** Sao lưu cùng DB, tách riêng khỏi DB |
| `AI_PROVIDER` | `gemini` | `gemini` hoặc `mock` (dữ liệu giả lập — **không dùng production**) |
| `GEMINI_API_KEY` | — | Khoá Gemini dùng chung của máy chủ (tuỳ chọn; người dùng có thể nhập khoá riêng) |
| `GEMINI_CHAT_MODEL` / `GEMINI_ARTIFACT_MODEL` / `GEMINI_EMBEDDING_MODEL` / `GEMINI_IMAGE_MODEL` | `gemini-flash-latest` / `gemini-pro-latest` / `gemini-embedding-001` / `gemini-2.5-flash-image` | Ghi đè model mặc định |
| `MOCK_AI_FIXTURES_DIR` | — | Chỉ với `AI_PROVIDER=mock`: thư mục chứa `artifact_<loại>.json` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Bật đăng nhập Google và nhập nguồn từ Google Drive |
| `CONNECTORS_ALLOW_PRIVATE_HOSTS` | `false` | Mặc định chặn NotebookLM Bridge ở localhost/LAN (chống SSRF). Chỉ đặt `true` khi máy chủ chạy riêng cho người/nhóm tin cậy |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` (production) / `false` (dev, test) | Email chưa xác minh không được dùng làm danh tính (lời mời, chia sẻ theo email). Cần `SMTP_URL` để gửi email xác minh |
| `SMTP_URL` / `EMAIL_FROM` | — / `KBM Notebook <no-reply@localhost>` | Gửi email xác minh qua SMTP (`smtps://user:pass@host:465`); trống = ghi liên kết ra log máy chủ |
| `MAX_NOTEBOOK_STORAGE_MB` / `MAX_UPLOAD_REQUEST_MB` | `2048` / `512` | Quota tệp mỗi sổ tay; kích thước tối đa một request tải lên |
| `UPLOAD_MAX_FILES_PER_10MIN` / `UPLOAD_MAX_MB_PER_HOUR` | `30` / `300` | Hạn mức tải lên mỗi người dùng |
| `MAX_INGEST_TOKENS_PER_DAY` | `2000000` | Ngân sách token xử lý nguồn mỗi người dùng mỗi ngày |
| `INGEST_EXTRACT_TIMEOUT_SEC` / `INGEST_EXTRACT_MAX_MB` | `120` / `1024` | Timeout và bộ nhớ của worker trích xuất tài liệu (cần `dist/extract-worker.js`, do `pnpm build` tạo) |
| `STORAGE_DIR` | `./storage` | Thư mục lưu tệp tải lên (Docker: `/data/storage`) |
| `MAX_UPLOAD_MB` | `50` | Giới hạn tệp tải lên |
| `PORT` / `HOSTNAME_BIND` | `3000` / `0.0.0.0` | Cổng và địa chỉ lắng nghe |
| `PW_CHROMIUM_PATH` | tự dò | Đường dẫn Chromium cho xuất PDF/PNG/SVG |
| `PLAYWRIGHT_BROWSERS_PATH` | `/opt/pw-browsers` | Thư mục trình duyệt Playwright (thay thế cho `PW_CHROMIUM_PATH`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `APP_PORT` / `WITH_LIBREOFFICE` | — | Chỉ dùng bởi `docker-compose.yml` |
| `TEST_DATABASE_URL` / `E2E_PORT` | — | Chỉ cho kiểm thử, xem [09-kiem-thu.md](09-kiem-thu.md) |

## 6. Migration

- Nguồn: `src/server/db/schema.ts` → `pnpm db:generate` sinh SQL vào `drizzle/`. Hiện có: `0000_init`, `0001_connectors_enc`, `0002_community_search` (bảng `notebook_join_requests` + chỉ mục tìm kiếm GIN/trigram cho ghi chú, artifact, phiên bản artifact, nhóm).
- Áp dụng: `pnpm db:migrate` (hoặc `node dist/migrate.js` trong image). Idempotent, chạy lại an toàn. **Luôn sao lưu DB trước khi nâng cấp phiên bản.**
- Migration `0002` tạo các chỉ mục GIN trên bảng đã có dữ liệu nên có thể mất vài giây đến vài phút với dữ liệu lớn.

## 7. Reverse proxy (nginx) và WebSocket

Realtime dùng Socket.IO tại **`/socket.io/`** (namespace `/rt`), cần nâng cấp `Upgrade`. Ví dụ:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
  listen 443 ssl http2;
  server_name notebook.example.com;
  ssl_certificate     /etc/letsencrypt/live/notebook.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/notebook.example.com/privkey.pem;

  client_max_body_size 60m;          # >= MAX_UPLOAD_MB + biên độ

  location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;        # giữ kết nối WebSocket lâu
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;             # bắt buộc cho phản hồi SSE của Chat AI (streaming)
    proxy_read_timeout 300s;
  }
}
server { listen 80; server_name notebook.example.com; return 301 https://$host$request_uri; }
```

`proxy_buffering off` quan trọng: Chat AI trả lời bằng Server-Sent Events; nếu proxy đệm, người dùng sẽ không thấy chữ chạy dần. `BETTER_AUTH_URL` phải đúng URL công khai (https) để cookie `Secure` và callback OAuth hoạt động. Caddy tương đương: `reverse_proxy 127.0.0.1:3000` (tự xử lý WebSocket + HTTPS).

## 8. Sao lưu và khôi phục

Cần sao lưu **ba thứ**, cùng thời điểm càng gần càng tốt:

1. **PostgreSQL**: `docker compose exec -T db pg_dump -U kbm -Fc kbm_notebook > kbm-$(date +%F).dump`. Khôi phục: tạo DB trống rồi `pg_restore -d kbm_notebook --clean --if-exists kbm-….dump`, sau đó khởi động app (migration tự chạy).
2. **Thư mục tệp** (`STORAGE_DIR`, Docker volume `storage`): tệp tải lên, ảnh slide, tệp xuất. `docker run --rm -v kbm-notebook_storage:/d -v $PWD:/b busybox tar czf /b/storage-$(date +%F).tgz -C /d .`
3. **`APP_ENCRYPTION_KEY`** (và `BETTER_AUTH_SECRET`): lưu ở nơi an toàn, tách khỏi bản sao lưu DB. Không có khoá, các khoá Gemini/credential kết nối đã mã hoá không giải mã được (người dùng phải nhập lại).

Lịch gợi ý: dump hằng đêm + giữ 14 ngày; thử khôi phục định kỳ trên máy khác.

## 9. Kiểm chứng sau khi triển khai

1. `docker compose ps`: `db` healthy, `app` healthy (healthcheck gọi `/login`).
2. Mở URL công khai → đăng ký tài khoản → tạo sổ tay → thêm nguồn văn bản → trạng thái chuyển `ready` (job worker + embedding hoạt động).
3. Hỏi trong Chat (cần khoá Gemini) → thấy câu trả lời chạy dần và chip trích dẫn `[1]`.
4. Studio → tạo "Bài thuyết trình" → xuất **PDF** (kiểm tra Chromium) và **PPTX**.
5. Mở hai trình duyệt vào cùng sổ tay → chat nhóm tức thời (kiểm tra WebSocket qua proxy; DevTools → Network → WS `socket.io`).
6. `/dev/slides` và `/dev/infographic` phải trả **404** (trang thử nghiệm chỉ có ở dev).
7. Lỗi hay gặp: `Cấu hình môi trường không hợp lệ` (thiếu/sai biến), `extension "vector" is not available` (image Postgres không có pgvector), PDF lỗi `Không khởi chạy được Chromium` (thiếu `chromium`/thiếu `shm_size`).

## 10. Đăng nhập Google (OAuth)

1. [Google Cloud Console](https://console.cloud.google.com/) → chọn/tạo dự án → **APIs & Services → OAuth consent screen**: loại External (hoặc Internal nếu dùng Workspace), điền tên ứng dụng, email hỗ trợ, miền được uỷ quyền. Scope cơ bản: `openid`, `email`, `profile`. (Nếu dùng nhập từ Drive: thêm `https://www.googleapis.com/auth/drive.readonly` — scope nhạy cảm, cần xác minh khi công khai; người dùng chỉ cấp khi chủ động bấm "Kết nối Google Drive".)
2. **Credentials → Create credentials → OAuth client ID** → loại *Web application*.
3. **Authorized JavaScript origins**: `https://notebook.example.com`.
4. **Authorized redirect URIs**: `https://notebook.example.com/api/auth/callback/google` (đúng `<BETTER_AUTH_URL>/api/auth/callback/google`). Dev: `http://localhost:3000/api/auth/callback/google`.
5. Đặt `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` trong `.env`, khởi động lại. Nút "Đăng nhập bằng Google" tự xuất hiện khi cả hai biến có giá trị.
6. Dự án ở chế độ *Testing* chỉ cho các tài khoản trong danh sách *Test users*; chuyển sang *In production* để mở cho mọi người.

## 11. Khoá Gemini

- Lấy khoá tại [Google AI Studio](https://aistudio.google.com/apikey). Hai cách cấp:
  - **Dùng chung**: `GEMINI_API_KEY` trong `.env` — mọi người dùng chưa có khoá riêng sẽ dùng khoá này (chi phí về chủ máy chủ).
  - **Riêng từng người**: người dùng nhập ở **Cài đặt → AI** (mã hoá AES-256-GCM bằng `APP_ENCRYPTION_KEY`, bấm "Kiểm tra key" để xác thực thật). Khoá riêng được ưu tiên hơn khoá dùng chung.
- Chưa có khoá nào: tính năng AI trả HTTP 412 `ai_not_configured` và giao diện hiển thị rõ cách cấu hình (không có dữ liệu giả).
- Giới hạn tần suất (theo người dùng, lưu ở bảng `rate_limits`): Chat AI 60 câu / 10 phút; sinh artifact 20 / 10 phút; tin nhắn nhóm 120 / phút; bình luận 20 / phút; yêu cầu tham gia sổ tay 10 / giờ. Vượt ngưỡng → HTTP 429 `rate_limited` và giao diện hiện toast.

## 12. NotebookLM Bridge (tuỳ chọn, không chính thức)

Sidecar Python/FastAPI chạy **trên máy của người dùng** (nơi đã đăng nhập Google), không đóng gói trong image này. Cài đặt, đăng nhập, Docker riêng và cảnh báo rủi ro: [bridge/notebooklm/README.md](../bridge/notebooklm/README.md); mô hình kết nối: [07-ket-noi.md](07-ket-noi.md). Trên máy chủ dùng chung hãy đặt `CONNECTORS_ALLOW_PRIVATE_HOSTS=false` (compose đã mặc định như vậy) để người dùng không trỏ Bridge vào mạng nội bộ của máy chủ.

## 13. Bảo mật — danh mục kiểm tra

- HTTPS bắt buộc; `BETTER_AUTH_URL` là `https://`.
- `.env` quyền `600`, không commit; `APP_ENCRYPTION_KEY`/`BETTER_AUTH_SECRET` là giá trị ngẫu nhiên riêng, không dùng giá trị mẫu.
- Cổng 5432 của Postgres không mở ra Internet; app chỉ công bố trên loopback phía sau proxy.
- `AI_PROVIDER=gemini` (không `mock`). `CONNECTORS_ALLOW_PRIVATE_HOSTS=false` (mặc định). Cấu hình SMTP (`SMTP_URL`) để email xác minh gửi được; chi tiết rà soát bảo mật: [docs/10-ra-soat-bao-mat.md](10-ra-soat-bao-mat.md). Reverse proxy phải ghi đè `X-Forwarded-For`/`X-Real-IP`/`X-Forwarded-Host`.
- Trang công khai (`/a/…`, `/p/…`, `/s/…`) có `noindex`; sổ tay công khai chỉ lộ tiêu đề, mô tả, emoji và artifact công khai — không bao giờ lộ nguồn, ghi chú hay chat (có test).

## 14. Deploy 0 đồng: Cloud Run free tier + Supabase (GitHub Actions)

Mục này đưa KBM Notebook lên **Google Cloud Run** bằng GitHub Actions với cấu hình mặc định nhắm tới chi phí **0 đồng** (trong hạn mức miễn phí): Cloud Run scale-to-zero + Supabase free (Postgres + pgvector) + bucket GCS + Artifact Registry.

> **Chưa chạy thử.** Pipeline (`.github/workflows/deploy-cloud-run.yml`), script `scripts/gcp-bootstrap.sh` và `render.yaml` được **soạn nhưng chưa từng được thực thi** trong môi trường phát triển (không có Docker daemon, không có thông tin đăng nhập GCP/Supabase/Render). Đã kiểm tra: cú pháp YAML, `bash -n`, `shellcheck`, từng cờ `gcloud` được phân tích bởi gcloud thật (ở chế độ không đăng nhập), và chạy thử logic các bước bash với `gcloud` giả. Những điểm còn **cần xác nhận** khi chạy thật được gom ở [14.9](#149-điểm-cần-xác-nhận-khi-chạy-thật).

### 14.1 Kiến trúc

```
GitHub Actions ──docker build/push──▶ Artifact Registry (kbm, giữ 2 image mới nhất)
      │
      ├─ Cloud Run job  kbm-notebook-migrate  (node dist/migrate.js)  ─┐ chạy xong, thành công mới deploy tiếp
      └─ Cloud Run service kbm-notebook (min 0 / max 1 instance, 1 vCPU, 1 GiB, gen2, session affinity)
              ├─▶ Supabase Postgres (Session pooler :5432, TLS) — vector + pg_trgm
              ├─▶ GCS bucket (gcsfuse) gắn tại /data/storage — tệp tải lên
              └─▶ Gemini API (khoá miễn phí từ AI Studio)
```

- Dịch vụ chạy với `SKIP_MIGRATE=true`: migration đã chạy ở job riêng nên instance khởi động nhanh hơn và không có hai instance cùng migrate. (Chạy bằng Docker Compose thì `CMD` mặc định vẫn tự migrate.)
- `--max-instances 1` còn có lợi: Socket.IO giữ phòng realtime trong bộ nhớ nên **một** instance là cấu hình đúng (xem mục 1).
- Cổng: workflow deploy với `--port 3000`, Cloud Run đặt `PORT=3000` và `server.ts` đọc `PORT`; ứng dụng chạy bằng user `node` (không root).

### 14.2 Bảng chi phí và giới hạn (ước tính tại thời điểm soạn — kiểm tra lại trang giá chính thức)

| Thành phần | Chi phí kỳ vọng | Hạn mức miễn phí / giới hạn cần biết |
|---|---|---|
| Cloud Run | $0 nếu trong free tier | Mỗi tháng: 2 triệu request, 360.000 GiB-giây RAM, 180.000 vCPU-giây (tính phí theo request, vùng Tier 1). Với 1 vCPU/1 GiB ≈ **50 giờ instance bận/tháng**. **Mỗi kết nối WebSocket/SSE đang mở cũng tính là instance đang bận** → để tab mở cả ngày có thể ăn hết hạn mức. Có cold start (14.4). |
| Supabase (free) | $0 | ~500 MB CSDL (mỗi đoạn văn bản có vector 768 chiều ≈ vài KB kể cả chỉ mục → cỡ hàng chục nghìn đoạn); **tạm dừng (pause) project sau ~7 ngày không hoạt động**; tối đa 2 project free mỗi tổ chức. |
| Cloud Storage | $0 dưới 5 GB | 5 GB-tháng miễn phí **chỉ ở us-central1 / us-east1 / us-west1**; số thao tác Class A/B cũng có hạn mức miễn phí. Bucket mặc định đặt ở `us-central1`. |
| Artifact Registry | ≈ $0 | 0,5 GB miễn phí. **Image ước tính ~0,6–0,9 GB nén** (xem 14.5) nên có thể vượt vài trăm MB → tối đa vài cent/tháng (~$0,10/GB-tháng). Cleanup policy giữ 2 image mới nhất. |
| GitHub Actions | $0 | Repo private: 2.000 phút/tháng (Free); repo public: không giới hạn. Mỗi lần deploy ≈ 8–12 phút lần đầu, ngắn hơn khi cache lớp Docker (type=gha) còn. |
| Gemini API (free) | $0 | Giới hạn RPM/RPD/token theo từng model, **thấp hơn** hạn mức của app (Chat 60 câu/10 phút) → có thể gặp HTTP 429 từ Gemini; dữ liệu gửi ở gói miễn phí có thể được Google dùng cải thiện sản phẩm — đừng nạp tài liệu nhạy cảm. Xem https://ai.google.dev/gemini-api/docs/rate-limits |

**Lưu ý billing:** Cloud Run, Artifact Registry và Cloud Build **bắt buộc dự án GCP được gắn tài khoản thanh toán (thẻ)** dù mức dùng là $0. Hãy đặt **Budget alert** (Billing → Budgets & alerts, ví dụ $1) để được báo sớm; budget chỉ *cảnh báo*, không tự chặn chi phí. Nếu chủ dự án không muốn gắn thẻ, xem [14.7](#147-nếu-không-muốn-gắn-thẻ).

**Nâng cấp có phí (không bật mặc định):** `MIN_INSTANCES=1` (giữ instance nóng, hết cold start; ước tính ~$13–55/tháng tuỳ chế độ tính phí), `CPU_ALWAYS_ON=true`, `MAX_INSTANCES`>1 (không khuyến nghị: realtime nằm trong bộ nhớ), Cloud SQL (`--with-cloudsql`, khoảng $25–60/tháng với `db-g1-small`/`db-custom-1-3840` + lưu trữ) — tất cả là **ước tính**.

### 14.3 Các bước (theo đúng thứ tự)

**(a) Chuẩn bị tài khoản**
1. Tạo **dự án GCP** và **gắn billing** (console.cloud.google.com → Billing). Ghi lại `PROJECT_ID`.
2. Tạo **project Supabase free** (supabase.com → New project; chọn vùng gần Cloud Run, ví dụ US East; đặt Database Password — nên dùng chữ+số để khỏi phải mã hoá URL).
3. Tạo **khoá Gemini miễn phí** tại https://aistudio.google.com/apikey (không cần thẻ) → sẽ là secret `GEMINI_API_KEY`.
4. Đẩy mã lên một repo GitHub của bạn (nhánh `main`).

**(b) Chạy script bootstrap** (máy có `gcloud` + `openssl`, hoặc Cloud Shell)
```bash
gcloud auth login
PROJECT_ID=<id-dự-án> ./scripts/gcp-bootstrap.sh          # mặc định REGION=us-central1, KHÔNG tạo Cloud SQL
```
Script bật API (run, artifactregistry, storage, iam, cloudresourcemanager), tạo repo Artifact Registry `kbm` + cleanup policy, bucket `<PROJECT_ID>-kbm-storage` (lifecycle dọn rác, chặn truy cập công khai), service account `kbm-deployer` (cho GitHub) và `kbm-runtime` (cho Cloud Run), khoá JSON ở `./.gcp/deployer-key.json`, sinh `BETTER_AUTH_SECRET`/`APP_ENCRYPTION_KEY`, rồi **in ra đúng danh sách secrets/variables** (cũng lưu ở `./.gcp/github-settings.txt`). Chạy lại nhiều lần an toàn. Thư mục `.gcp/` đã nằm trong `.gitignore` — **đừng commit**, và sao lưu `APP_ENCRYPTION_KEY` (mất khoá = mất các khoá API đã mã hoá).

**(c) Lấy `DATABASE_URL` từ Supabase** — Dashboard → nút **Connect** → tab *Session pooler* (cổng **5432**), dạng:
```
postgresql://postgres.<PROJECT_REF>:<MẬT_KHẨU>@aws-0-<vùng>.pooler.supabase.com:5432/postgres?sslmode=require
```
- Dùng **Session pooler (5432)**, không dùng *Transaction pooler (6543)*: ứng dụng dùng `FOR UPDATE SKIP LOCKED`, khoá advisory và transaction nhiều câu lệnh. *Direct connection* (`db.<ref>.supabase.co`) ở gói free chỉ có IPv6 mà Cloud Run ra Internet bằng IPv4 → thường không kết nối được.
- Ứng dụng hiểu `sslmode=require` (bật TLS nhưng **không** xác minh chuỗi chứng chỉ, vì Supabase dùng CA riêng) — xem `src/server/db/connection.ts`. Mật khẩu chứa ký tự đặc biệt phải mã hoá %-encode (`@` → `%40`).
- **Không cần bật extension thủ công**: migration chạy `CREATE EXTENSION IF NOT EXISTS vector` và `pg_trgm`. Nếu bị từ chối quyền, bật trong Dashboard → Database → Extensions (mục 14.8). Schema không dùng tính năng riêng của PostgreSQL 16 (chỉ `gen_random_uuid()`, GIN, HNSW) nên chạy được trên PG 15/17 của Supabase.

**(d) Đặt GitHub secrets/variables** (Repo → Settings → Secrets and variables → Actions)

| Loại | Tên | Giá trị |
|---|---|---|
| Secret | `GCP_SA_KEY` | Toàn bộ nội dung `./.gcp/deployer-key.json` |
| Secret | `DATABASE_URL` | Chuỗi Supabase ở bước (c) |
| Secret | `BETTER_AUTH_SECRET` | Do script sinh |
| Secret | `APP_ENCRYPTION_KEY` | Do script sinh (64 ký tự hex) |
| Secret | `GEMINI_API_KEY` | Khoá AI Studio (tuỳ chọn nhưng nên có; không có thì mỗi người dùng tự nhập khoá ở Cài đặt → AI) |
| Secret (tuỳ chọn) | `SMTP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Như mục 5 và 10 |
| Secret (chỉ khi dùng Cloud SQL) | `CLOUDSQL_INSTANCE` | `PROJECT:REGION:kbm-pg` |
| Secret (tuỳ chọn, thay cho `GCP_SA_KEY`) | `GCP_WIF_PROVIDER`, `GCP_SA_EMAIL` | Workload Identity, xem 14.6 |
| Variable | `GCP_PROJECT_ID` | ID dự án |
| Variable | `GCP_REGION` | `us-central1` (mặc định nếu bỏ trống) |
| Variable | `GCS_BUCKET` | Tên bucket do script in ra |
| Variable | `AUTH_REQUIRE_EMAIL_VERIFICATION` | `false` cho bản demo (mặc định của workflow) |
| Variable (tuỳ chọn) | `APP_URL`, `MIN_INSTANCES`, `MAX_INSTANCES`, `CPU_ALWAYS_ON`, `GCS_MOUNT_OPTIONS`, `TRUSTED_ORIGINS`, `EMAIL_FROM`, `MAX_UPLOAD_MB`, `MAX_NOTEBOOK_STORAGE_MB`, `MAX_UPLOAD_REQUEST_MB`, `DB_POOL_MAX`, `RUNTIME_SA`, `AR_REPO`, `AUTO_DEPLOY` | Mặc định: min 0, max 1, `CPU_ALWAYS_ON=false`, `DB_POOL_MAX=5`. `AUTO_DEPLOY=false` tắt tự deploy khi push. |

`GCP_PROJECT_ID`/`GCP_REGION` chấp nhận cả variable lẫn secret. Có thể đặt trong *Environment* `production` thay vì cấp repo.

**(e) Chạy workflow** — Actions → **Deploy Cloud Run** → *Run workflow* (ô `environment` để `production`). Workflow tự chạy khi push lên `main` (trừ thay đổi chỉ ở `docs/**`, `*.md`, `bridge/**`); khi chưa đặt đủ secrets nó dừng với thông báo rõ tên mục còn thiếu. Thứ tự: kiểm tra cấu hình → đăng nhập GCP → build/push image → **job migrate** (phải thành công) → deploy dịch vụ → (lần đầu) cập nhật `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` bằng URL dịch vụ → smoke test (`/login` = 200, `/api/notebooks` = 401). URL in ở *job summary*.
- Dùng tên miền riêng? Đặt variable `APP_URL=https://tên-miền` để URL đúng ngay từ lần deploy đầu (Google OAuth redirect cũng dùng URL này).
- Cloud Run có thể có hai URL cho cùng dịch vụ; chỉ URL được cấu hình (`BETTER_AUTH_URL`) chắc chắn qua được kiểm tra Origin của đăng nhập. Dùng URL trong summary, hoặc thêm URL kia vào variable `TRUSTED_ORIGINS`.

**(f) Lần đăng nhập đầu**
- Mở URL → *Đăng ký* tài khoản. Bản demo đặt `AUTH_REQUIRE_EMAIL_VERIFICATION=false` nên dùng được ngay không cần email; hệ quả: email chưa xác minh vẫn dùng làm danh tính cho lời mời/chia sẻ theo email — chỉ nên cho người tin cậy dùng.
- Muốn bật xác minh email: thêm secret `SMTP_URL` (Gmail app password, Brevo, Resend… đều có gói miễn phí), đặt variable `AUTH_REQUIRE_EMAIL_VERIFICATION=true`, chạy lại workflow.
- Không có `GEMINI_API_KEY`: vào Cài đặt → AI để nhập khoá riêng.

### 14.4 Hành vi của free tier — cần biết trước

- **Cold start:** khi không có ai dùng ~15 phút instance bị tắt; request đầu tiên sau đó mất cỡ **10–20 giây** (ước tính; Node + Next + kết nối CSDL). `--cpu-boost` giúp rút ngắn. `MIN_INSTANCES=1` là nâng cấp có phí.
- **Job worker và Socket.IO chỉ chạy khi instance còn sống.** Với tính phí theo request, CPU bị hạn chế ngoài lúc xử lý request: nguồn mới tải lên (ingest) và xuất file tiến triển chủ yếu khi trang đang mở (trình duyệt liên tục gọi API/WebSocket). Đóng tab ngay sau khi tải lên có thể làm việc xử lý dừng/chậm cho tới lần mở sau. Đặt `CPU_ALWAYS_ON=true` (có thể mất phí) nếu cần xử lý nền đáng tin cậy.
- WebSocket (`/socket.io`) chạy trực tiếp trên Cloud Run (không cần cấu hình proxy). Request tối đa 3600 giây (`--timeout 3600`) — hết hạn thì client tự kết nối lại. `--session-affinity` giữ người dùng trên cùng instance (với max 1 instance thì không ảnh hưởng).
- **PDF:** xuất bằng Chromium trong image. **Đường dự phòng LibreOffice (DOCX→PDF) không có** trên Cloud Run vì image không cài LibreOffice (giảm dung lượng). Chromium trong 1 GiB RAM đủ cho tài liệu thường; tài liệu rất lớn có thể hết bộ nhớ → tăng bộ nhớ (có phí) hoặc xuất PPTX/DOCX.
- Tệp tải lên nằm ở bucket GCS gắn bằng gcsfuse: chậm hơn đĩa cục bộ, không có khoá/ghi nối tiếp như đĩa thật. Chưa đặt `GCS_BUCKET` thì tệp ở đĩa tạm của instance và **mất khi instance bị tắt** (workflow cảnh báo).
- **Supabase tạm dừng sau ~7 ngày không hoạt động.** Khi đó ứng dụng báo lỗi kết nối CSDL. Khôi phục: Supabase Dashboard → chọn project → **Restore project** (dữ liệu được giữ cho phép khôi phục trong một khoảng thời gian — theo tài liệu Supabase lúc soạn là 90 ngày, cần kiểm tra lại); đợi vài phút rồi mở lại ứng dụng. Mỗi lần có người đăng nhập/dùng ứng dụng sẽ tính là hoạt động; nếu muốn chắc chắn, vào ứng dụng ít nhất mỗi tuần.

### 14.5 Image và Artifact Registry

- Dockerfile đa tầng; bản dành cho Cloud Run **không có LibreOffice** (`WITH_LIBREOFFICE` mặc định `false`, workflow không truyền), đã bỏ `.next/cache` (~240 MB trong bản build thử).
- **Ước tính kích thước (không build được ở đây):** node:22-bookworm-slim ≈ 230 MB + Chromium và thư viện ≈ 400–500 MB + phông Noto/Liberation/emoji ≈ 150 MB + `node_modules` production ≈ 880 MB (đo bằng `pnpm install --prod`) + `.next`/`dist` ≈ 90 MB → **~1,8–2,0 GB chưa nén, khoảng 0,6–0,9 GB trong Artifact Registry** (nén gzip). Có thể vượt 0,5 GB miễn phí một chút; các lớp dùng chung giữa các phiên bản chỉ tính một lần.
- Muốn nhỏ hơn: thay `chromium` bằng headless shell của Playwright, bỏ các gói nhị phân musl trong `node_modules/.pnpm` (không dùng trên Debian) — chưa làm vì không kiểm chứng được ở đây.
- Cleanup policy (script đặt): giữ 2 phiên bản mới nhất, xoá phần còn lại. Cloud Run giữ bản sao image của revision đang chạy.

### 14.6 Workload Identity Federation (tuỳ chọn, thay cho khoá JSON)

Nhiều tổ chức GCP mới bật policy `iam.disableServiceAccountKeyCreation` (không tạo được khoá JSON). Khi đó:
```bash
P=<project-id>; NUM=$(gcloud projects describe $P --format='value(projectNumber)'); REPO=<owner>/<repo>
gcloud iam workload-identity-pools create github --location=global --project=$P
gcloud iam workload-identity-pools providers create-oidc github-provider --location=global --project=$P \
  --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition="assertion.repository=='$REPO'"
gcloud iam service-accounts add-iam-policy-binding kbm-deployer@$P.iam.gserviceaccount.com --project=$P \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```
Đặt secret `GCP_WIF_PROVIDER=projects/<NUM>/locations/global/workloadIdentityPools/github/providers/github-provider` và `GCP_SA_EMAIL=kbm-deployer@<P>.iam.gserviceaccount.com`, bỏ secret `GCP_SA_KEY`. (Các lệnh trên đã được gcloud phân tích cú pháp nhưng chưa chạy thật.)

### 14.7 Nếu không muốn gắn thẻ

Cloud Run luôn cần billing. Các lựa chọn khác:
1. **Chạy trên máy của bạn** bằng Docker Compose (mục 2): $0 thật sự, không cần cloud; dùng `ngrok`/Cloudflare Tunnel nếu cần chia sẻ tạm.
2. **Render (gói free)** — tệp `render.yaml` ở gốc repo (Blueprint, DB vẫn là Supabase). **Chưa thử** từ môi trường phát triển. Gói free chỉ **512 MB RAM** (Next.js + Chromium dễ thiếu, xuất PDF có thể bị OOM), tự ngủ sau ~15 phút, **không có đĩa bền** (tệp tải lên mất khi khởi động lại), không có pre-deploy command nên migration chạy lúc khởi động (CMD mặc định của Dockerfile). Dùng cho demo rất nhẹ.

### 14.8 Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Job migrate lỗi `extension "vector" is not available` hoặc `permission denied to create extension` | Supabase: Dashboard → Database → Extensions → bật `vector` (và `pg_trgm`), chạy lại workflow. Cloud SQL: user tạo bằng gcloud đã thuộc `cloudsqlsuperuser`; nếu vẫn lỗi chạy `CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;` bằng user `postgres`. Migration `0000_init.sql` và `migrate.ts` đều có `CREATE EXTENSION IF NOT EXISTS`, nên thường **không phải chạy tay**. |
| `ENETUNREACH` / timeout khi kết nối Supabase | Đang dùng *Direct connection* (IPv6). Chuyển sang Session pooler `…pooler.supabase.com:5432`. |
| `Tenant or user not found` | Với pooler, user phải là `postgres.<PROJECT_REF>` (không phải `postgres`); kiểm tra mật khẩu/%-encode. |
| `SELF_SIGNED_CERT_IN_CHAIN` | URL thiếu `sslmode=require` (hoặc dùng `verify-full` mà không có CA). Thêm `?sslmode=require`. |
| Ứng dụng báo lỗi CSDL sau một thời gian không dùng | Project Supabase bị pause — khôi phục theo 14.4. |
| Cloud SQL: `connect ENOENT /cloudsql/...` | Thiếu `--add-cloudsql-instances` (secret `CLOUDSQL_INSTANCE` không đặt và không suy ra được từ URL) hoặc `kbm-runtime` thiếu `roles/cloudsql.client`; URL phải có dạng `postgres://kbm:PASS@/kbm_notebook?host=/cloudsql/PROJECT:REGION:kbm-pg`. |
| `EACCES`/`permission denied` khi tải tệp lên | Quyền ghi của volume gcsfuse: `kbm-runtime` cần `roles/storage.objectAdmin` trên bucket; user `node` có UID/GID 1000 nên mount-options mặc định là `uid=1000;gid=1000;file-mode=664;dir-mode=775;implicit-dirs` — chỉnh bằng variable `GCS_MOUNT_OPTIONS`. |
| `--allow-unauthenticated` bị từ chối | Tổ chức bật policy chặn `allUsers` (Domain Restricted Sharing). Nhờ quản trị viên nới policy cho dự án. |
| Smoke test `/api/notebooks` không trả 401 | Kiểm tra log: `gcloud run services logs read kbm-notebook --region us-central1`. Nếu `/login` 5xx, thường do thiếu/sai biến môi trường (xem log "Cấu hình môi trường không hợp lệ"). |
| Realtime/chat nhóm không cập nhật | Chỉ đúng khi 1 instance (`MAX_INSTANCES=1`). WebSocket chạy trực tiếp trên Cloud Run; session affinity chỉ là "cố gắng", không thay cho adapter Redis. |
| Khoá JSON không tạo được | Dùng Workload Identity (14.6). |
| Không thấy job migrate chạy | `gcloud run jobs executions list --job kbm-notebook-migrate --region us-central1`, log ở Cloud Logging. |

### 14.9 Điểm cần xác nhận khi chạy thật

1. Tính năng gắn bucket GCS (`--add-volume type=cloud-storage`, `mount-options` dạng `uid=1000;gid=1000;…`) — cú pháp cờ đã được gcloud chấp nhận, nhưng **quyền sở hữu tệp, tương thích gcsfuse với `rename`/`.part` của `LocalDiskStorage`, và việc Cloud Run có chấp nhận các tuỳ chọn uid/gid/mode hay không** chưa được thử. Nếu ghi tệp lỗi: bỏ variable `GCS_BUCKET` (tệp tạm thời) hoặc chỉnh `GCS_MOUNT_OPTIONS`.
2. `docker/build-push-action` + `gcloud auth configure-docker` (credential helper) cho Artifact Registry; cache `type=gha`.
3. `gcloud artifacts repositories set-cleanup-policies … --no-dry-run` (cờ đã được chấp nhận; hành vi xoá thật chưa thử) và lifecycle bucket.
4. Hạn mức miễn phí và giá (Cloud Run, Supabase, Gemini, Artifact Registry) thay đổi theo thời gian; con số ở đây là ước tính khi soạn tài liệu.
5. Supabase: `CREATE EXTENSION vector` có thể đặt extension ở schema `public` hay `extensions` — migration chỉ gọi `IF NOT EXISTS`; nếu truy vấn báo không thấy kiểu `vector`, kiểm tra `search_path`.
6. Thời gian cold start, mức RAM thực tế của Chromium trong 1 GiB, và kích thước image thực — cần đo.
7. Cờ `--cpu-throttling` mặc định (xử lý nền chỉ khi có request) có thể làm ingest chậm; xem 14.4.
