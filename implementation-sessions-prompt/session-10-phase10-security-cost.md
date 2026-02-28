# Session 10 — Phase 10: Security, Cost Controls & Key Rotation (Stream D, Day 8-10)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions. The goal is to fix critical security vulnerabilities, add authentication, implement cost controls with alerts, and harden the infrastructure.

---

## CONTEXT

The audit report found **CRITICAL** security issues that must be addressed urgently:

| Finding | Severity | Current State |
|---------|----------|---------------|
| **Real API keys in `.env.example` and `.env`** | CRITICAL | Both files contain live Anthropic, Google, ElevenLabs, OpenAI keys in plaintext |
| **No WebSocket authentication** | HIGH | `server.ts` trusts `type`/`agentId` query params with no token verification. Any client can impersonate any agent |
| **Postgres exposed on 0.0.0.0:5432** | HIGH | Default password `forgeteam_secret`. Accessible from outside Docker network |
| **Redis exposed on 0.0.0.0:6379** | HIGH | No password configured |
| **TypeScript errors suppressed in build** | MEDIUM | `gateway.Dockerfile:37`: `RUN npx tsc --noEmit \|\| true` silently ignores type errors |
| **No RBAC** | HIGH | Any WebSocket client can send any message type |
| **No per-agent cost caps** | MEDIUM | Cost tracked in-memory only, no thresholds, no alerts, wiped on restart |
| **No audit middleware on WS server** | MEDIUM | Non-delegation actions not logged |

Phase 10 overall is at **10% completion**. This session addresses all items.

**IMPORTANT**: WORKSTREAM 1 (key scrubbing) must be completed FIRST, before any other work begins. It is the most urgent security fix.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

**Security-critical files (URGENT — read first):**
- `/forge-team/.env.example` — CONTAINS REAL API KEYS that must be scrubbed
- `/forge-team/.env` — CONTAINS REAL API KEYS (gitignored but still a risk)
- `/forge-team/.gitignore` — verify `.env` is listed

**Gateway core:**
- `/forge-team/gateway/src/server.ts` — WebSocket server, connection handling (NO authentication currently)
- `/forge-team/gateway/src/index.ts` — entry point, Express routes, Socket.IO setup
- `/forge-team/gateway/src/model-router.ts` — model catalog, cost tracking (in-memory `costRecords[]`, no caps)
- `/forge-team/gateway/src/agent-runner.ts` — agent execution (records cost via model router)

**Infrastructure:**
- `/forge-team/docker/docker-compose.yml` — Postgres on 0.0.0.0:5432, Redis on 0.0.0.0:6379 with no password
- `/forge-team/docker/gateway.Dockerfile` — line 37: `RUN npx tsc --noEmit || true` suppresses TS errors
- `/forge-team/infrastructure/init.sql` — DB schema (has `cost_tracking` table, `model_configs` table)

**Shared types:**
- `/forge-team/shared/types/` — all shared TypeScript interfaces

**Configuration:**
- `/forge-team/gateway/package.json` — current dependencies
- `/forge-team/gateway/tsconfig.json` — TypeScript config

---

## WORKSTREAM 1: URGENT — Scrub API Keys and Secure Secrets

**Files to modify:**
- `/forge-team/.env.example`
- `/forge-team/.env`
- `/forge-team/.gitignore`

> **PRIORITY**: This workstream MUST be completed FIRST. Real API keys are committed in the repository.

### 1A. Scrub `.env.example`

Replace ALL real API keys in `/forge-team/.env.example` with placeholder strings. The file currently contains:

```
ANTHROPIC_API_KEY=sk-ant-api03-hpzATyyZhhUOg75i...  (REAL KEY)
GOOGLE_AI_API_KEY=AIzaSyDhZtX4JOcQoEQ81Yaw7k...    (REAL KEY)
ELEVENLABS_API_KEY=sk_d5d81d3be452a81443a99...       (REAL KEY)
WHISPER_API_KEY=sk-proj-t3LkjgaBn2UZwm...            (REAL KEY)
```

