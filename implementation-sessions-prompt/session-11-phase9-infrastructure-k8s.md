# Session 11 — Phase 9: Infrastructure — Kubernetes, Object Storage, Data Sovereignty (Day 10-12)

> **Instructions for Claude Code Opus 4.6**: Read this entire prompt before taking any action. You must complete ALL tasks listed below in the ForgeTeam project at `/Users/bandar/Documents/AreebPro/forge-team/`. Use the **team/swarm feature** — create a team and spin up parallel agents to work on independent workstreams simultaneously. Each workstream is labeled. Do NOT skip any item. Do NOT introduce new features beyond what is listed. Do NOT add comments, docstrings, or type annotations to code you did not change. Preserve the existing TypeScript style and project conventions.

---

## CONTEXT

The ForgeTeam audit report (AUDIT-REPORT.md) identified critical infrastructure gaps:

- **No Kubernetes manifests** — only Docker Compose exists for local dev. Zero production deployment path.
- **No object storage** — `tasks.artifacts` JSONB column stores references but no storage backend (S3/MinIO).
- **No VPC config or data residency enforcement** — deployment is local-only with no region-locking or network egress controls.
- **Immutable VIADP ledger not enforced at DB level** — `viadp_audit_log` table has hash chain columns but no INSERT-only policy, no UPDATE/DELETE restrictions.
- **Node.js 20** — Dockerfiles and package.json specify Node 20, but the project requires Node 22+.

This session creates production-ready Kubernetes manifests, adds MinIO object storage, enforces DB-level audit log immutability, adds data sovereignty configuration, and upgrades to Node.js 22.

---

## PRE-WORK: Read These Files First (Before Any Edits)

Every agent on the team must read the files relevant to their workstream before editing. The ground-truth references are:

**Infrastructure (all must read):**
- `/forge-team/docker/docker-compose.yml` — current Docker Compose (5 services: gateway, dashboard, postgres, redis, qdrant)
- `/forge-team/docker/gateway.Dockerfile` — gateway Docker build (currently `node:20-alpine`, EXPOSE 3001)
- `/forge-team/docker/dashboard.Dockerfile` — dashboard Docker build (currently `node:20-alpine`)
- `/forge-team/infrastructure/init.sql` — Postgres schema (13 tables, pgvector, seed data)
- `/forge-team/package.json` — root monorepo config (`"engines": { "node": ">=20.0.0" }`)

**Gateway (for storage integration):**
- `/forge-team/gateway/src/index.ts` — gateway entry point, Express + WS server, REST routes
- `/forge-team/gateway/src/task-manager.ts` — Kanban task CRUD, `artifacts` field on tasks
- `/forge-team/gateway/package.json` — gateway dependencies

**Shared types:**
- `/forge-team/shared/types/task.ts` — Task interface with `artifacts: string[]`
- `/forge-team/shared/types/index.ts` — shared type exports

**VIADP audit (for immutability enforcement):**
- `/forge-team/viadp/src/audit-log.ts` — audit log with FNV-1a hash chain, Object.freeze

**Docker Compose current services:**
- `gateway` — port ${PORT:-3001}:3001, depends on postgres + redis
- `dashboard` — port ${DASHBOARD_PORT:-3000}:3000, depends on gateway
- `postgres` — pgvector/pgvector:pg16, port 5432
- `redis` — redis:7-alpine, port 6379
- `qdrant` — qdrant/qdrant:latest, ports 6333/6334

---

## WORKSTREAM 1: Create Production Kubernetes Manifests

**Files to create:**
- `/forge-team/infrastructure/k8s/namespace.yaml`
- `/forge-team/infrastructure/k8s/configmap.yaml`
- `/forge-team/infrastructure/k8s/secrets.yaml`
- `/forge-team/infrastructure/k8s/postgres-statefulset.yaml`
- `/forge-team/infrastructure/k8s/redis-statefulset.yaml`
- `/forge-team/infrastructure/k8s/gateway-deployment.yaml`
- `/forge-team/infrastructure/k8s/dashboard-deployment.yaml`
- `/forge-team/infrastructure/k8s/minio-statefulset.yaml`
- `/forge-team/infrastructure/k8s/services.yaml`
- `/forge-team/infrastructure/k8s/hpa.yaml`
- `/forge-team/infrastructure/k8s/pvc.yaml`
- `/forge-team/infrastructure/k8s/network-policies.yaml`
- `/forge-team/infrastructure/k8s/ingress.yaml`

