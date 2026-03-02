# ForgeTeam Infrastructure & Configuration Audit - Session 7

**Date:** 2026-03-01
**Scope:** Docker, environment variables, ports, CORS, service connectivity, Dockerfiles, dependencies
**Project Root:** `/Users/bandar/Documents/AreebPro/forge-team/`

---

## Executive Summary

The infrastructure is largely well-structured for a monorepo. However, there are **15 actionable issues** spanning environment variable mismatches, security concerns, Docker build inconsistencies, and dependency gaps. The most critical findings are: (1) live API keys committed to `.env` and `.env.example`, (2) several environment variables expected by code but never passed through docker-compose, (3) the gateway reads `GATEWAY_PORT` but docker-compose passes `PORT`, and (4) the dashboard Dockerfile bakes a wrong default gateway URL at build time.

---

## 1. Docker Compose & Environment Variable Audit

### 1.1 Services Overview

| Service    | Image/Build                        | Internal Port | External Port      | Network     |
|------------|-----------------------------------|---------------|--------------------|-------------|
| gateway    | `docker/gateway.Dockerfile`       | 18789         | `${PORT:-18789}`   | forgeteam   |
| dashboard  | `docker/dashboard.Dockerfile`     | 3000          | `${DASHBOARD_PORT:-3000}` | forgeteam |
| postgres   | `pgvector/pgvector:pg16`          | 5432          | `127.0.0.1:5432`   | forgeteam   |
| redis      | `redis:7-alpine`                  | 6379          | `127.0.0.1:6379`   | forgeteam   |
| qdrant     | `qdrant/qdrant:latest`            | 6333, 6334    | `6333`, `6334`     | forgeteam   |
| minio      | `minio/minio:latest`              | 9000, 9001    | `127.0.0.1:9000`, `127.0.0.1:9001` | forgeteam |

### 1.2 Gateway Service - Environment Variable Mismatch

#### Variables the CODE reads but docker-compose does NOT pass

| Env Variable | Where Used | Default in Code | Severity |
|---|---|---|---|
| `GATEWAY_PORT` | `gateway/src/index.ts:54` | `'18789'` | **HIGH** - Code reads `GATEWAY_PORT`, but docker-compose passes `PORT=18789`. The code never reads `PORT`. The default (`18789`) masks this, but the naming mismatch is a latent bug. If someone changes `PORT` in docker-compose thinking it controls the gateway, it will not. |
| `GATEWAY_HOST` | `gateway/src/index.ts:55` | `'0.0.0.0'` | LOW - Reasonable default |
| `FORCE_AUTH` | `gateway/src/index.ts:56`, `server.ts:33` | `undefined` (auth disabled in dev) | LOW - Optional toggle |
| `JWT_SECRET` | `gateway/src/auth.ts:14` | Dev fallback secret | **CRITICAL** - Not passed in docker-compose. Code falls back to a hardcoded dev secret (`forgeteam-dev-secret-DO-NOT-USE-IN-PRODUCTION`). In production, JWT tokens would be trivially forgeable. |
| `JWT_EXPIRY` | `gateway/src/auth.ts:15` | `'24h'` | LOW - Reasonable default |
| `ADMIN_SECRET` | `gateway/src/index.ts:1470` | `undefined` | **HIGH** - Used to gate token generation in non-dev mode. Never passed through docker-compose. In production, `/api/auth/token` will compare against `undefined`, meaning any request header value of `undefined` (the string) would pass. |
| `OPENAI_API_KEY` | `gateway/src/voice-handler.ts:99` | `''` (empty) | LOW - Fallback for `WHISPER_API_KEY`, which is passed |
| `WHATSAPP_PHONE_NUMBER_ID` | `gateway/src/tools/api-stubs.ts:315,329` | `''` (empty) | MEDIUM - WhatsApp integration will silently fail. docker-compose passes `WHATSAPP_API_TOKEN` but not `WHATSAPP_PHONE_NUMBER_ID`. |

