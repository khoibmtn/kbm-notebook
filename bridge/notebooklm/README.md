# NotebookLM Bridge (KHÔNG CHÍNH THỨC)

Sidecar HTTP nhỏ (FastAPI) để **KBM Notebook** kết nối với sổ tay Google NotebookLM / Gemini Notebook **cá nhân** của người dùng.

> ## ⚠️ Cảnh báo: đây là tích hợp KHÔNG CHÍNH THỨC
>
> - Google **không có API chính thức** cho NotebookLM cá nhân. Bridge này bọc thư viện cộng đồng
>   [`notebooklm-py`](https://github.com/teng-lin/notebooklm-py) (MIT, bản **0.8.5** được ghim cứng), thư viện này gọi các
>   **endpoint nội bộ không có tài liệu** của Google.
> - Google có thể đổi giao thức **bất cứ lúc nào** → bridge có thể hỏng đột ngột (khi đó API trả `502 upstream_changed`;
>   cách xử lý: nâng cấp `notebooklm-py`, đọc lại phần "Giới hạn" bên dưới).
> - Có thể **vi phạm điều khoản dịch vụ** của Google. Tự chịu rủi ro; **nên dùng một tài khoản Google riêng (dedicated)**,
>   không dùng tài khoản công việc/chính chứa dữ liệu quan trọng.
> - **Thận trọng với master token** (`notebooklm login --master-token`): đó là credential **toàn quyền** của tài khoản
>   Google. Ai có file `master_token.json` là có thể mạo danh tài khoản đó. Chỉ dùng với tài khoản riêng, bảo vệ thư mục
>   `~/.notebooklm` (quyền `700`), không commit, không đưa vào image Docker, không gửi qua chat.
> - Bridge phải chạy **trên máy/máy chủ của chính người dùng** (nơi đã đăng nhập). Không chia sẻ một bridge cho nhiều
>   người: mọi người gọi bridge sẽ dùng chung **một** tài khoản Google.
>
> Trong KBM Notebook, connector này được đánh dấu **Experimental / unofficial** và có thể tắt bất cứ lúc nào.

## Kiến trúc

```
KBM Notebook (Next.js, server) ──HTTP + Bearer token──▶ NotebookLM Bridge (FastAPI, máy của bạn)
                                                          └─ notebooklm-py ──▶ Google NotebookLM (endpoint nội bộ)
```

- App chỉ nói chuyện với API JSON **ổn định** của bridge (xem [Tham chiếu API](#tham-chiếu-api)); các thay đổi của thư viện
  không chính thức được hấp thụ ở lớp `app/client.py`.
- Mọi lỗi có dạng `{"error": {"code": "...", "message": "..."}}`.
- Bridge giữ **một** phiên `NotebookLMClient` dùng chung, tự mở lại sau khi bạn chạy `notebooklm login` (không cần khởi động lại).

## Yêu cầu

- Python **3.11+** (đã kiểm thử với 3.13), máy có thể mở trình duyệt để đăng nhập Google một lần (hoặc dùng cookie/master token).
- Tài khoản Google đã bật NotebookLM / Gemini Notebook.

## Cài đặt

### Cách 1: virtualenv (khuyến nghị cho server)

```bash
cd bridge/notebooklm
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"                       # bridge + notebooklm-py==0.8.5 + công cụ test
pip install "notebooklm-py[browser]==0.8.5"   # chỉ cần nếu bạn đăng nhập bằng trình duyệt (Playwright) ngay trên máy này
```

### Cách 2: `uv tool` / `pipx` cho công cụ đăng nhập `notebooklm`

Đăng nhập chỉ cần làm một lần và lưu vào `~/.notebooklm` (hoặc `$NOTEBOOKLM_HOME`); bridge đọc cùng thư mục đó. Bạn có thể cài CLI riêng:

```bash
uv tool install "notebooklm-py[browser]==0.8.5"      # hoặc: pipx install "notebooklm-py[browser]==0.8.5"
```

Rồi cài bridge bằng Cách 1 (không cần extra `[browser]` trong venv của bridge). Lưu ý: CLI và bridge phải **cùng user** và cùng
`NOTEBOOKLM_HOME` thì mới thấy cùng phiên đăng nhập.

## Đăng nhập Google

```bash
notebooklm login                        # mở trình duyệt (lần đầu tự tải Chromium ~170 MB), đăng nhập Google
notebooklm auth check --test --json     # kiểm tra: mong đợi "status": "ok"
```

Nhiều tài khoản: `notebooklm --profile work login`, rồi chạy bridge với `NOTEBOOKLM_PROFILE=work`.

**Máy chủ không có trình duyệt (headless):**

```bash
notebooklm login --browser-cookies chrome                     # nhập cookie từ trình duyệt đã đăng nhập (không cần Playwright)
notebooklm login --master-token --account you@gmail.com      # master token: tự cấp lại cookie khi hết hạn, KHÔNG cần trình duyệt
```

`--master-token` tiện cho server vì tự gia hạn phiên, nhưng đây là credential **toàn quyền** (xem cảnh báo ở đầu trang): chỉ dùng
với tài khoản Google riêng. Chi tiết các cách đăng nhập: tài liệu của `notebooklm-py`.

Khi phiên hết hạn, bridge trả `503 not_authenticated` (và `/health` có `"authenticated": false`); chạy lại `notebooklm login` là đủ.

## Chạy bridge

```bash
export BRIDGE_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"   # GHI LẠI giá trị này
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8765
# hoặc: .venv/bin/python -m app        (đọc BRIDGE_HOST / BRIDGE_PORT)
```

`BRIDGE_TOKEN` là **bắt buộc** (≥ 16 ký tự). Thiếu → bridge **từ chối khởi động**; mọi route (kể cả `/health`) đều cần
`Authorization: Bearer <BRIDGE_TOKEN>`; so sánh token theo thời gian hằng định.

Kiểm tra nhanh:

```bash
curl -s localhost:8765/health -H "Authorization: Bearer $BRIDGE_TOKEN"
# {"ok":true,"version":"0.1.0","notebooklm_py_version":"0.8.5","authenticated":true,"account":"you@gmail.com"}
```

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BRIDGE_TOKEN` | *(bắt buộc)* | Bearer token (≥ 16 ký tự). |
| `BRIDGE_HOST` / `BRIDGE_PORT` | `127.0.0.1` / `8765` | Địa chỉ nghe, dùng cho `python -m app` và Docker. Với `uvicorn` thì truyền `--host/--port`. |
| `BRIDGE_ALLOWED_ORIGINS` | *(rỗng = tắt CORS)* | Danh sách origin, ngăn cách bằng dấu phẩy. Server KBM gọi server-to-server nên **không cần**; chỉ đặt nếu trình duyệt gọi trực tiếp. |
| `BRIDGE_MAX_UPLOAD_MB` | `50` | Giới hạn kích thước **toàn bộ body** request (gồm upload). Vượt → `413 payload_too_large`. |
| `NOTEBOOKLM_PROFILE` | *(profile đang active)* | Profile `notebooklm-py` dùng để gọi Google. |
| `NOTEBOOKLM_HOME` | `~/.notebooklm` | Nơi `notebooklm login` lưu phiên. |
| `BRIDGE_TMP_DIR` | thư mục tmp hệ thống | Thư mục tạm cho upload/download (xoá ngay sau mỗi request). |
| `BRIDGE_HEALTH_TTL_SECONDS` | `60` | Thời gian cache kết quả kiểm tra đăng nhập của `/health`. |
| `BRIDGE_KEEPALIVE_SECONDS` | `600` | Chu kỳ giữ cookie sống; `0` = tắt. |

Mẫu đầy đủ: [`.env.example`](.env.example).

### systemd

`/etc/kbm-notebooklm-bridge.env` (quyền `600`, chủ sở hữu root):

```ini
BRIDGE_TOKEN=thay-bang-chuoi-ngau-nhien-dai
NOTEBOOKLM_PROFILE=
```

`/etc/systemd/system/kbm-notebooklm-bridge.service`:

```ini
[Unit]
Description=KBM Notebook - NotebookLM Bridge (unofficial)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kbm
WorkingDirectory=/opt/kbm-notebook/bridge/notebooklm
EnvironmentFile=/etc/kbm-notebooklm-bridge.env
Environment=NOTEBOOKLM_HOME=/home/kbm/.notebooklm
ExecStart=/opt/kbm-notebook/bridge/notebooklm/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8765 --no-server-header
Restart=on-failure
RestartSec=5
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/kbm/.notebooklm
ProtectKernelTunables=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now kbm-notebooklm-bridge
journalctl -u kbm-notebooklm-bridge -f
```

`ReadWritePaths` phải cho phép ghi vì thư viện cập nhật cookie vào thư mục đăng nhập.

### Docker

```bash
docker build -t kbm-notebooklm-bridge .
docker run -d --name notebooklm-bridge --restart unless-stopped \
  --user "$(id -u):$(id -g)" \
  -e BRIDGE_TOKEN="$BRIDGE_TOKEN" \
  -v "$HOME/.notebooklm:/data" \
  -p 127.0.0.1:8765:8765 kbm-notebooklm-bridge
```

Đăng nhập Google vẫn phải làm **trên host** (`notebooklm login`); container chỉ mount thư mục phiên (đọc/ghi). Không build master token
vào image.

### Triển khai an toàn

- Mặc định chỉ nghe `127.0.0.1`. Nếu app KBM ở máy khác, đặt bridge sau reverse proxy **HTTPS** (Caddy/nginx) hoặc dùng
  VPN/Tailscale; token đi qua HTTP thường là **không an toàn**.
- Token là lớp bảo vệ duy nhất: dùng chuỗi ngẫu nhiên dài, xoay vòng định kỳ, giới hạn IP ở tường lửa/proxy, thêm rate-limit ở proxy.
- Bridge không ghi log token hay nội dung câu hỏi/tài liệu.

## Cấu hình trong KBM Notebook

1. Mở **Settings → Connectors → NotebookLM Bridge (Experimental)**.
2. **Bridge URL**: `http://127.0.0.1:8765` (hoặc URL HTTPS của reverse proxy).
3. **Token**: giá trị `BRIDGE_TOKEN`. Token được lưu mã hoá phía server của KBM và không bao giờ trả về trình duyệt.
4. Bấm **Kiểm tra kết nối** → app gọi `GET /health`:
   - `authenticated: true` → trạng thái **Sẵn sàng**, hiển thị `account`.
   - `authenticated: false` → **Chưa đăng nhập**: chạy `notebooklm login` trên máy bridge (xem trường `detail`).
   - Không kết nối được / `401` → **Lỗi** (sai URL hoặc token).
5. Chọn sổ tay NotebookLM để liên kết với sổ tay KBM. Khi hỏi đáp, app gọi `POST /notebooks/{id}/ask` và dùng `references[]` làm trích dẫn.

## Tham chiếu API

Mọi request cần header `Authorization: Bearer <BRIDGE_TOKEN>`. Body JSON (`Content-Type: application/json`) trừ upload file.
Schema OpenAPI đầy đủ (cũng cần token): `GET /openapi.json`.

| Method & đường dẫn | Body / query | Trả về |
|---|---|---|
| `GET /health` | `?refresh=true` bỏ qua cache 60 s | `{ok, version, notebooklm_py_version, authenticated, account?, detail?}` (luôn `200` nếu token đúng) |
| `GET /notebooks` | | `[{id, title, source_count, updated_at, created_at}]` |
| `POST /notebooks` | `{title}` | `201` notebook |
| `GET /notebooks/{id}` | | notebook + `sources: [{id, title, kind, status, url}]` |
| `GET /notebooks/{id}/sources` | | `[{id, title, kind, status, url}]` (`status`: `processing`/`ready`/`error`/`preparing`) |
| `POST /notebooks/{id}/sources` | `{type:"text", title, text}` **hoặc** `{type:"url", url, title?}` **hoặc** `multipart/form-data` (`file`, `title?`) | `201` source vừa tạo (thường `status: processing`, poll bằng `GET .../sources`) |
| `DELETE /notebooks/{id}/sources/{sourceId}` | | `204` (hoặc `404 source_not_found`) |
| `POST /notebooks/{id}/ask` | `{question, source_ids?: string[], conversation_id?}` | `{answer, conversation_id, references: [{source_id, source_title?, citation_number, cited_text, start_char, end_char, score?}]}` |
| `GET /notebooks/{id}/notes` | | `[{id, title, content, created_at}]` |
| `POST /notebooks/{id}/notes` | `{title, content}` | `201` note |
| `GET /notebooks/{id}/artifacts` | | `[{id, title, type, status, created_at, source_ids}]` |
| `POST /notebooks/{id}/artifacts/generate` | `{type, instructions?, options?}` — `type` ∈ `slide_deck`, `report`, `quiz`, `flashcards`, `mind_map`, `infographic`, `data_table`, `audio`, `video` | `202` `{task_id, artifact_id, type, status, error?}` (`task_id == artifact_id`) |
| `GET /notebooks/{id}/artifacts/{artifactId}` | | artifact; `status`: `pending` → `in_progress` → `completed` / `failed` |
| `GET /notebooks/{id}/artifacts/{artifactId}/download` | `?format=` | file stream (xem bảng định dạng); `409 artifact_not_ready` nếu chưa `completed` |
| `GET /notebooks/{id}/share` | | `{notebook_id, is_public, access, view_level, share_url, shared_users[], ...}` |

### `ask`: trích dẫn

`references[].start_char/end_char` là offset trong **tài liệu nguồn**, tính theo **đơn vị UTF-16** (không phải ký tự Python/JS
code point). `source_title` được bridge tra từ danh sách nguồn (nếu nguồn đã bị xoá thì `null`). `source_ids` rỗng/sai chính tả
bị từ chối `422` (không bao giờ âm thầm hỏi trên toàn bộ nguồn). Lưu `conversation_id` để hỏi tiếp trong cùng cuộc trò chuyện.

### `generate`: `options`

Khoá lạ → `422`. Giá trị enum không phân biệt hoa/thường.

| Chung | `source_ids: string[]` (mặc định: tất cả nguồn), `language: "vi" \| "en" \| ...` (mặc định: ngôn ngữ cấu hình của notebooklm-py) |
|---|---|
| `slide_deck` | `slide_format`: `detailed_deck`, `presenter_slides`; `slide_length`: `default`, `short` |
| `report` | `report_format`: `briefing_doc` (mặc định), `study_guide`, `blog_post`, `concept_explanation`, `custom` (khi `custom`, `instructions` là prompt chính) |
| `quiz`, `flashcards` | `quantity`: `fewer`, `standard`, `more`; `difficulty`: `easy`, `medium`, `hard` |
| `infographic` | `orientation`: `landscape`, `portrait`, `square`; `detail_level`: `concise`, `standard`, `detailed`; `style`: `auto_select`, `sketch_note`, `professional`, `bento_grid`, `editorial`, `instructional`, `bricks`, `clay`, `anime`, `kawaii`, `scientific` |
| `audio` | `audio_format`: `deep_dive`, `brief`, `critique`, `debate`; `audio_length`: `short`, `default`, `long` |
| `video` | `video_format`: `explainer`, `brief`, `cinematic`, `short`; `video_style`: `auto_select`, `custom`, `classic`, `whiteboard`, `kawaii`, `anime`, `watercolor`, `retro_print`, `heritage`, `paper_craft`; `style_prompt: string` |
| `mind_map`, `data_table` | chỉ các tuỳ chọn chung |

Tạo artifact là bất đồng bộ (trừ `mind_map` trả ngay `completed`): poll `GET .../artifacts/{id}` mỗi 5–10 s cho đến khi `completed`
(slide/audio/video có thể mất vài phút). Ngay sau khi tạo, artifact có thể mất vài giây mới xuất hiện (`404 artifact_not_found` tạm thời → thử lại).

### `download`: định dạng

| `type` | `format` hợp lệ (mặc định đứng đầu) | Content-Type |
|---|---|---|
| `slide_deck` | `pdf`, `pptx` | `application/pdf`, `...presentationml.presentation` |
| `report` | `md` | `text/markdown` |
| `quiz`, `flashcards` | `json`, `md` (alias `markdown`), `html` | `application/json`, `text/markdown`, `text/html` |
| `mind_map` | `json` | `application/json` |
| `data_table` | `csv` | `text/csv` |
| `infographic` | `png` | `image/png` |
| `audio` | `m4a` | `audio/mp4` |
| `video` | `mp4` | `video/mp4` |

File được tải về thư mục tạm, stream cho client rồi **xoá ngay**. Định dạng không hợp lệ cho loại artifact → `400 unsupported_format`;
tên không biết → `400 invalid_format`.

### Mã lỗi

| HTTP | `error.code` | Khi nào |
|---|---|---|
| 401 | `unauthorized` | Thiếu/sai bearer token |
| 503 | `bridge_not_configured` | Bridge chạy mà chưa có `BRIDGE_TOKEN` (thực tế bridge không khởi động) |
| 503 | `not_authenticated` | Máy bridge chưa đăng nhập Google hoặc phiên hết hạn → `notebooklm login` |
| 400 / 422 | `invalid_request`, `invalid_format`, `unsupported_format` | Dữ liệu vào sai |
| 404 | `notebook_not_found`, `source_not_found`, `artifact_not_found`, `note_not_found`, `not_found` | Không tồn tại |
| 409 | `artifact_not_ready`, `notebook_limit_reached` | Trạng thái không cho phép |
| 413 | `payload_too_large` | Vượt `BRIDGE_MAX_UPLOAD_MB` |
| 415 | `unsupported_media_type` | `POST .../sources` không phải JSON/multipart |
| 429 | `rate_limited` | Google giới hạn tốc độ (kèm `Retry-After`) |
| 501 | `not_supported` | Xem mục dưới |
| 502 | `upstream_error`, `upstream_rejected`, `network_error`, `chat_failed`, `source_add_failed`, `download_failed` | Google/mạng lỗi |
| 502 | `upstream_changed` | Giao thức Google đã đổi → nâng cấp `notebooklm-py` |
| 504 | `timeout` | Hết thời gian chờ Google |

## Giới hạn và những gì KHÔNG hỗ trợ (`501 not_supported`)

- `GET .../artifacts/{id}/download?format=mp3` cho `audio` → **`501 not_supported`**: `notebooklm-py` chỉ cung cấp Audio Overview
  dạng `.m4a` (`audio/mp4`), không có chuyển mã sang mp3. Dùng `format=m4a` (mặc định).
- Các lỗi `UnsupportedOperationError` của thư viện (ví dụ backend Android) cũng được trả `501 not_supported`.
- Loại artifact `fantasy_map`/`file`/`unknown` có thể xuất hiện trong danh sách nhưng không tải được qua bridge (`501`).
- Chưa có endpoint: xoá/đổi tên notebook, sửa/xoá note, chia sẻ (chỉ **đọc** trạng thái), nguồn Google Drive, Deep Research, xoá artifact.

Khác biệt cần biết:

- `updated_at` của notebook là **lần cuối tài khoản này mở notebook** (NotebookLM không công bố thời điểm sửa thật); nếu thiếu thì dùng `created_at`.
  `GET /notebooks/{id}` (thư viện gọi `notebooks.get`) làm **cập nhật mốc "mở gần đây"** của notebook đó trong giao diện NotebookLM.
- `mind_map` tạo kiểu **note-backed** (đồng bộ, JSON cây); không tạo mind map "interactive".
- Mọi lời gọi dùng chung một tài khoản Google nên chịu **hạn mức/giới hạn tốc độ** của tài khoản đó; thư viện tự retry vài lần với 429/5xx.
- Các endpoint liệt kê không phân trang (NotebookLM không phân trang).

## Phát triển & kiểm thử

```bash
.venv/bin/pytest -q                       # 90+ test, không cần đăng nhập Google
.venv/bin/python -c "import app.main"     # kiểm tra import với thư viện thật
```

- Lớp `app/client.py` định nghĩa `Protocol` `BridgeClient`; test HTTP dùng `tests/fakes.py::FakeClient` (in-memory).
- `tests/test_real_client.py` kiểm tra lớp bọc thật với `create_autospec` của các API trong `notebooklm-py` ⇒ sai tên hàm/tham số sẽ lỗi ngay.
- `tests/test_errors_and_sync.py` so khớp bảng tuỳ chọn/định dạng tải với enum và `DOWNLOAD_REGISTRY` của thư viện đã cài ⇒ báo ngay khi nâng cấp `notebooklm-py` làm lệch.
- **Không thể kiểm thử tự động với Google thật** (cần phiên đăng nhập). Trước khi phát hành cho người dùng, hãy chạy thủ công một vòng: `health` → `notebooks` → thêm nguồn text → `ask` → `generate` + `download`.

Nâng cấp thư viện: đổi phiên bản ghim trong `pyproject.toml`, `pip install -e ".[dev]"`, chạy `pytest`, rồi thử tay vòng trên.

## Cấu trúc

```
bridge/notebooklm/
  app/main.py        FastAPI: routes, middleware, factory create_app()
  app/auth.py        bearer token (ASGI middleware, so sánh hằng định)
  app/client.py      Protocol BridgeClient + NotebookLMBridgeClient (bọc notebooklm-py)
  app/models.py      Pydantic request/response (hợp đồng API ổn định)
  app/errors.py      Ánh xạ exception thư viện → {error:{code,message}}
  app/generation.py  Tuỳ chọn generate + bảng định dạng tải
  app/limits.py      Giới hạn kích thước body
  app/config.py      Cấu hình từ biến môi trường
  tests/             pytest + FakeClient
  Dockerfile  pyproject.toml  .env.example
```

Giấy phép: bridge này thuộc dự án KBM Notebook; `notebooklm-py` là MIT (© Teng Lin), không liên kết với Google.
