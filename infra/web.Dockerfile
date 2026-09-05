# Client build.
#
# Produces /app/apps/web/dist and nothing else -- Caddy serves it from a shared
# volume, so the edge container carries no Node runtime and no build tooling.
FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate
WORKDIR /app

ARG VITE_PUBLIC_URL
ENV VITE_PUBLIC_URL=${VITE_PUBLIC_URL}

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @kidpc/web...

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @kidpc/web build