#### Variables docker-compose passes but code NEVER reads

| Env Variable | Passed in docker-compose | Notes |
|---|---|---|
| `PORT` | `PORT=18789` | **Code reads `GATEWAY_PORT`, not `PORT`.** The Dockerfile also sets `ENV PORT=18789` but the code ignores it. |
| `JIRA_API_TOKEN` | `${JIRA_API_TOKEN:-}` | No `process.env.JIRA_API_TOKEN` found in any `.ts` file. Jira integration does not appear to be implemented yet. |
| `JIRA_BASE_URL` | `${JIRA_BASE_URL:-}` | Same - not referenced in code. |
| `JIRA_EMAIL` | `${JIRA_EMAIL:-}` | Same - not referenced in code. |
| `SUPABASE_URL` | `${SUPABASE_URL:-}` | Not referenced in code. |
| `SUPABASE_SERVICE_KEY` | `${SUPABASE_SERVICE_KEY:-}` | Not referenced in code. |
| `VERCEL_TOKEN` | `${VERCEL_TOKEN:-}` | Not referenced in code. |
| `DEPLOYMENT_REGION` | `${DEPLOYMENT_REGION:-riyadh}` | Actually IS referenced in `index.ts:1551`. This entry is correct. |

**Note:** `DEPLOYMENT_REGION` is correctly used. The Jira/Supabase/Vercel vars are pre-provisioned for future integrations but are dead code today.

### 1.3 Dashboard Service - Environment Variables

| Env Variable | docker-compose Value | Code Usage | Issue |
|---|---|---|---|
| `NEXT_PUBLIC_GATEWAY_URL` | `http://localhost:18789` (runtime env) | `api.ts:3`, `socket.ts:8` | **MEDIUM** - Both `api.ts` and `socket.ts` bypass this env var when running in the browser (`typeof window !== 'undefined'`) and hardcode `http://localhost:18789`. The env var is only used during SSR. This means the docker-compose setting is effectively ignored at runtime. |
| `NEXT_PUBLIC_WS_URL` | `http://localhost:18789` | **Never used in code** | **LOW** - Passed in docker-compose but no `.ts` file references `NEXT_PUBLIC_WS_URL`. Dead variable. |

### 1.4 .env File Issues

| Issue | Severity | Details |
|---|---|---|
| **Live API keys in `.env` AND `.env.example`** | **CRITICAL** | Both `.env` and `.env.example` contain real `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `ELEVENLABS_API_KEY`, and `WHISPER_API_KEY` values. The `.env.example` should contain placeholder values only. |
| `REDIS_PASSWORD` missing from `.env` | **HIGH** | `.env.example` has `REDIS_PASSWORD=CHANGE_ME_IN_PRODUCTION`, but `.env` does not define `REDIS_PASSWORD` at all. docker-compose defaults to `forgeteam_redis_secret`, which works, but the `REDIS_URL` in `.env` is `redis://localhost:6379` (no password), while docker-compose constructs `redis://:forgeteam_redis_secret@redis:6379`. Local development without docker-compose will fail to authenticate to Redis. |
| `QDRANT_URL` in `.env` but not in docker-compose | **LOW** | `.env` defines `QDRANT_URL=http://localhost:6333` but no code references it. The Qdrant docker service exists in compose but the gateway code does not connect to Qdrant at all. |
| `JWT_SECRET` in `.env.example` but not in `.env` | **HIGH** | `.env.example` has `JWT_SECRET=CHANGE_ME_generate_a_random_64_char_string` but `.env` omits it entirely. The auth module falls back to a dev secret. |

---

## 2. CORS & Network Configuration

### 2.1 CORS Configuration

**Express HTTP CORS:** (`gateway/src/index.ts:198`)
```typescript
app.use(cors());
```
This is `cors()` with **no options**, meaning it defaults to `origin: *` (all origins allowed). In production, this should be restricted to the dashboard URL.

