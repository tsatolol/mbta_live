# Web とジョブ共通のイメージ（憲章の原則 VI: イメージは 1 つ。環境ごとの違いは実行時の環境変数だけ）。
# 起動コマンドは docs/architecture.md の「イメージの起動コマンド」を参照。
#
#   /app/server.js, /app/.next, /app/node_modules  … Next.js の standalone 出力（web）
#   /app/jobs/*.mjs                                 … 依存を含めてまとめたジョブ（collector / sync-static / aggregate）
#   /app/migrate/                                   … Prisma CLI とマイグレーション（migrate Job）
#
# ビルド時に環境ごとの値を入れない（NEXT_PUBLIC_* を使わない）。

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
# Prisma の schema engine（migrate）が OpenSSL を使う
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1 \
  CHECKPOINT_DISABLE=1

# ---- ビルド: 依存をすべて入れて、Next.js とジョブをビルドする
FROM base AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src/lib/db/connection.ts ./src/lib/db/connection.ts
# postinstall で prisma generate が動く
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm build:jobs

# ---- migrate 用の依存: lockfile どおりに本番用の依存を入れ、Prisma CLI に要らない大きなパッケージを除く
FROM base AS migrate-deps
WORKDIR /migrate
COPY package.json pnpm-lock.yaml ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src/lib/db/connection.ts ./src/lib/db/connection.ts
RUN pnpm install --prod --frozen-lockfile \
  && rm -rf node_modules/next node_modules/.pnpm/next@* node_modules/.pnpm/@next+* \
    node_modules/.pnpm/@img+* node_modules/@prisma/client node_modules/.pnpm/@prisma+client@* \
    src/generated

# ---- 実行イメージ
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  PORT=8080 \
  HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /src/.next/standalone ./
COPY --from=build --chown=node:node /src/.next/static ./.next/static
# 静的ファイル（MapLibre の Web Worker など。pnpm build が public/vendor/ に置く）
COPY --from=build --chown=node:node /src/public ./public
COPY --from=build --chown=node:node /src/dist/jobs ./jobs
COPY --from=migrate-deps --chown=node:node /migrate ./migrate

USER node
EXPOSE 8080
# 既定は web。ジョブは Cloud Run Job の command / args で上書きする
CMD ["node", "server.js"]