### 1A. Create namespace definition (`namespace.yaml`)

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: forgeteam
  labels:
    app.kubernetes.io/name: forgeteam
    app.kubernetes.io/part-of: forgeteam
    environment: production
```

### 1B. Create ConfigMap (`configmap.yaml`)

Define all non-secret environment variables:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: forgeteam-config
  namespace: forgeteam
data:
  NODE_ENV: "production"
  GATEWAY_PORT: "18789"
  GATEWAY_HOST: "0.0.0.0"
  DATABASE_URL: "postgresql://forgeteam:$(POSTGRES_PASSWORD)@postgres:5432/forgeteam"
  REDIS_URL: "redis://redis:6379"
  MINIO_ENDPOINT: "minio:9000"
  MINIO_BUCKET: "forgeteam-artifacts"
  MINIO_USE_SSL: "false"
  DEPLOYMENT_REGION: "riyadh"
  DASHBOARD_PORT: "3000"
  NEXT_PUBLIC_GATEWAY_URL: "http://gateway:18789"
```

### 1C. Create Secrets template (`secrets.yaml`)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: forgeteam-secrets
  namespace: forgeteam
type: Opaque
stringData:
  ANTHROPIC_API_KEY: "REPLACE_ME"
  GOOGLE_AI_API_KEY: "REPLACE_ME"
  ELEVENLABS_API_KEY: "REPLACE_ME"
  WHISPER_API_KEY: "REPLACE_ME"
  POSTGRES_USER: "forgeteam"
  POSTGRES_PASSWORD: "CHANGE_ME_IN_PRODUCTION"
  POSTGRES_DB: "forgeteam"
  MINIO_ACCESS_KEY: "forgeteam-admin"
  MINIO_SECRET_KEY: "CHANGE_ME_IN_PRODUCTION"
```

### 1D. Create Postgres StatefulSet (`postgres-statefulset.yaml`)

StatefulSet with 1 replica using `pgvector/pgvector:pg16`:

- Mount PVC for `/var/lib/postgresql/data` (10Gi)
- Mount init.sql as ConfigMap volume at `/docker-entrypoint-initdb.d/01-init.sql`
- Environment from `forgeteam-secrets` (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)
- Liveness probe: `pg_isready -U forgeteam -d forgeteam`
- Readiness probe: same command
- Resource requests: 256Mi memory, 250m CPU
- Resource limits: 1Gi memory, 1000m CPU

### 1E. Create Redis StatefulSet (`redis-statefulset.yaml`)

StatefulSet with 1 replica using `redis:7-alpine`:

- Command: `redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru`
- Mount PVC for `/data` (5Gi)
- Liveness probe: `redis-cli ping`
- Readiness probe: same command
- Resource requests: 128Mi memory, 100m CPU
- Resource limits: 512Mi memory, 500m CPU

### 1F. Create Gateway Deployment (`gateway-deployment.yaml`)

Deployment with 2 replicas:

- Image: `forgeteam/gateway:latest` (built from `docker/gateway.Dockerfile`)
- Environment from ConfigMap + Secrets
- Port: 18789 (containerPort)
- Liveness probe: HTTP GET `/health` port 18789, initialDelaySeconds 30
- Readiness probe: HTTP GET `/health` port 18789, initialDelaySeconds 10
- Resource requests: 256Mi memory, 250m CPU
- Resource limits: 1Gi memory, 1000m CPU
- `topologySpreadConstraints` for spreading across nodes

### 1G. Create Dashboard Deployment (`dashboard-deployment.yaml`)

Deployment with 2 replicas:

- Image: `forgeteam/dashboard:latest` (built from `docker/dashboard.Dockerfile`)
- Port: 3000 (containerPort)
- Environment: `NODE_ENV=production`, `NEXT_PUBLIC_GATEWAY_URL` from ConfigMap
- Liveness probe: HTTP GET `/` port 3000
- Readiness probe: HTTP GET `/` port 3000
- Resource requests: 128Mi memory, 100m CPU
- Resource limits: 512Mi memory, 500m CPU

### 1H. Create MinIO StatefulSet (`minio-statefulset.yaml`)

StatefulSet with 1 replica using `minio/minio:latest`:

- Command: `server /data --console-address ":9001"`
- Mount PVC for `/data` (20Gi)
- Environment from Secrets (MINIO_ROOT_USER=MINIO_ACCESS_KEY, MINIO_ROOT_PASSWORD=MINIO_SECRET_KEY)
- Liveness probe: HTTP GET `/minio/health/live` port 9000
- Readiness probe: HTTP GET `/minio/health/ready` port 9000
- Ports: 9000 (API), 9001 (console)
- Resource requests: 256Mi memory, 250m CPU
- Resource limits: 1Gi memory, 500m CPU

### 1I. Create Services (`services.yaml`)

Define all services in a single file:

```yaml
# ClusterIP services (internal):
# - postgres: port 5432
# - redis: port 6379
# - minio: port 9000, 9001