**Socket.IO CORS:** (`gateway/src/index.ts:1641`)
```typescript
cors: { origin: '*', methods: ['GET', 'POST'] }
```
Explicitly allows all origins. Same concern for production.

**Assessment:** Both HTTP and WebSocket CORS allow all origins. This is acceptable for development but must be locked down for production. The dashboard URL (port 3000) is not explicitly whitelisted.

### 2.2 Port Mapping Issues

| Service | Internal Port | docker-compose Host Port | Code Binds To | Match? |
|---|---|---|---|---|
| gateway | 18789 | `${PORT:-18789}:18789` | `GATEWAY_PORT` (default `18789`) | YES (by coincidence of defaults) |
| dashboard | 3000 | `${DASHBOARD_PORT:-3000}:3000` | Next.js `PORT=3000` | YES |
| postgres | 5432 | `127.0.0.1:5432:5432` | N/A (standard PG port) | YES |
| redis | 6379 | `127.0.0.1:6379:6379` | N/A (standard Redis port) | YES |
| qdrant | 6333/6334 | `6333:6333`, `6334:6334` | N/A | YES - but not bound to `127.0.0.1`, so **exposed to all interfaces** |
| minio | 9000/9001 | `127.0.0.1:9000:9000`, `127.0.0.1:9001:9001` | N/A | YES |

**Issue - PORT vs GATEWAY_PORT:** Docker-compose sets `PORT=18789` as an environment variable. The Dockerfile also sets `ENV PORT=18789`. But the gateway code reads `process.env.GATEWAY_PORT`, not `process.env.PORT`. The matching works only because the default fallback is `18789`.

**Issue - Qdrant ports not localhost-bound:** Qdrant ports `6333` and `6334` are exposed to all network interfaces (no `127.0.0.1:` prefix), unlike postgres, redis, and minio. This could expose the vector database to the network.

### 2.3 Service-to-Service Connectivity

| Source | Destination | Connection String | Works? |
|---|---|---|---|
| gateway -> postgres | `postgresql://forgeteam:forgeteam_secret@postgres:5432/forgeteam` | YES - Uses Docker service name `postgres`. `depends_on` with `service_healthy` ensures PG is ready. |
| gateway -> redis | `redis://:forgeteam_redis_secret@redis:6379` | YES - Uses Docker service name `redis`. `depends_on` with `service_healthy`. |
| gateway -> minio | `minio:9000` (endpoint) | YES - Uses Docker service name `minio`. However, no `depends_on` for minio is declared in gateway. If minio starts slowly, the first storage operation will fail. |
| gateway -> qdrant | **No connection configured** | N/A - The gateway code never connects to Qdrant. Qdrant is provisioned in docker-compose but unused. |
| dashboard -> gateway | `http://localhost:18789` (browser-side) | YES (from browser). The browser connects to the host-mapped gateway port. |
| dashboard -> gateway (SSR) | `http://localhost:18789` (env var) | **BROKEN in Docker** - During SSR, `NEXT_PUBLIC_GATEWAY_URL=http://localhost:18789` resolves to the dashboard container's localhost, not the gateway. Should be `http://gateway:18789` for SSR, but the code bypasses this by hardcoding `http://localhost:18789` for browser. SSR requests will fail. |

### 2.4 Authentication & Rate Limiting

- **JWT Auth:** Disabled in development mode (`NODE_ENV=development`). docker-compose explicitly sets `NODE_ENV=development` for the gateway.
- **Socket.IO Auth:** Middleware checks for token in `socket.handshake.auth.token` or `socket.handshake.query.token`, but only if `AUTH_ENABLED` is true (not in dev mode).
- **Rate Limiting:** No HTTP rate limiting middleware (e.g., `express-rate-limit`) is used. Only cost-based throttling exists for AI model usage (model downgrade when cost cap is reached).
- **Admin Token Endpoint:** `/api/auth/token` in non-dev mode checks `x-admin-secret` header against `process.env.ADMIN_SECRET`, which is never configured.

