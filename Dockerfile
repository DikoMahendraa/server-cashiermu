# syntax=docker/dockerfile:1
# CashierMu API image. Two stages: build (needs TypeScript and the full dependency tree) and runtime (production
# dependencies only, runs as the unprivileged `node` user). See docs/15-deployment.md.

# ── build ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# `prisma` (the CLI that applies migrations) is a production dependency on purpose.
# The `prepare` script installs git hooks (husky, a dev dependency) and would fail without it, so drop it in this image.
RUN npm pkg delete scripts.prepare && npm ci --omit=dev && npm cache clean --force

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist
# The /docs site and its "reference" pages read these at runtime (the site is off in production unless enabled)
COPY docs ./docs
COPY README.md CHANGELOG.md DEPLOYMENT_GUIDE.md notes.md ./

RUN mkdir -p /app/logs && chown -R node:node /app/logs
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/app.js"]
