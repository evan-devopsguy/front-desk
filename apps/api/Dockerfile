FROM node:20.18-alpine AS builder
WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile=false

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @medspa/api build

# ---------- Runtime ----------
FROM node:20.18-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S medspa && adduser -S medspa -G medspa
USER medspa

COPY --from=builder --chown=medspa:medspa /app/node_modules /app/node_modules
COPY --from=builder --chown=medspa:medspa /app/packages/shared /app/packages/shared
COPY --from=builder --chown=medspa:medspa /app/apps/api/dist /app/apps/api/dist
COPY --from=builder --chown=medspa:medspa /app/apps/api/package.json /app/apps/api/package.json
COPY --from=builder --chown=medspa:medspa /app/apps/api/src/db/schema.sql /app/apps/api/src/db/schema.sql

EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