---

## 3. Dockerfile Audit

### 3.1 `docker/gateway.Dockerfile`

| Stage | Issue | Severity |
|---|---|---|
| deps | Copies `dashboard/package.json` into the deps stage, but the gateway image does not need dashboard dependencies. This bloats the build with unnecessary deps. | LOW |
| builder | `npx playwright install --with-deps chromium` runs in the builder stage but not in the runner stage. Playwright binaries are lost in the final image. | **HIGH** - QA agent browser testing will fail at runtime. The Playwright binary and system deps from the builder stage are not carried to the runner stage. |
| runner | `COPY agents/ ./agents/` and `COPY workflows/ ./workflows/` are done directly from context (not from deps/builder). This is correct since these are config files, not compiled output. | OK |
| runner | `ENV PORT=18789` is set but code reads `GATEWAY_PORT`, not `PORT`. | **MEDIUM** - Naming mismatch (masked by default). |
| runner | No `COPY` for `infrastructure/` directory. The init.sql is only used by the postgres volume mount, so this is correct. | OK |
| runner | `COPY --from=deps /app/node_modules ./node_modules` copies ALL workspace node_modules (including dashboard deps). | LOW - Bloated image. |

### 3.2 `docker/dashboard.Dockerfile`

| Stage | Issue | Severity |
|---|---|---|
| deps | `COPY dashboard/package.json ./` then `RUN npm install`. This is a standalone install, not using npm workspaces. Since the dashboard does not import `@forge-team/*` packages, this is actually correct. | OK |
| builder | `ARG NEXT_PUBLIC_GATEWAY_URL=http://localhost:3001` - Default is port **3001**, but the gateway runs on **18789**. | **HIGH** - If the build is run without overriding this ARG, the baked-in URL will point to port 3001, which is wrong. docker-compose runtime env passes `http://localhost:18789`, but for Next.js `NEXT_PUBLIC_*` vars, the build-time value takes precedence for static pages. |
| runner | `COPY --from=builder /app/.next/standalone ./` | OK - Next.js standalone output |
| runner | `COPY --from=builder /app/public ./public` | **LOW** - The `public/` directory only contains `.gitkeep` (empty). Not a problem, but the COPY will succeed with an effectively empty directory. |
| runner | `CMD ["node", "server.js"]` | OK - Next.js standalone server |

### 3.3 `.dockerignore`

```
**/node_modules
**/.next
.git
.env
.env.*
```

This correctly excludes node_modules, build output, git history, and env files from the Docker context. However, it also excludes `.env.example`, which is typically harmless to include.

---

## 4. Package.json & Dependencies Audit

### 4.1 Workspace Configuration

Root `package.json`:
```json
"workspaces": ["shared", "gateway", "dashboard", "memory", "viadp"]
```

This correctly declares all five workspace packages.

### 4.2 Cross-Package Reference Issues

| Import | From Package | Listed in `dependencies`? | Issue |
|---|---|---|---|
| `@forge-team/shared` | gateway | YES (`"*"`) | OK |
| `@forge-team/viadp` | gateway | YES (`"*"`) | OK |
| `@forge-team/memory` | gateway (index.ts, agent-runner.ts) | **NO** | **HIGH** - `gateway/package.json` does NOT list `@forge-team/memory` as a dependency, yet `index.ts:37` does `import { MemoryManager, GeminiFileSearch, VectorStore, Summarizer } from '@forge-team/memory'`. This works in the monorepo via npm workspaces hoisting, but is not explicitly declared. Could fail in isolated installs. |
| `@forge-team/shared` | memory (memory-manager.ts:13) | **NO** | **HIGH** - `memory/package.json` does NOT list `@forge-team/shared` as a dependency, yet `memory-manager.ts` imports `MemoryScope` from it. Same hoisting reliance. |
| `@forge-team/shared` | tests (load, e2e) | N/A (test files) | OK - tests run from root |