Replace with:

```env
# =============================================================================
# ForgeTeam Environment Configuration
# Copy this file to .env and fill in your values
# =============================================================================

# --- AI Provider Keys ---
ANTHROPIC_API_KEY=your-anthropic-api-key-here
GOOGLE_AI_API_KEY=your-google-ai-api-key-here

# --- Database ---
DATABASE_URL=postgresql://forgeteam:CHANGE_ME_IN_PRODUCTION@localhost:5432/forgeteam
POSTGRES_DB=forgeteam
POSTGRES_USER=forgeteam
POSTGRES_PASSWORD=CHANGE_ME_IN_PRODUCTION

# --- Redis ---
REDIS_URL=redis://:CHANGE_ME_IN_PRODUCTION@localhost:6379

# --- Server Ports ---
PORT=18789
GATEWAY_PORT=18789
DASHBOARD_PORT=3000

# --- Environment ---
NODE_ENV=development

# --- Optional: Voice & Speech ---
ELEVENLABS_API_KEY=your-elevenlabs-api-key-here
WHISPER_API_KEY=your-whisper-api-key-here

# --- Optional: Qdrant Vector DB ---
QDRANT_URL=http://localhost:6333

# --- Optional: External Integrations ---
GITHUB_TOKEN=your-github-personal-access-token
JIRA_API_TOKEN=your-jira-api-token
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your-email@example.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-key
VERCEL_TOKEN=your-vercel-token
WHATSAPP_API_TOKEN=your-whatsapp-api-token

# --- Authentication ---
JWT_SECRET=CHANGE_ME_generate_a_random_64_char_string
JWT_EXPIRY=24h
```

### 1B. Scrub `.env`

The `.env` file also contains real keys. Replace the API key values with placeholders, but KEEP the ports and database config as-is since those are local dev values:

```env
ANTHROPIC_API_KEY=your-anthropic-api-key-here
GOOGLE_AI_API_KEY=your-google-ai-api-key-here
ELEVENLABS_API_KEY=your-elevenlabs-api-key-here
WHISPER_API_KEY=your-whisper-api-key-here
```

Keep `PORT=18789`, `GATEWAY_PORT=18789`, database credentials, and other non-secret values unchanged.

### 1C. Verify `.gitignore`

Confirm that `/forge-team/.gitignore` includes `.env`. It currently does (line 3). If for any reason it does not, add it.

### 1D. Add `.env.local` to `.gitignore`

If `.env.local` is not in `.gitignore`, add it. This prevents any dashboard local env files from being committed.

---

## WORKSTREAM 2: WebSocket JWT Authentication

**Files to create:**
- `/forge-team/gateway/src/auth.ts`

**Files to modify:**
- `/forge-team/gateway/package.json`
- `/forge-team/gateway/src/server.ts`
- `/forge-team/gateway/src/index.ts`

### 2A. Install JWT dependency

Add to `/forge-team/gateway/package.json` dependencies:

```json
{
  "jsonwebtoken": "^9.0.2"
}
```

Add to devDependencies:

```json
{
  "@types/jsonwebtoken": "^9.0.7"
}
```

### 2B. Create auth module (`gateway/src/auth.ts`)

Create an authentication module with:

```typescript
// Key exports:
// - generateToken(payload: TokenPayload): string
// - verifyToken(token: string): TokenPayload | null
// - AuthRole: 'admin' | 'agent' | 'dashboard-viewer'
// - TokenPayload: { sub: string, role: AuthRole, agentId?: string, iat: number, exp: number }
```

**`generateToken(payload)`**: Create a JWT signed with `process.env.JWT_SECRET` (default: a hardcoded dev-only secret with a console warning). Expiry from `process.env.JWT_EXPIRY` (default: `'24h'`).

**`verifyToken(token)`**: Verify and decode the JWT. Return null on failure (expired, invalid signature, malformed). Do NOT throw.

