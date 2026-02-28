# =============================================================================
# ForgeTeam Gateway - Multi-stage Docker build
# =============================================================================

# Stage 1: Install dependencies using npm workspaces from root
FROM node:22-alpine AS deps
WORKDIR /app

# Copy root package.json and all workspace package.json files
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY gateway/package.json ./gateway/
COPY dashboard/package.json ./dashboard/

# Install all workspace dependencies from root
RUN npm install --workspaces --include-workspace-root

# Stage 2: Build / verify TypeScript
FROM node:22-alpine AS builder
WORKDIR /app

# Copy full node_modules from workspace install
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./

# Copy all source code
COPY shared/ ./shared/
COPY gateway/ ./gateway/
COPY memory/ ./memory/
COPY viadp/ ./viadp/

# Install tsx globally for runtime
RUN npm install -g tsx

# Verify gateway compiles
WORKDIR /app/gateway
RUN npx tsc --noEmit

# Install Playwright browsers for QA agent browser testing
RUN npx playwright install --with-deps chromium

# Stage 3: Production image
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 forgeteam && \
    adduser --system --uid 1001 forgeteam

# Install tsx globally
RUN npm install -g tsx

# Copy workspace structure
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./
COPY shared/ ./shared/
COPY gateway/ ./gateway/
COPY memory/ ./memory/
COPY viadp/ ./viadp/
COPY agents/ ./agents/
COPY workflows/ ./workflows/

RUN chown -R forgeteam:forgeteam /app

USER forgeteam

ENV NODE_ENV=production
ENV PORT=18789

EXPOSE 18789

WORKDIR /app/gateway

CMD ["tsx", "src/index.ts"]
