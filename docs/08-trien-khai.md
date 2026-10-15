# 08 · Triển khai production

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
| `CONNECTORS_ALLOW_PRIVATE_HOSTS` | `true` | `false` trên máy chủ dùng chung để chặn SSRF của NotebookLM Bridge vào localhost/LAN |
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
- `AI_PROVIDER=gemini` (không `mock`). `CONNECTORS_ALLOW_PRIVATE_HOSTS=false` nếu nhiều người dùng chung máy chủ.
- Trang công khai (`/a/…`, `/p/…`, `/s/…`) có `noindex`; sổ tay công khai chỉ lộ tiêu đề, mô tả, emoji và artifact công khai — không bao giờ lộ nguồn, ghi chú hay chat (có test).