**`generateAdminToken()`**: Convenience function to generate a token with `role: 'admin'`. Used for initial setup and testing.

**`generateAgentToken(agentId)`**: Generate a token with `role: 'agent'` and the agent ID embedded.

**`generateDashboardToken()`**: Generate a token with `role: 'dashboard-viewer'`.

### 2C. Add JWT authentication to WebSocket connections

Modify `/forge-team/gateway/src/server.ts`:

1. Import the auth module
2. In `handleConnection()`, extract the JWT token from:
   - Query parameter: `?token=xxx`
   - OR the first message after connection (type `auth.token` with `payload.token`)
3. **Authentication flow**:
   a. On new connection, if `?token=` query param is present, verify immediately
   b. If no token in query params, set a 10-second authentication deadline. If no `auth.token` message arrives within 10 seconds, disconnect with code 4001 and message "Authentication required"
   c. On successful auth, send `{ type: 'auth.success', payload: { role, agentId } }`
   d. On failed auth, send `{ type: 'auth.failed', payload: { error: 'Invalid or expired token' } }` and disconnect with code 4003
4. **After authentication**, validate that the `clientType` matches the token's role:
   - `role: 'agent'` can only connect as `type=agent` with matching agentId
   - `role: 'dashboard-viewer'` can only connect as `type=dashboard`
   - `role: 'admin'` can connect as any type
5. **Message validation**: Before processing any message in `handleMessage()`, check that the client has been authenticated (has a valid `tokenPayload` stored on the `ConnectedClient` object)

Add an `authenticated: boolean` and `tokenPayload: TokenPayload | null` field to the `ConnectedClient` interface.

### 2D. Add development bypass

To avoid breaking existing development workflows, add a development mode bypass:

```typescript
const AUTH_ENABLED = process.env.NODE_ENV !== 'development' || process.env.FORCE_AUTH === 'true';
```

When `AUTH_ENABLED` is false, skip token verification but log a warning: `"[GatewayServer] WARNING: Authentication disabled in development mode. Set FORCE_AUTH=true to enable."` This warning should print once on server startup, not per-connection.

### 2E. Add auth REST endpoints

In `/forge-team/gateway/src/index.ts`, add:

```typescript
// POST /api/auth/token — generate a JWT (admin only in production, open in dev)
app.post('/api/auth/token', express.json(), (req, res) => {
  const { role, agentId } = req.body;
  // In development mode, allow generating tokens freely
  // In production, require an admin secret header
  if (process.env.NODE_ENV !== 'development') {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  const token = generateToken({ sub: agentId ?? role, role, agentId });
  res.json({ token, expiresIn: process.env.JWT_EXPIRY ?? '24h' });
});

// GET /api/auth/verify — verify a token
app.get('/api/auth/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  res.json({ valid: true, payload });
});
```

### 2F. Update Socket.IO authentication

In `/forge-team/gateway/src/index.ts`, where the Socket.IO server is set up, add middleware to validate JWT on Socket.IO connections:

```typescript
io.use((socket, next) => {
  if (!AUTH_ENABLED) return next();
  const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication required'));
  const payload = verifyToken(token as string);
  if (!payload) return next(new Error('Invalid token'));
  (socket as any).tokenPayload = payload;
  next();
});
```

---

## WORKSTREAM 3: Lock Down Infrastructure

**Files to modify:**
- `/forge-team/docker/docker-compose.yml`
- `/forge-team/docker/gateway.Dockerfile`

### 3A. Bind Postgres to localhost only

In `/forge-team/docker/docker-compose.yml`, change the postgres service ports:

From:
```yaml
ports:
  - "5432:5432"
```

To:
```yaml
ports:
  - "127.0.0.1:5432:5432"
```

### 3B. Add Redis password and bind to localhost

In `/forge-team/docker/docker-compose.yml`, update the redis service:

Change command from:
```yaml
command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
```

