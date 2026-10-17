# KBM Notebook — image production (đa tầng). Hướng dẫn đầy đủ: docs/08-trien-khai.md
#
#   docker build -t kbm-notebook .
#   docker build --build-arg WITH_LIBREOFFICE=true -t kbm-notebook:office .   # thêm LibreOffice (PDF dự phòng)
#
# Cloud Run: dùng nguyên image này (lắng nghe $PORT — Cloud Run đặt PORT theo `--port`; chạy bằng user `node`; HEALTHCHECK chỉ
# có tác dụng với Docker/Compose, Cloud Run dùng startup probe TCP). Pipeline KHÔNG truyền WITH_LIBREOFFICE để image gọn
# (PDF xuất bằng Chromium). Xem docs/08-trien-khai.md.
#
# Ghi chú: ứng dụng chạy bằng custom server `dist/server.js` (Next + Socket.IO + job worker), KHÔNG dùng `next start`.

ARG NODE_VERSION=22

# ---- 1) deps: cài toàn bộ phụ thuộc (kể cả dev) để build ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- 2) build: next build + bundle server.ts và migrate.ts → dist/ ----
FROM deps AS build
COPY . .
# Biến chỉ cần để `next build` chạy; giá trị thật được truyền khi chạy container.
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-secret-not-used-at-runtime \
    APP_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
# Bỏ cache build của Next (hàng trăm MB, không cần lúc chạy) để image nhỏ hơn — quan trọng với Artifact Registry free 0,5 GB.
RUN pnpm build && rm -rf .next/cache

# ---- 3) prod-deps: chỉ phụ thuộc runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# ---- 4) runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG WITH_LIBREOFFICE=false
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME_BIND=0.0.0.0 \
    STORAGE_DIR=/data/storage \
    PW_CHROMIUM_PATH=/usr/bin/chromium
# Chromium (xuất PDF/PNG/SVG của Studio) + phông chữ có tiếng Việt; LibreOffice là tuỳ chọn.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji ca-certificates tini \
    && if [ "$WITH_LIBREOFFICE" = "true" ]; then apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress; fi \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json next.config.ts ./
# Thư mục lưu tệp tải lên: mount volume vào /data/storage
RUN mkdir -p /data/storage && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME ["/data/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Mặc định: chạy migration (idempotent) rồi khởi động server (docker compose / máy chủ đơn).
# Cloud Run: đặt SKIP_MIGRATE=true cho dịch vụ (migration chạy riêng bằng Cloud Run job `node dist/migrate.js`,
# xem .github/workflows/deploy-cloud-run.yml) để mỗi instance khởi động nhanh và không tranh nhau migrate.
# `exec` để node là con trực tiếp của tini, nhận SIGTERM đúng cách.
CMD ["sh", "-c", "if [ \"$SKIP_MIGRATE\" != \"true\" ]; then node dist/migrate.js || exit 1; fi; exec node dist/server.js"]
