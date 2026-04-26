# syntax=docker/dockerfile:1.7
# 999.md house crawler — single-stage runtime image is fine for a ~250 LOC POC,
# but we use a multi-stage build so node_modules don't carry build-only deps.

ARG NODE_VERSION=22
ARG PNPM_VERSION=9.12.0

# ---------- deps ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile=false \
 && pnpm prisma generate

# ---------- build ----------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate \
 && apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    TZ=Europe/Chisinau \
    DATABASE_URL=file:/data/crawler.db

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=deps  /app/prisma       ./prisma
COPY --from=build /app/dist         ./dist
COPY package.json ./

# /data is provided by the named volume in docker-compose.yml
RUN mkdir -p /data
VOLUME ["/data"]

USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