### 4.3 Dashboard Package Name Mismatch

The dashboard `package.json` has `"name": "forge-team-dashboard"` (not `@forge-team/dashboard`). This is inconsistent with other packages (`@forge-team/gateway`, `@forge-team/memory`, `@forge-team/viadp`). Not a functional issue since nothing imports from the dashboard package, but it is an inconsistency.

### 4.4 Gateway TypeScript Path Resolution

`gateway/tsconfig.json` uses TypeScript `paths` to resolve `@forge-team/*`:
```json
"paths": {
  "@forge-team/shared": ["../shared/types/index.ts"],
  "@forge-team/viadp": ["../viadp/src/index.ts"],
  "@forge-team/memory": ["../memory/src/index.ts"]
}
```

This works for TypeScript compilation (and for `tsx` runtime which respects tsconfig paths). However, if `tsc` compiled output were used (without path transformation), imports would fail. The current setup uses `tsx` at runtime, which handles this correctly.

### 4.5 Version Alignment

| Package | gateway | memory | Notes |
|---|---|---|---|
| `@google/generative-ai` | `^0.24.1` | `^0.21.0` | **MEDIUM** - Major version match but minor differs. Could cause type conflicts or API changes. |
| `ioredis` | `^5.4.2` | `^5.4.1` | OK - Compatible |
| `pg` | `^8.19.0` | `^8.13.1` | **LOW** - Same major, different minor. Compatible. |
| `uuid` | `^11.1.0` | `^10.0.0` | **MEDIUM** - Major version mismatch. UUID v11 may have breaking changes vs v10. |

### 4.6 Missing `@forge-team/shared` Dependency in memory

The `memory` package imports `MemoryScope` from `@forge-team/shared` but does not declare it in its `package.json` dependencies. This should be added:
```json
"dependencies": {
  "@forge-team/shared": "*",
  ...
}
```

---

## 5. Security Findings (Infrastructure-Specific)

| Finding | Severity | Details |
|---|---|---|
| **API keys in `.env.example`** | CRITICAL | `.env.example` contains real API keys for Anthropic, Google, ElevenLabs, and Whisper. This file is typically committed to version control. Anyone with repo access gets live API keys. |
| **API keys in `.env`** | HIGH | While `.gitignore` should exclude `.env`, both files contain identical real keys. |
| **No `JWT_SECRET` in production** | CRITICAL | Without `JWT_SECRET` in docker-compose, the auth system falls back to a hardcoded dev secret. All JWT tokens can be forged. |
| **No `ADMIN_SECRET` configured** | HIGH | The admin token endpoint checks against `process.env.ADMIN_SECRET` which is never set. In production mode, this comparison with `undefined` blocks all legitimate admin token creation. |
| **CORS allows all origins** | MEDIUM | Both Express and Socket.IO CORS allow `origin: *`. Should be restricted in production. |
| **Qdrant exposed to network** | MEDIUM | Qdrant ports not bound to `127.0.0.1` unlike other services. |
| **Docker socket mounted** | HIGH | Gateway container has `/var/run/docker.sock:/var/run/docker.sock` mounted for sandbox management. This gives the container root-level access to the Docker daemon. |

---

## 6. Consolidated Issue Tracker