To:
```yaml
command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru --requirepass ${REDIS_PASSWORD:-forgeteam_redis_secret}
```

Change ports from:
```yaml
ports:
  - "6379:6379"
```

To:
```yaml
ports:
  - "127.0.0.1:6379:6379"
```

Update the gateway environment to include the Redis password:
```yaml
- REDIS_URL=redis://:${REDIS_PASSWORD:-forgeteam_redis_secret}@redis:6379
```

Update the redis healthcheck to include auth:
```yaml
test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-forgeteam_redis_secret}", "ping"]
```

### 3C. Generate strong Postgres password

Add to `/forge-team/.env.example`:
```env
POSTGRES_PASSWORD=CHANGE_ME_IN_PRODUCTION
REDIS_PASSWORD=CHANGE_ME_IN_PRODUCTION
```

### 3D. Fix Dockerfile TypeScript error suppression

In `/forge-team/docker/gateway.Dockerfile`, change line 37 from:

```dockerfile
RUN npx tsc --noEmit || true
```

To:

```dockerfile
RUN npx tsc --noEmit
```

This will cause the Docker build to fail if there are TypeScript errors, which is the correct behavior. If there are pre-existing TS errors that block the build, fix them — do NOT re-add `|| true`.

### 3E. Fix any TypeScript errors that surface

After removing `|| true`, run `npx tsc --noEmit` from `/forge-team/gateway/`. If any errors appear, fix them. Common issues to look for:
- Missing type imports
- Implicit `any` types
- Unused variables
- Type mismatches between shared types and gateway code

Fix the actual errors rather than suppressing them. If a fix requires changes to shared types, make those changes in `/forge-team/shared/types/`.

---

## WORKSTREAM 4: Implement RBAC (Role-Based Access Control)

**Files to create:**
- `/forge-team/gateway/src/rbac.ts`

**Files to modify:**
- `/forge-team/gateway/src/server.ts`

### 4A. Define RBAC roles and permissions (`gateway/src/rbac.ts`)

Create an RBAC module that defines what each role can do:

```typescript
// Three roles:
// 1. 'admin' — full access to everything
// 2. 'agent' — can send/receive messages, update own status, execute tools (if whitelisted)
// 3. 'dashboard-viewer' — read-only access: can subscribe to events, list agents/tasks/sessions, but CANNOT send messages, create/modify tasks, or execute tools

type Permission =
  | 'session.create' | 'session.join' | 'session.leave' | 'session.list' | 'session.destroy'
  | 'chat.message'
  | 'agent.status' | 'agent.list' | 'agent.send'
  | 'task.create' | 'task.update' | 'task.move' | 'task.assign' | 'task.list'
  | 'kanban.board'
  | 'delegation.request' | 'delegation.accept' | 'delegation.reject'
  | 'model.route' | 'model.assignments' | 'model.costs'
  | 'voice.status'
  | 'tool.list' | 'tool.execute'
  | 'ping';

const ROLE_PERMISSIONS: Record<AuthRole, Permission[]> = {
  admin: ['*'],  // all permissions
  agent: [
    'session.join', 'session.leave', 'session.list',
    'chat.message',
    'agent.status', 'agent.list', 'agent.send',
    'task.update', 'task.list',
    'kanban.board',
    'delegation.request', 'delegation.accept', 'delegation.reject',
    'model.route', 'model.assignments',
    'tool.list', 'tool.execute',
    'ping',
  ],
  'dashboard-viewer': [
    'session.list',
    'agent.list',
    'task.list',
    'kanban.board',
    'model.assignments', 'model.costs',
    'voice.status',
    'tool.list',
    'ping',
  ],
};
```

Export a `hasPermission(role: AuthRole, messageType: string): boolean` function that checks whether the role has the required permission. Map WS message types (e.g., `'chat.message'`, `'task.create'`) to permissions.

### 4B. Enforce RBAC in server.ts

In `/forge-team/gateway/src/server.ts`, at the TOP of `handleMessage()`, after parsing the message:

