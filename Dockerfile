# KBM Notebook — image production (đa tầng). Hướng dẫn đầy đủ: docs/08-trien-khai.md
#
#   docker build -t kbm-notebook .
#   docker build --build-arg WITH_LIBREOFFICE=true -t kbm-notebook:office .   # thêm LibreOffice (PDF dự phòng)
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
RUN pnpm build

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
    && rm -rf /var/lib/apt/lists/*
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
# Chạy migration (idempotent) rồi khởi động server.
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
