# Control plane image.
FROM node:20-bookworm-slim

# The Docker CLI, because the session driver shells out to it. See the KNOWN
# LIMITATION note in docker-compose.yml before shipping this anywhere real.
RUN apt-get update \
    && apt-get install --no-install-recommends -y docker.io ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.34.4 --activate
WORKDIR /app

# Manifests first: dependency installs are the slow layer and change least.
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/policy/package.json packages/policy/
COPY packages/broker/package.json packages/broker/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --filter @kidpc/api...

COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services/api ./services/api

ENV NODE_ENV=production
EXPOSE 4000
USER node
CMD ["pnpm", "--filter", "@kidpc/api", "start"]
