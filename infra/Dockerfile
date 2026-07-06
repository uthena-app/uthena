# Multi-stage build for Uthena v2.
# - deps: install pnpm deps with caching
# - builder: produce the standalone Next.js output
# - runner: minimal runtime with non-root user, healthcheck, signal handling
#
# ADR-0006: Node 20 LTS, pnpm, distroless or alpine runner.
# We use alpine for easier debugging; the prod image stays small via
# Next's standalone output and a pruned node_modules.

# ----- Stage 1: deps -----
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* .npmrc ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# ----- Stage 2: builder -----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ----- Stage 3: runner -----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 uthena

# Copy standalone build output.
COPY --from=builder --chown=uthena:nodejs /app/.next/standalone ./
COPY --from=builder --chown=uthena:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=uthena:nodejs /app/public ./public

USER uthena
EXPOSE 3000

# Healthcheck hits /api/health (defined in PH01).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Use the standalone server entry.
CMD ["node", "server.js"]