# LoadBalancer services (external):
# - gateway: port 18789 -> targetPort 18789
# - dashboard: port 80 -> targetPort 3000
```

All services must have:
- Namespace: `forgeteam`
- Appropriate `app` selectors matching their Deployment/StatefulSet labels
- `app.kubernetes.io/name` and `app.kubernetes.io/component` labels

### 1J. Create HPA (`hpa.yaml`)

HorizontalPodAutoscaler for the gateway:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: gateway-hpa
  namespace: forgeteam
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: gateway
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### 1K. Create PersistentVolumeClaims (`pvc.yaml`)

Three PVCs:

- `postgres-data` — 10Gi, ReadWriteOnce, storageClassName: standard
- `redis-data` — 5Gi, ReadWriteOnce, storageClassName: standard
- `minio-data` — 20Gi, ReadWriteOnce, storageClassName: standard

Note: The StatefulSets should use `volumeClaimTemplates` instead of standalone PVCs. Create the standalone PVCs only as documentation — the actual claims are embedded in the StatefulSet specs via `volumeClaimTemplates`.

### 1L. Create NetworkPolicies (`network-policies.yaml`)

Define restrictive network policies:

1. **Default deny all ingress** — deny all incoming traffic to all pods in `forgeteam` namespace
2. **Allow gateway to postgres** — gateway pods can reach postgres on port 5432
3. **Allow gateway to redis** — gateway pods can reach redis on port 6379
4. **Allow gateway to minio** — gateway pods can reach minio on port 9000
5. **Allow dashboard to gateway** — dashboard pods can reach gateway on port 18789
6. **Allow external to gateway** — allow ingress from the ingress controller to gateway on port 18789
7. **Allow external to dashboard** — allow ingress from the ingress controller to dashboard on port 3000
8. **Deny postgres egress** — postgres should not initiate outbound connections (except DNS)
9. **Allow gateway egress to external APIs** — gateway needs to reach `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.elevenlabs.io` on port 443

### 1M. Create Ingress (`ingress.yaml`)

Ingress resource with TLS:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: forgeteam-ingress
  namespace: forgeteam
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "25m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "120"
    # WebSocket support for gateway
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - forgeteam.example.com
        - api.forgeteam.example.com
      secretName: forgeteam-tls
  rules:
    - host: forgeteam.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: dashboard
                port:
                  number: 80
    - host: api.forgeteam.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: gateway
                port:
                  number: 18789
```

---

## WORKSTREAM 2: Create Helm Chart

**Files to create:**
- `/forge-team/infrastructure/helm/forge-team/Chart.yaml`
- `/forge-team/infrastructure/helm/forge-team/values.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/_helpers.tpl`
- `/forge-team/infrastructure/helm/forge-team/templates/namespace.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/configmap.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/secrets.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/gateway-deployment.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/dashboard-deployment.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/postgres-statefulset.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/redis-statefulset.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/minio-statefulset.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/services.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/hpa.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/network-policies.yaml`
- `/forge-team/infrastructure/helm/forge-team/templates/ingress.yaml`

### 2A. Create Chart.yaml

```yaml
apiVersion: v2
name: forge-team
description: ForgeTeam - Autonomous 12-agent SDLC platform
type: application
version: 0.1.0
appVersion: "0.1.0"
keywords:
  - ai
  - agents
  - sdlc
  - viadp
maintainers:
  - name: ForgeTeam
```

### 2B. Create values.yaml

Create a comprehensive `values.yaml` that parameterizes all deployable settings:

```yaml
global:
  namespace: forgeteam
  deploymentRegion: riyadh

gateway:
  replicas: 2
  image:
    repository: forgeteam/gateway
    tag: latest
    pullPolicy: IfNotPresent
  port: 18789
  resources:
    requests:
      memory: 256Mi
      cpu: 250m
    limits:
      memory: 1Gi
      cpu: 1000m
  hpa:
    enabled: true
    minReplicas: 2
    maxReplicas: 8
    cpuUtilization: 70
    memoryUtilization: 80

dashboard:
  replicas: 2
  image:
    repository: forgeteam/dashboard
    tag: latest
    pullPolicy: IfNotPresent
  port: 3000
  resources:
    requests:
      memory: 128Mi
      cpu: 100m
    limits:
      memory: 512Mi
      cpu: 500m

postgres:
  image: pgvector/pgvector:pg16
  storage: 10Gi
  storageClass: standard
  resources:
    requests:
      memory: 256Mi
      cpu: 250m
    limits:
      memory: 1Gi
      cpu: 1000m

redis:
  image: redis:7-alpine
  storage: 5Gi
  storageClass: standard
  maxMemory: 256mb
  resources:
    requests:
      memory: 128Mi
      cpu: 100m
    limits:
      memory: 512Mi
      cpu: 500m

minio:
  enabled: true
  image: minio/minio:latest
  storage: 20Gi
  storageClass: standard
  bucket: forgeteam-artifacts
  resources:
    requests:
      memory: 256Mi
      cpu: 250m
    limits:
      memory: 1Gi
      cpu: 500m

ingress:
  enabled: true
  className: nginx
  tls: true
  hosts:
    dashboard: forgeteam.example.com
    gateway: api.forgeteam.example.com
  clusterIssuer: letsencrypt-prod

networkPolicies:
  enabled: true

secrets:
  # These should be overridden via --set or a separate secret manager
  anthropicApiKey: REPLACE_ME
  googleAiApiKey: REPLACE_ME
  elevenlabsApiKey: REPLACE_ME
  whisperApiKey: REPLACE_ME
  postgresUser: forgeteam
  postgresPassword: CHANGE_ME_IN_PRODUCTION
  postgresDb: forgeteam
  minioAccessKey: forgeteam-admin
  minioSecretKey: CHANGE_ME_IN_PRODUCTION
```

### 2C. Create `_helpers.tpl`

Standard Helm helper template with:
- `forge-team.fullname` — chart name with release
- `forge-team.labels` — common labels (app.kubernetes.io/name, instance, version, managed-by)
- `forge-team.selectorLabels` — selector labels for deployments

### 2D. Templatize all K8s manifests

Each file in `templates/` should be the Helm-templatized version of the corresponding raw K8s manifest from WORKSTREAM 1. Replace hardcoded values with `{{ .Values.* }}` references. Use `{{ include "forge-team.labels" . }}` for labels and `{{ include "forge-team.fullname" . }}` for names.

---

## WORKSTREAM 3: Add MinIO Object Storage

**Files to create:**
- `/forge-team/gateway/src/storage.ts`

**Files to modify:**
- `/forge-team/docker/docker-compose.yml`
- `/forge-team/gateway/package.json`
- `/forge-team/gateway/src/index.ts`
- `/forge-team/gateway/src/task-manager.ts`

### 3A. Add MinIO service to Docker Compose

In `/forge-team/docker/docker-compose.yml`, add a MinIO service after the existing `qdrant` service:

```yaml
  minio:
    image: minio/minio:latest
    container_name: forgeteam-minio
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
    volumes:
      - minio_data:/data
    environment:
      - MINIO_ROOT_USER=${MINIO_ACCESS_KEY:-forgeteam-admin}
      - MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY:-forgeteam-secret}
    command: server /data --console-address ":9001"
    restart: unless-stopped
    networks:
      - forgeteam
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 10s
```

Add `minio_data` to the `volumes:` section:
```yaml
  minio_data:
    driver: local
```

Add MinIO environment variables to the gateway service:
```yaml
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY:-forgeteam-admin}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY:-forgeteam-secret}
      - MINIO_BUCKET=forgeteam-artifacts
      - MINIO_USE_SSL=false
```

### 3B. Add `@aws-sdk/client-s3` dependency

In `/forge-team/gateway/package.json`, add to `dependencies`:

```json
"@aws-sdk/client-s3": "^3.700.0"
```

### 3C. Create storage service (`gateway/src/storage.ts`)

Create a `StorageService` class using the AWS S3 SDK (MinIO is S3-compatible):

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export interface StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  useSSL: boolean;
  region?: string;
}