| # | Category | Issue | Severity | Fix |
|---|---|---|---|---|
| 1 | Env Var | `PORT` vs `GATEWAY_PORT` mismatch | HIGH | Change docker-compose to pass `GATEWAY_PORT=18789` instead of `PORT=18789`, or change code to read `PORT` |
| 2 | Env Var | `JWT_SECRET` not passed to gateway | CRITICAL | Add `JWT_SECRET=${JWT_SECRET}` to docker-compose gateway environment |
| 3 | Env Var | `ADMIN_SECRET` not passed to gateway | HIGH | Add `ADMIN_SECRET=${ADMIN_SECRET}` to docker-compose and `.env.example` |
| 4 | Env Var | `WHATSAPP_PHONE_NUMBER_ID` not passed | MEDIUM | Add to docker-compose gateway environment |
| 5 | Env Var | `NEXT_PUBLIC_WS_URL` passed but never read | LOW | Remove from docker-compose dashboard environment |
| 6 | Env Var | `REDIS_PASSWORD` missing from `.env` | HIGH | Add `REDIS_PASSWORD=forgeteam_redis_secret` to `.env` |
| 7 | Security | Real API keys in `.env.example` | CRITICAL | Replace with placeholder values in `.env.example` |
| 8 | Docker | Dashboard Dockerfile `NEXT_PUBLIC_GATEWAY_URL` default is port `3001` | HIGH | Change ARG default to `http://localhost:18789` |
| 9 | Docker | Playwright installed in builder but not in runner stage | HIGH | Add Playwright install to runner stage or copy browser binaries |
| 10 | Docker | Gateway Dockerfile sets `ENV PORT` but code reads `GATEWAY_PORT` | MEDIUM | Align Dockerfile ENV name with code |
| 11 | Network | Qdrant ports exposed to all interfaces | MEDIUM | Bind to `127.0.0.1:6333:6333` and `127.0.0.1:6334:6334` |
| 12 | Network | No `depends_on` for minio in gateway | LOW | Add minio to gateway `depends_on` |
| 13 | Deps | `@forge-team/memory` not in gateway `package.json` | HIGH | Add `"@forge-team/memory": "*"` to gateway dependencies |
| 14 | Deps | `@forge-team/shared` not in memory `package.json` | HIGH | Add `"@forge-team/shared": "*"` to memory dependencies |
| 15 | Deps | `@google/generative-ai` version mismatch across gateway and memory | MEDIUM | Align to same version (`^0.24.1`) |
| 16 | CORS | All origins allowed in Express and Socket.IO | MEDIUM | Restrict to dashboard origin in production |
| 17 | Qdrant | Service in docker-compose but never used by any code | LOW | Either implement Qdrant connector or remove from docker-compose |
| 18 | SSR | Dashboard SSR requests fail in Docker (localhost resolves to self) | MEDIUM | SSR is bypassed by browser check in code; acceptable if no SSR needed |
| 19 | Docker | Gateway installs dashboard deps unnecessarily in deps stage | LOW | Only copy needed workspace package.json files |
| 20 | Deps | `uuid` major version mismatch (v11 in gateway vs v10 in memory/viadp) | MEDIUM | Align to same major version |

---

## 7. Recommended Priority Actions

### Immediate (Before any production deployment)

1. **Remove real API keys from `.env.example`** -- replace with `your-key-here` placeholders
2. **Add `JWT_SECRET` and `ADMIN_SECRET`** to docker-compose gateway environment section
3. **Fix `PORT` -> `GATEWAY_PORT`** naming in docker-compose and Dockerfile
4. **Fix dashboard Dockerfile** ARG default from `3001` to `18789`
5. **Fix Playwright in gateway Dockerfile** -- install in runner stage

### Short-term (Before team collaboration)

6. Add missing `@forge-team/memory` dependency to gateway `package.json`
7. Add missing `@forge-team/shared` dependency to memory `package.json`
8. Bind Qdrant ports to `127.0.0.1`
9. Add `minio` to gateway `depends_on`
10. Align `@google/generative-ai` and `uuid` versions across packages

### Pre-Production

11. Restrict CORS origins to dashboard URL only
12. Enable JWT authentication (do not default to dev mode)
13. Add HTTP rate limiting middleware to gateway
14. Evaluate Docker socket mount security implications
15. Remove unused docker-compose services (Qdrant) or implement their integration

---

*End of Infrastructure Audit Report*
