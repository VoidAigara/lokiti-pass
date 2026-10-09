# syntax=docker/dockerfile:1
# Сборка: docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t loki-web .

FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3000
ARG NEXT_PUBLIC_BOT_USERNAME=
ARG NEXT_PUBLIC_MC_IP=play.lokiti.ru
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID=
ARG NEXT_PUBLIC_UMAMI_HOST=
ENV NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL \
    NEXT_PUBLIC_BOT_USERNAME=$NEXT_PUBLIC_BOT_USERNAME \
    NEXT_PUBLIC_MC_IP=$NEXT_PUBLIC_MC_IP \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID \
    NEXT_PUBLIC_UMAMI_HOST=$NEXT_PUBLIC_UMAMI_HOST

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @loki/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @loki/shared build \
 && pnpm --filter @loki/web build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