1. Get the client's role from `client.tokenPayload?.role`
2. Call `hasPermission(role, parsed.type)`
3. If denied, send an error response:
   ```json
   { "type": "system.error", "payload": { "error": { "code": "FORBIDDEN", "message": "Insufficient permissions for message type: chat.message" } } }
   ```
4. Return early without processing the message

### 4C. Agent scope enforcement

Agents should only be able to update their OWN status and execute tools they are whitelisted for:

1. In `handleAgentStatus()`: verify `client.agentId` matches the connected agent
2. In `handleAgentSend()`: verify the `from` field matches the connected agent's ID
3. In tool execution: verify the requesting agent is whitelisted for the tool (already handled by `ToolRegistry`, but add a server-level check too)

---

## WORKSTREAM 5: Per-Agent Cost Caps with Alerts

**Files to modify:**
- `/forge-team/gateway/src/model-router.ts`
- `/forge-team/gateway/src/index.ts`
- `/forge-team/gateway/src/server.ts`
- `/forge-team/infrastructure/init.sql`

### 5A. Add cost cap columns to database schema

In `/forge-team/infrastructure/init.sql`, add columns to the `model_configs` table:

```sql
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS daily_cap_usd DOUBLE PRECISION DEFAULT 50.0;
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS weekly_cap_usd DOUBLE PRECISION DEFAULT 200.0;
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS alert_threshold DOUBLE PRECISION DEFAULT 0.8;
```

Since we use `CREATE TABLE IF NOT EXISTS` and this is an init script, instead add the columns directly to the existing `CREATE TABLE model_configs` statement:

```sql
daily_cap_usd   DOUBLE PRECISION NOT NULL DEFAULT 50.0,
weekly_cap_usd  DOUBLE PRECISION NOT NULL DEFAULT 200.0,
alert_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.8
                CHECK (alert_threshold >= 0.0 AND alert_threshold <= 1.0),
```

Also update the seed data to include realistic caps per agent:

| Agent | Daily Cap | Weekly Cap |
|-------|-----------|------------|
| bmad-master | $30 | $150 |
| product-owner | $20 | $100 |
| business-analyst | $20 | $100 |
| scrum-master | $5 | $25 |
| architect | $50 | $250 |
| ux-designer | $15 | $75 |
| frontend-dev | $30 | $150 |
| backend-dev | $50 | $250 |
| qa-architect | $40 | $200 |
| devops-engineer | $20 | $100 |
| security-specialist | $40 | $200 |
| tech-writer | $15 | $75 |

### 5B. Add cost cap tracking to ModelRouter

In `/forge-team/gateway/src/model-router.ts`:

1. Add a `CostCap` interface:
   ```typescript
   interface CostCap {
     dailyCapUsd: number;
     weeklyCapUsd: number;
     alertThreshold: number; // 0.0 - 1.0 (e.g., 0.8 = alert at 80%)
   }
   ```

2. Add a `costCaps` map: `private costCaps: Map<AgentId, CostCap> = new Map()`

3. Add `setCostCap(agentId, cap)` and `getCostCap(agentId)` methods

4. Initialize default caps for all agents in the constructor

5. Add `getAgentDailyCost(agentId)` — sum cost records for today (since midnight UTC)

6. Add `getAgentWeeklyCost(agentId)` — sum cost records for the current week (since Monday midnight UTC)

7. Add `checkCostCap(agentId)` — return `{ allowed: boolean, dailyUsed: number, dailyCap: number, weeklyUsed: number, weeklyCap: number, alertTriggered: boolean }`

### 5C. Enforce cost caps before routing

In `ModelRouter.route()`, BEFORE selecting a model:

1. Call `checkCostCap(request.agentId)`
2. If daily or weekly cap exceeded:
   a. Try to auto-downgrade: if the agent's primary model is premium tier, select the cheapest available model instead
   b. If even the cheapest model would exceed the cap, return a special result with `reason: 'cost-cap-exceeded'` and a message explaining the cap