export interface UploadResult {
  key: string;
  bucket: string;
  size: number;
  etag: string;
  url: string;
}

export class StorageService {
  private client: S3Client;
  private bucket: string;

  constructor(config: StorageConfig) { /* ... */ }

  /** Ensure the bucket exists, create if not */
  async ensureBucket(): Promise<void> { /* ... */ }

  /** Upload a file/buffer to object storage */
  async upload(key: string, body: Buffer | string, contentType?: string): Promise<UploadResult> { /* ... */ }

  /** Download a file from object storage */
  async download(key: string): Promise<{ body: Buffer; contentType: string }> { /* ... */ }

  /** Delete a file from object storage */
  async delete(key: string): Promise<void> { /* ... */ }

  /** List all objects with a given prefix */
  async list(prefix: string): Promise<{ key: string; size: number; lastModified: Date }[]> { /* ... */ }

  /** Generate a pre-signed URL for temporary access (valid for 1 hour) */
  getObjectUrl(key: string): string { /* ... */ }
}
```

Key path convention for artifacts: `{sessionId}/{taskId}/{filename}`

Read the endpoint, credentials, bucket, and SSL flag from environment variables:
- `MINIO_ENDPOINT` (default: `localhost:9000`)
- `MINIO_ACCESS_KEY` (default: `forgeteam-admin`)
- `MINIO_SECRET_KEY` (default: `forgeteam-secret`)
- `MINIO_BUCKET` (default: `forgeteam-artifacts`)
- `MINIO_USE_SSL` (default: `false`)

### 3D. Integrate storage into gateway

In `/forge-team/gateway/src/index.ts`:

1. Import and instantiate `StorageService`:
```typescript
import { StorageService } from './storage';

const storageService = new StorageService({
  endpoint: process.env.MINIO_ENDPOINT ?? 'localhost:9000',
  accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'forgeteam-admin',
  secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'forgeteam-secret',
  bucket: process.env.MINIO_BUCKET ?? 'forgeteam-artifacts',
  useSSL: process.env.MINIO_USE_SSL === 'true',
});
```

2. Call `storageService.ensureBucket()` during startup (after server listen).

3. Add REST endpoints:

```typescript
// POST /api/artifacts/upload — upload an artifact
app.post('/api/artifacts/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const { sessionId, taskId, filename } = req.query as { sessionId: string; taskId: string; filename: string };
  if (!sessionId || !taskId || !filename) {
    return res.status(400).json({ error: 'Missing sessionId, taskId, or filename query params' });
  }
  const key = `${sessionId}/${taskId}/${filename}`;
  const contentType = req.headers['content-type'] ?? 'application/octet-stream';
  const result = await storageService.upload(key, req.body, contentType);
  res.json(result);
});

// GET /api/artifacts/download — download an artifact
app.get('/api/artifacts/download', async (req, res) => {
  const { key } = req.query as { key: string };
  if (!key) return res.status(400).json({ error: 'Missing key query param' });
  const { body, contentType } = await storageService.download(key);
  res.setHeader('Content-Type', contentType);
  res.send(body);
});

// GET /api/artifacts/list — list artifacts for a task
app.get('/api/artifacts/list', async (req, res) => {
  const { sessionId, taskId } = req.query as { sessionId: string; taskId: string };
  const prefix = taskId ? `${sessionId ?? ''}/${taskId}/` : `${sessionId ?? ''}/`;
  const objects = await storageService.list(prefix);
  res.json({ objects, timestamp: new Date().toISOString() });
});
```

### 3E. Wire artifacts to task manager

In `/forge-team/gateway/src/task-manager.ts`, when a task artifact is added, the artifact string should be the storage key (e.g., `session123/task456/architecture-diagram.pdf`). No changes to the task interface needed — the existing `artifacts: string[]` field stores the keys.

Add a method or update existing artifact-related logic so that when artifacts are added to a task, they reference the MinIO object key. If no artifact logic exists yet, add a `addArtifact(taskId: string, artifactKey: string)` method that appends the key to the task's artifacts array.

---

## WORKSTREAM 4: DB-Level Immutability + Data Sovereignty

**Files to modify:**
- `/forge-team/infrastructure/init.sql`
- `/forge-team/gateway/src/index.ts` (add data sovereignty config endpoint)

### 4A. Add INSERT-only enforcement on `viadp_audit_log`

Append to `/forge-team/infrastructure/init.sql` (at the end, after the seed data):

```sql
-- =============================================================================
-- VIADP Audit Log Immutability Enforcement
-- =============================================================================

