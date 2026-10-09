# syntax=docker/dockerfile:1
# Build: docker build -f apps/api/Dockerfile -t loki-api .
# Context: repo root (needs packages/* and apps/*).
#
# Debian slim instead of alpine: Prisma on musl (alpine) has trouble detecting
# OpenSSL and may fail to fetch/run the correct query engine.

FROM node:20-slim AS build
RUN npm i -g pnpm@9.15.9
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @loki/api...

COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @loki/shared build \
 && pnpm --filter @loki/db build \
 && pnpm --filter @loki/api build

FROM node:20-slim AS runner
RUN npm i -g pnpm@9.15.9 \
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app /app

EXPOSE 3001
USER node
# Migrations first (idempotent), then the API itself.
CMD ["sh", "-c", "node packages/db/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma && node apps/api/dist/server.js"]
