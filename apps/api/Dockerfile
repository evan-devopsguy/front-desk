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
# pnpm workspaces symlink each workspace's deps from its own node_modules
# into the root /app/node_modules/.pnpm virtual store. The root copy alone
# leaves Node's resolver unable to find packages — we also need the
# per-workspace node_modules so the symlinks exist. shared has no runtime
# deps today, but copy it for parity if any are added later.
COPY --from=builder --chown=medspa:medspa /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=builder --chown=medspa:medspa /app/apps/api/dist /app/apps/api/dist
COPY --from=builder --chown=medspa:medspa /app/apps/api/package.json /app/apps/api/package.json
COPY --from=builder --chown=medspa:medspa /app/apps/api/src/db/schema.sql /app/apps/api/src/db/schema.sql
# tsc with both apps/api/src and packages/shared/src in include → outDir
# preserves the project-relative structure, so compiled JS lands at
# dist/apps/api/src/... and dist/packages/shared/src/... (NOT a flat dist/).
# migrate.ts resolves migrations/ via import.meta.url, so the SQL files
# must sit beside the compiled migrate.js. tsc doesn't copy .sql files.
COPY --from=builder --chown=medspa:medspa /app/apps/api/src/db/migrations /app/apps/api/dist/apps/api/src/db/migrations

EXPOSE 3001
CMD ["node", "apps/api/dist/apps/api/src/server.js"]