-- Prevent UPDATE on viadp_audit_log
CREATE OR REPLACE RULE viadp_audit_no_update AS
  ON UPDATE TO viadp_audit_log
  DO INSTEAD NOTHING;

-- Prevent DELETE on viadp_audit_log
CREATE OR REPLACE RULE viadp_audit_no_delete AS
  ON DELETE TO viadp_audit_log
  DO INSTEAD NOTHING;

-- Also prevent TRUNCATE via event trigger (requires superuser)
-- Note: TRUNCATE prevention requires a custom event trigger at the DB level.
-- For defense-in-depth, also revoke UPDATE/DELETE from the application role:
-- REVOKE UPDATE, DELETE ON viadp_audit_log FROM forgeteam;
-- (Uncomment the above line when running with separate app/admin DB roles)

-- Add a comment documenting the immutability contract
COMMENT ON TABLE viadp_audit_log IS
  'Immutable append-only audit log for VIADP delegation protocol. '
  'UPDATE and DELETE operations are blocked by PostgreSQL rules. '
  'Hash chain integrity: each entry''s hash covers all prior entries.';
```

### 4B. Add sequence enforcement on audit log

Also add a trigger to ensure `sequence_number` is always monotonically increasing and `previous_hash` references the correct prior entry:

```sql
-- Ensure sequence numbers are monotonically increasing
CREATE OR REPLACE FUNCTION enforce_audit_sequence()
RETURNS TRIGGER AS $$
DECLARE
  max_seq INTEGER;
  last_hash TEXT;
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0), COALESCE(
    (SELECT hash FROM viadp_audit_log ORDER BY sequence_number DESC LIMIT 1),
    ''
  ) INTO max_seq, last_hash;

  -- Auto-set sequence number if not provided or incorrect
  IF NEW.sequence_number <= max_seq OR NEW.sequence_number IS NULL THEN
    NEW.sequence_number := max_seq + 1;
  END IF;

  -- Auto-set previous_hash if not provided
  IF NEW.previous_hash = '' OR NEW.previous_hash IS NULL THEN
    NEW.previous_hash := last_hash;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_enforce_audit_sequence
  BEFORE INSERT ON viadp_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION enforce_audit_sequence();
```

### 4C. Add data sovereignty configuration

In `/forge-team/gateway/src/index.ts`, add a data sovereignty info endpoint:

```typescript
// GET /api/system/sovereignty — data sovereignty configuration
app.get('/api/system/sovereignty', (_req, res) => {
  res.json({
    deploymentRegion: process.env.DEPLOYMENT_REGION ?? 'riyadh',
    dataResidency: 'sa',  // Saudi Arabia ISO 3166-1 alpha-2
    externalApiEndpoints: [
      { service: 'Anthropic', endpoint: 'api.anthropic.com', purpose: 'LLM inference (Claude models)', dataFlow: 'outbound-prompts-inbound-completions' },
      { service: 'Google AI', endpoint: 'generativelanguage.googleapis.com', purpose: 'LLM inference (Gemini models)', dataFlow: 'outbound-prompts-inbound-completions' },
      { service: 'ElevenLabs', endpoint: 'api.elevenlabs.io', purpose: 'Text-to-Speech', dataFlow: 'outbound-text-inbound-audio' },
      { service: 'OpenAI Whisper', endpoint: 'api.openai.com', purpose: 'Speech-to-Text', dataFlow: 'outbound-audio-inbound-text' },
    ],
    internalServices: [
      { service: 'PostgreSQL', host: 'postgres:5432', dataStored: 'All structured data, memory, audit logs' },
      { service: 'Redis', host: 'redis:6379', dataStored: 'Ephemeral cache, pub/sub messages' },
      { service: 'MinIO', host: 'minio:9000', dataStored: 'Task artifacts, documents' },
    ],
    compliance: {
      dataAtRest: 'Stored in deployment region only',
      dataInTransit: 'TLS 1.3 for all external API calls',
      llmDataPolicy: 'Prompts sent to external LLM APIs; no persistent storage by providers (per API ToS)',
    },
    timestamp: new Date().toISOString(),
  });
});
```

### 4D. Add `DEPLOYMENT_REGION` to Docker Compose gateway env

In `/forge-team/docker/docker-compose.yml`, add to gateway environment:
```yaml
      - DEPLOYMENT_REGION=${DEPLOYMENT_REGION:-riyadh}
