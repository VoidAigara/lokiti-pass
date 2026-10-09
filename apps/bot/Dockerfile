# syntax=docker/dockerfile:1
# Сборка: docker build -f apps/bot/Dockerfile -t loki-bot .

FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/bot/package.json apps/bot/package.json
RUN pnpm install --frozen-lockfile --filter @loki/bot...

COPY packages packages
COPY apps/bot apps/bot
RUN pnpm --filter @loki/shared build \
 && pnpm --filter @loki/bot build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app /app

USER node
CMD ["node", "apps/bot/dist/index.js"]
