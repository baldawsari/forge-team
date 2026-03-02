# =============================================================================
# ForgeTeam Dashboard - Multi-stage Next.js Docker build
# =============================================================================

# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY dashboard/package.json ./

RUN npm install

# Stage 2: Build the Next.js application
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY dashboard/ ./

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# NEXT_PUBLIC_* vars are baked at build time in Next.js static builds.
# Default to localhost since the BROWSER (not the container) makes these requests.
ARG NEXT_PUBLIC_GATEWAY_URL=http://localhost:18789
ENV NEXT_PUBLIC_GATEWAY_URL=${NEXT_PUBLIC_GATEWAY_URL}

RUN npm run build

# Stage 3: Production image
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 forgeteam && \
    adduser --system --uid 1001 forgeteam

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN chown -R forgeteam:forgeteam /app

USER forgeteam

EXPOSE 3000

CMD ["node", "server.js"]