```

---

## WORKSTREAM 5: Upgrade Node.js to 22

**Files to modify:**
- `/forge-team/docker/gateway.Dockerfile`
- `/forge-team/docker/dashboard.Dockerfile`
- `/forge-team/package.json`

### 5A. Update gateway Dockerfile

In `/forge-team/docker/gateway.Dockerfile`, replace all three occurrences of `node:20-alpine` with `node:22-alpine`:

- Line 6: `FROM node:22-alpine AS deps`
- Line 19: `FROM node:22-alpine AS builder`
- Line 40: `FROM node:22-alpine AS runner`

### 5B. Update dashboard Dockerfile

In `/forge-team/docker/dashboard.Dockerfile`, replace all three occurrences of `node:20-alpine` with `node:22-alpine`:

- Line 6: `FROM node:22-alpine AS deps`
- Line 17: `FROM node:22-alpine AS builder`
- Line 33: `FROM node:22-alpine AS runner`

### 5C. Update root package.json engines

In `/forge-team/package.json`, change:
```json
"engines": {
  "node": ">=22.0.0"
}
```

---

## TEAM STRUCTURE SUGGESTION

Create a team with these agents working in parallel:

1. **k8s-architect** — Handles WORKSTREAM 1 (raw Kubernetes manifests) + WORKSTREAM 2 (Helm chart) — this is the largest workstream
2. **storage-engineer** — Handles WORKSTREAM 3 (MinIO object storage integration)
3. **db-security** — Handles WORKSTREAM 4 (DB immutability + data sovereignty) + WORKSTREAM 5 (Node.js upgrade) — these are smaller and can be combined

**Dependency order**: All workstreams are independent and can run in parallel. WORKSTREAM 2 conceptually depends on WORKSTREAM 1 (Helm templates mirror the raw manifests), but both can be written simultaneously by the same agent.

---

## FINAL CHECKLIST (Every Agent Must Verify)

After all work is complete, verify:

- [ ] `/forge-team/infrastructure/k8s/` directory exists with all 13 YAML files
- [ ] Namespace is `forgeteam` across all K8s manifests
- [ ] Gateway Deployment has 2 replicas with port 18789
- [ ] Dashboard Deployment has 2 replicas with port 3000
- [ ] Postgres StatefulSet uses `pgvector/pgvector:pg16` with 10Gi PVC
- [ ] Redis StatefulSet uses `redis:7-alpine` with 5Gi PVC
- [ ] MinIO StatefulSet uses `minio/minio:latest` with 20Gi PVC
- [ ] HPA targets gateway with min=2, max=8, CPU target=70%
- [ ] NetworkPolicies: default deny all + explicit allow rules for each service pair
- [ ] Ingress has TLS configuration with cert-manager annotation
- [ ] Ingress has WebSocket upgrade support annotations for gateway
- [ ] `/forge-team/infrastructure/helm/forge-team/` directory has Chart.yaml, values.yaml, `_helpers.tpl`, and all templates
- [ ] `values.yaml` parameterizes: replicas, images, storage sizes, resource limits, ingress hosts, secrets
- [ ] MinIO service is added to `docker-compose.yml` with healthcheck, bound to 127.0.0.1
- [ ] `minio_data` volume exists in docker-compose volumes section
- [ ] MinIO environment variables are in gateway's docker-compose environment
- [ ] `/forge-team/gateway/src/storage.ts` exists with `StorageService` class
- [ ] `@aws-sdk/client-s3` is in gateway's `package.json` dependencies
- [ ] REST endpoints exist: `POST /api/artifacts/upload`, `GET /api/artifacts/download`, `GET /api/artifacts/list`
- [ ] `storageService.ensureBucket()` is called during gateway startup
- [ ] `viadp_audit_log` has PostgreSQL rules preventing UPDATE and DELETE
- [ ] Audit log sequence enforcement trigger exists in init.sql
- [ ] `GET /api/system/sovereignty` endpoint returns deployment region and API documentation
- [ ] `DEPLOYMENT_REGION=riyadh` is in gateway docker-compose environment
- [ ] All Dockerfiles use `node:22-alpine` (not `node:20-alpine`)
- [ ] Root `package.json` engines field requires `>=22.0.0`
- [ ] No existing functionality was removed — all changes are additive
