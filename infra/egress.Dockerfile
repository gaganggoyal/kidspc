FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY services/egress/package.json services/egress/
RUN pnpm install --frozen-lockfile --filter @kidpc/egress...

COPY tsconfig.base.json tsconfig.json ./
COPY services/egress ./services/egress

ENV NODE_ENV=production
EXPOSE 3128
USER node
CMD ["pnpm", "--filter", "@kidpc/egress", "start"]