3. If alert threshold crossed (e.g., 80% of daily cap used):
   a. Set a flag `alertTriggered: true` on the routing result so the caller can emit an alert

### 5D. Persist cost records to database

Currently, `ModelRouter.costRecords` is an in-memory array wiped on restart. Add database persistence:

1. In `recordCost()`, after pushing to the in-memory array, also insert into the `cost_tracking` table. Use a fire-and-forget database call (don't await, don't block the response). For now, use a simple `fetch()` to a new internal REST endpoint, or directly use a postgres client if one is available.

2. On startup, load recent cost records (today + this week) from the database into the in-memory array so caps are enforced correctly across restarts.

> **Note**: The gateway does not currently have a Postgres client. For this phase, add `pg` to dependencies and create a minimal database connection utility. Alternatively, if a database client exists from a previous session, use that.

Add to `/forge-team/gateway/package.json`:
```json
{
  "pg": "^8.13.1"
}
```

And to devDependencies:
```json
{
  "@types/pg": "^8.11.11"
}
```

Create a minimal `/forge-team/gateway/src/db.ts`:
```typescript
// Database connection utility
// Reads DATABASE_URL from environment
// Exports a query function and a pool for cleanup
```

### 5E. Emit real-time cost alerts via WebSocket

In `/forge-team/gateway/src/index.ts` or `server.ts`:

After every `agentRunner.processUserMessage()` call that returns a result, check the cost cap status. If an alert threshold is crossed:

1. Broadcast to all dashboard connections:
   ```json
   {
     "type": "cost.alert",
     "payload": {
       "agentId": "backend-dev",
       "alertType": "threshold",
       "message": "Backend Developer has used 82% of daily budget ($41.00 / $50.00)",
       "dailyUsed": 41.00,
       "dailyCap": 50.00,
       "weeklyUsed": 120.00,
       "weeklyCap": 250.00
     }
   }
   ```

2. If the cap is fully exceeded, broadcast:
   ```json
   {
     "type": "cost.cap_exceeded",
     "payload": {
       "agentId": "backend-dev",
       "capType": "daily",
       "message": "Backend Developer daily budget exceeded ($50.12 / $50.00). Auto-downgrading to cheapest model.",
       "action": "downgrade"
     }
   }
   ```

### 5F. Add cost management REST endpoints

In `/forge-team/gateway/src/index.ts`:

```typescript
// GET /api/costs/summary — overall cost summary
app.get('/api/costs/summary', (_req, res) => { ... });

// GET /api/costs/agent/:agentId — per-agent cost details
app.get('/api/costs/agent/:agentId', (req, res) => { ... });

// PUT /api/costs/caps/:agentId — update cost caps for an agent (admin only)
app.put('/api/costs/caps/:agentId', express.json(), (req, res) => { ... });

// GET /api/costs/caps — list all agent cost caps
app.get('/api/costs/caps', (_req, res) => { ... });
```

---

## WORKSTREAM 6: Audit Middleware and Hash-Chain Integrity

**Files to create:**
- `/forge-team/gateway/src/audit-middleware.ts`

**Files to modify:**
- `/forge-team/gateway/src/server.ts`
- `/forge-team/gateway/src/index.ts`

### 6A. Create audit middleware (`gateway/src/audit-middleware.ts`)

Create a WebSocket audit middleware that logs EVERY message to the audit trail, not just VIADP events:

```typescript
class AuditMiddleware {
  private entries: AuditEntry[] = [];
  private lastHash: string = '0000000000000000';
  private sequenceNumber: number = 0;

  // Log every WS message
  logMessage(clientId: string, clientType: string, message: WSMessage, direction: 'inbound' | 'outbound'): void;

  // Get audit entries (with optional filters)
  getEntries(filters?: { from?: string; to?: string; type?: string; clientId?: string }): AuditEntry[];

  // Verify hash-chain integrity
  verifyIntegrity(): { valid: boolean; brokenAt?: number; totalEntries: number };
}
```

