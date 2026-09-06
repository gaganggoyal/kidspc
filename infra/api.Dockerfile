# Control plane image.
FROM node:20-bookworm-slim

# The Docker CLI, because the session driver shells out to it. See the KNOWN
# LIMITATION note in docker-compose.yml before shipping this anywhere real.
#
# A lite deployment provisions no desktops and never invokes it, so it builds
# with WITH_DOCKER_CLI=0 and ships neither the binary nor its dependencies --
# a CLI that can only ever be used by an attacker is not worth 100 MB.
ARG WITH_DOCKER_CLI=1
RUN if [ "$WITH_DOCKER_CLI" = "1" ]; then \
      apt-get update \
      && apt-get install --no-install-recommends -y docker.io ca-certificates \
      && apt-get clean && rm -rf /var/lib/apt/lists/*; \
    else \
      apt-get update \
      && apt-get install --no-install-recommends -y ca-certificates \
      && apt-get clean && rm -rf /var/lib/apt/lists/*; \
    fi

RUN corepack enable && corepack prepare pnpm@10.34.4 --activate
WORKDIR /app

# Manifests first: dependency installs are the slow layer and change least.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
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