Each audit entry must include:
- `id`: UUID
- `sequenceNumber`: monotonically increasing
- `hash`: SHA-256 hash of `JSON.stringify({ sequenceNumber, timestamp, clientId, messageType, direction, previousHash })`
- `previousHash`: the hash of the previous entry (forms the chain)
- `timestamp`: ISO 8601
- `clientId`: who sent/received
- `clientType`: 'user' | 'agent' | 'dashboard'
- `messageType`: the WS message type
- `direction`: 'inbound' (received from client) or 'outbound' (sent to client)
- `sessionId`: if present
- `agentId`: if present

Use Node.js `crypto.createHash('sha256')` for hashing. Do NOT use the trivial FNV-1a hash from the existing VIADP audit log — use proper SHA-256.

### 6B. Wire audit middleware into server.ts

In `/forge-team/gateway/src/server.ts`:

1. Accept `auditMiddleware` in the constructor deps
2. In `handleMessage()`, at the very TOP (before any processing), call `auditMiddleware.logMessage(clientId, client.type, parsed, 'inbound')`
3. In `sendToClient()`, call `auditMiddleware.logMessage(clientId, client?.type, message, 'outbound')`
4. This ensures every single message in and out is recorded

### 6C. Add audit REST endpoints

In `/forge-team/gateway/src/index.ts`:

```typescript
// GET /api/audit — list audit entries (with pagination and filters)
app.get('/api/audit', (req, res) => {
  const { from, to, type, clientId, limit, offset } = req.query;
  const entries = auditMiddleware.getEntries({ from, to, type, clientId });
  const paginated = entries.slice(Number(offset ?? 0), Number(offset ?? 0) + Number(limit ?? 100));
  res.json({ entries: paginated, total: entries.length });
});

// GET /api/audit/verify — verify hash-chain integrity
app.get('/api/audit/verify', (_req, res) => {
  const result = auditMiddleware.verifyIntegrity();
  res.json(result);
});
```

### 6D. Persist audit entries to database

Similar to cost tracking, persist audit entries to the `viadp_audit_log` table (or create a new `general_audit_log` table if the existing one is too VIADP-specific).

Create a new table in `init.sql`:

```sql
CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    sequence_number INTEGER NOT NULL,
    hash            TEXT NOT NULL,
    previous_hash   TEXT NOT NULL,
    client_id       TEXT NOT NULL,
    client_type     TEXT NOT NULL,
    message_type    TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    session_id      TEXT DEFAULT '',
    agent_id        TEXT DEFAULT '',
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_audit_seq ON audit_log (sequence_number);
CREATE INDEX IF NOT EXISTS idx_general_audit_type ON audit_log (message_type);
CREATE INDEX IF NOT EXISTS idx_general_audit_client ON audit_log (client_id);
CREATE INDEX IF NOT EXISTS idx_general_audit_timestamp ON audit_log (timestamp DESC);
```

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **key-scrubber** — Handles WORKSTREAM 1 (URGENT key scrubbing). Must complete FIRST.
2. **auth-builder** — Handles WORKSTREAM 2 (JWT auth module, WS authentication, auth endpoints). Can start after WORKSTREAM 1.
3. **infra-hardener** — Handles WORKSTREAM 3 (Postgres/Redis lockdown, Dockerfile fix, TS error fixes). Can run in parallel with WORKSTREAM 2.
4. **rbac-builder** — Handles WORKSTREAM 4 (RBAC module, permission enforcement). Depends on WORKSTREAM 2 (needs auth types).
5. **cost-builder** — Handles WORKSTREAM 5 (cost caps, DB persistence, alerts, REST endpoints). Can run in parallel.
6. **audit-builder** — Handles WORKSTREAM 6 (audit middleware, hash-chain, REST endpoints). Can run in parallel.

**Dependency order**: WORKSTREAM 1 first (URGENT). Then WORKSTREAMS 2, 3, 5, 6 in parallel. WORKSTREAM 4 after WORKSTREAM 2 completes.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

**Security (CRITICAL):**
- [ ] `/forge-team/.env.example` contains ZERO real API keys — only placeholder strings
- [ ] `/forge-team/.env` contains ZERO real API keys — only placeholder strings
- [ ] `.env` and `.env.local` are in `.gitignore`
- [ ] `grep -r "sk-ant-api03" /forge-team/` returns zero results
- [ ] `grep -r "AIzaSy" /forge-team/ --include="*.md" --include="*.ts" --include="*.json" --include="*.env*" --include="*.yml"` returns zero results (except this prompt file)
- [ ] `grep -r "sk_d5d81d3" /forge-team/` returns zero results
- [ ] `grep -r "sk-proj-" /forge-team/` returns zero results

**Authentication:**
- [ ] `jsonwebtoken` is in gateway `package.json` dependencies
- [ ] `/forge-team/gateway/src/auth.ts` exists with `generateToken()`, `verifyToken()`, role types
- [ ] WebSocket connections require JWT token (query param or first message)
- [ ] Unauthenticated connections are disconnected after 10 seconds in production mode
- [ ] Development mode bypass works when `NODE_ENV=development` and `FORCE_AUTH` is not set
- [ ] Auth REST endpoints respond: `POST /api/auth/token`, `GET /api/auth/verify`
- [ ] Socket.IO middleware validates JWT

**Infrastructure:**
- [ ] Postgres port bound to `127.0.0.1:5432` in `docker-compose.yml`
- [ ] Redis port bound to `127.0.0.1:6379` in `docker-compose.yml`
- [ ] Redis requires password via `--requirepass`
- [ ] `gateway.Dockerfile` line 37 is `RUN npx tsc --noEmit` (NO `|| true`)
- [ ] `npx tsc --noEmit` in `/forge-team/gateway/` succeeds with zero errors

**RBAC:**
- [ ] `/forge-team/gateway/src/rbac.ts` exists with role definitions and `hasPermission()`
- [ ] `dashboard-viewer` role CANNOT send `chat.message`, `task.create`, `task.update`, `tool.execute`
- [ ] `agent` role CANNOT `session.create` or `session.destroy`
- [ ] `admin` role has access to everything
- [ ] RBAC check runs in `handleMessage()` before any processing

**Cost Controls:**
- [ ] `model_configs` table has `daily_cap_usd`, `weekly_cap_usd`, `alert_threshold` columns
- [ ] `ModelRouter.route()` checks cost caps before selecting a model
- [ ] When cap exceeded, model auto-downgrades to cheapest available
- [ ] When alert threshold crossed, `cost.alert` WS event is broadcast to dashboards
- [ ] `pg` is in gateway dependencies for database persistence
- [ ] `/forge-team/gateway/src/db.ts` exists with database connection utility
- [ ] Cost records are persisted to `cost_tracking` table
- [ ] Cost caps REST endpoints respond: `GET /api/costs/summary`, `GET /api/costs/agent/:agentId`, `PUT /api/costs/caps/:agentId`, `GET /api/costs/caps`

**Audit:**
- [ ] `/forge-team/gateway/src/audit-middleware.ts` exists
- [ ] Every inbound and outbound WS message is logged with hash-chain integrity
- [ ] Hash uses SHA-256 (not FNV-1a or polynomial)
- [ ] `verifyIntegrity()` re-computes all hashes and verifies the chain
- [ ] Audit REST endpoints respond: `GET /api/audit`, `GET /api/audit/verify`
- [ ] `audit_log` table exists in `init.sql`

**General:**
- [ ] All existing gateway functionality is preserved — no existing switch cases, routes, or handlers were removed
- [ ] No new npm packages were added beyond `jsonwebtoken`, `@types/jsonwebtoken`, `pg`, `@types/pg`
