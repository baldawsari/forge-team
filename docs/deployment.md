# ForgeTeam Deployment Guide

Complete guide for deploying ForgeTeam locally with Docker Compose and in production with Kubernetes.

## Table of Contents

1. [Local Development (Docker Compose)](#1-local-development-docker-compose)
2. [Production Deployment (Kubernetes)](#2-production-deployment-kubernetes)
3. [Environment Configuration](#3-environment-configuration)
4. [Database Setup](#4-database-setup)
5. [SSL/TLS Configuration](#5-ssltls-configuration)
6. [Monitoring & Health Checks](#6-monitoring--health-checks)
7. [Backup & Recovery](#7-backup--recovery)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Local Development (Docker Compose)

### Prerequisites

| Requirement | Minimum Version |
|---|---|
| Docker Engine | 24+ |
| Docker Compose | v2+ |
| Available RAM | 4 GB |
| Anthropic API Key | Required |
| Google AI API Key | Required |

### Setup

1. **Clone and navigate to the project:**

```bash
cd forge-team
```

2. **Create your `.env` file from the template:**

```bash
cp .env.example .env
```

3. **Set your API keys in `.env`:**

```bash
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=AI...
```

4. **Start all services:**

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Docker Compose will build the Gateway and Dashboard images, then start all six services in dependency order (Postgres and Redis first, then Gateway, then Dashboard).

5. **Verify everything is running:**

```bash
docker compose -f docker/docker-compose.yml ps
curl http://localhost:18789/health
```

### Service URLs

| Service | URL | Notes |
|---|---|---|
| Dashboard | `http://localhost:3000` | Next.js web interface |
| Gateway | `http://localhost:18789` | WebSocket + REST API |
| Gateway Health | `http://localhost:18789/health` | Health check endpoint |
| MinIO Console | `http://localhost:9001` | Object storage admin (bound to 127.0.0.1) |
| MinIO API | `http://localhost:9000` | S3-compatible API (bound to 127.0.0.1) |
| PostgreSQL | `localhost:5432` | pgvector/pgvector:pg16 (bound to 127.0.0.1) |
| Redis | `localhost:6379` | redis:7-alpine (bound to 127.0.0.1) |
| Qdrant REST | `http://localhost:6333` | Vector search engine |
| Qdrant gRPC | `localhost:6334` | Qdrant gRPC interface |

### Stopping Services

```bash
# Stop all services (preserves data volumes)
docker compose -f docker/docker-compose.yml down

# Stop and remove all data volumes
docker compose -f docker/docker-compose.yml down -v
```

### Rebuilding After Code Changes

```bash
docker compose -f docker/docker-compose.yml up -d --build gateway dashboard
```

---

## 2. Production Deployment (Kubernetes)

### Prerequisites

| Requirement | Details |
|---|---|
| Kubernetes | 1.28+ |
| kubectl | Configured for your cluster |
| Helm | 3.x (for Helm deployment option) |
| Container Registry | To push Gateway and Dashboard images |
| SSL Certificate | For HTTPS (cert-manager recommended) |
| Ingress Controller | nginx-ingress-controller |

### Build and Push Container Images

```bash
# Build images
docker build -t forgeteam/gateway:latest -f docker/gateway.Dockerfile .
docker build -t forgeteam/dashboard:latest -f docker/dashboard.Dockerfile .

# Tag for your registry
docker tag forgeteam/gateway:latest YOUR_REGISTRY/forgeteam/gateway:latest
docker tag forgeteam/dashboard:latest YOUR_REGISTRY/forgeteam/dashboard:latest

# Push
docker push YOUR_REGISTRY/forgeteam/gateway:latest
docker push YOUR_REGISTRY/forgeteam/dashboard:latest
```

### Option A: Raw Kubernetes Manifests

The manifests are located in `infrastructure/k8s/`. Apply them in order:

```bash
# 1. Create namespace
kubectl apply -f infrastructure/k8s/namespace.yaml

# 2. Storage (PVCs)
kubectl apply -f infrastructure/k8s/pvc.yaml

# 3. Configuration and secrets
kubectl apply -f infrastructure/k8s/configmap.yaml
kubectl apply -f infrastructure/k8s/secrets.yaml

# 4. Databases and storage backends
kubectl apply -f infrastructure/k8s/postgres-statefulset.yaml
kubectl apply -f infrastructure/k8s/redis-statefulset.yaml
kubectl apply -f infrastructure/k8s/minio-statefulset.yaml

# 5. Wait for stateful services to be ready
kubectl -n forgeteam rollout status statefulset/postgres
kubectl -n forgeteam rollout status statefulset/redis

# 6. Application services
kubectl apply -f infrastructure/k8s/services.yaml
kubectl apply -f infrastructure/k8s/gateway-deployment.yaml
kubectl apply -f infrastructure/k8s/dashboard-deployment.yaml

# 7. Networking and autoscaling
kubectl apply -f infrastructure/k8s/ingress.yaml
kubectl apply -f infrastructure/k8s/network-policies.yaml
kubectl apply -f infrastructure/k8s/hpa.yaml
```

**Update secrets before deploying.** Edit `infrastructure/k8s/secrets.yaml` and replace all `REPLACE_ME` and `CHANGE_ME_IN_PRODUCTION` values with real credentials.

### Option B: Helm Chart

The Helm chart is located at `infrastructure/helm/forge-team/`.

**Install:**

```bash
helm install forge-team infrastructure/helm/forge-team \
  --namespace forgeteam \
  --create-namespace \
  --set secrets.anthropicApiKey="sk-ant-..." \
  --set secrets.googleAiApiKey="AI..." \
  --set secrets.postgresPassword="STRONG_PASSWORD" \
  --set secrets.minioSecretKey="STRONG_PASSWORD" \
  --set ingress.hosts.dashboard="forgeteam.yourdomain.com" \
  --set ingress.hosts.gateway="api.forgeteam.yourdomain.com"
```

**Upgrade after configuration changes:**

```bash
helm upgrade forge-team infrastructure/helm/forge-team \
  --namespace forgeteam \
  --reuse-values \
  --set gateway.image.tag="v1.1.0"
```

**Uninstall:**

```bash
helm uninstall forge-team --namespace forgeteam
```

### Kubernetes Architecture

The production deployment includes:

- **Gateway**: 2 replicas (HPA scales to 8), topology spread across nodes
- **Dashboard**: 2 replicas behind LoadBalancer service (port 80 -> 3000)
- **PostgreSQL**: StatefulSet with 10Gi PVC (pgvector/pgvector:pg16)
- **Redis**: StatefulSet with 5Gi PVC (redis:7-alpine, 256mb maxmemory)
- **MinIO**: StatefulSet with 20Gi PVC for artifact storage
- **Ingress**: nginx with TLS via cert-manager, WebSocket upgrade support
- **Network Policies**: Restrict inter-pod traffic to required paths only

---

## 3. Environment Configuration

See [README.md](../README.md) for the full environment variables table.

### Critical Production Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude models |
| `GOOGLE_AI_API_KEY` | Yes | Google AI key for Gemini models |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password (change from default) |
| `MINIO_SECRET_KEY` | Yes | MinIO secret key (change from default) |
| `NODE_ENV` | Yes | Set to `production` for production deployments |
| `DEPLOYMENT_REGION` | No | Deployment region identifier (default: `riyadh`) |
| `ELEVENLABS_API_KEY` | No | ElevenLabs key for TTS voice output |
| `WHISPER_API_KEY` | No | Whisper key for STT voice input |
| `GITHUB_TOKEN` | No | GitHub personal access token for code operations |
| `REDIS_PASSWORD` | Yes | Redis password (default: `forgeteam_redis_secret`) |

### Security Checklist

- Replace all default passwords (`forgeteam_secret`, `forgeteam_redis_secret`, `forgeteam-secret`)
- Store secrets in Kubernetes Secrets or a vault (never commit to version control)
- Bind database and cache ports to `127.0.0.1` or use network policies
- Set `NODE_ENV=production` to disable development features

---

## 4. Database Setup

### Automatic Initialization

PostgreSQL is automatically initialized by `infrastructure/init.sql` on first boot. In Docker Compose, the init script is mounted into the Postgres container at `/docker-entrypoint-initdb.d/01-init.sql`.

### What init.sql Creates

| Category | Details |
|---|---|
| Extensions | `uuid-ossp`, `vector` (pgvector) |
| Tables (13) | `agents`, `tasks`, `messages`, `workflows`, `workflow_instances`, `memory_entries`, `viadp_delegations`, `viadp_audit_log`, `audit_log`, `model_configs`, `cost_tracking`, `sessions`, `trust_scores`, `vector_entries`, `viadp_reputation`, `workflow_checkpoints` |
| Seed Data | All 12 BMAD agents registered with roles, capabilities, model configs, and trust scores |
| Trust Priors | Bayesian Beta(2,2) prior for each agent (neutral starting trust) |
| Audit Rules | `viadp_audit_log` is INSERT-only (UPDATE and DELETE blocked by PostgreSQL rules) |
| Functions | `update_updated_at_column()` trigger, `verify_audit_hash_chain()` integrity check, `enforce_audit_sequence()` trigger |

### Manual Initialization

If you need to initialize the database manually (e.g., connecting to an external PostgreSQL instance):

```bash
psql -h localhost -U forgeteam -d forgeteam -f infrastructure/init.sql
```

### Verifying Database Integrity

To verify the VIADP audit log hash chain has not been tampered with:

```sql
SELECT * FROM verify_audit_hash_chain();
```

Returns `valid = true` if the chain is intact, or `broken_at` indicating the sequence number where integrity broke.

---

## 5. SSL/TLS Configuration

### Kubernetes with cert-manager

The included Ingress manifest (`infrastructure/k8s/ingress.yaml`) is pre-configured for cert-manager with the `letsencrypt-prod` cluster issuer.

1. **Install cert-manager** (if not already installed):

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml
```

2. **Create a ClusterIssuer:**

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

3. **Update Ingress hosts** in `infrastructure/k8s/ingress.yaml` or via Helm values:

```yaml
ingress:
  hosts:
    dashboard: forgeteam.yourdomain.com
    gateway: api.forgeteam.yourdomain.com
```

Certificates are automatically provisioned and renewed by cert-manager.

### Docker Compose with Reverse Proxy

For local HTTPS or staging environments, use a reverse proxy in front of Docker Compose:

**nginx example** (`/etc/nginx/sites-available/forgeteam`):

```nginx
server {
    listen 443 ssl;
    server_name forgeteam.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/forgeteam.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/forgeteam.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 443 ssl;
    server_name api.forgeteam.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.forgeteam.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.forgeteam.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }
}
```

**Traefik** can also be used as an alternative reverse proxy with automatic Let's Encrypt certificate management.

---

## 6. Monitoring & Health Checks

### Gateway Health Endpoint

The Gateway exposes a health check at:

```
GET http://localhost:18789/health
```

A `200 OK` response indicates the service is healthy and ready to accept connections.

### Kubernetes Probes

The Gateway deployment includes both liveness and readiness probes:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 18789
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 18789
  initialDelaySeconds: 10
  periodSeconds: 5
```

### Docker Compose Healthchecks

All services in Docker Compose have built-in healthchecks:

| Service | Check Method | Interval |
|---|---|---|
| Gateway | HTTP fetch to `http://localhost:18789/health` | 15s |
| Dashboard | HTTP fetch to `http://localhost:3000` | 15s |
| PostgreSQL | `pg_isready` | 10s |
| Redis | `redis-cli ping` | 10s |
| MinIO | `mc ready local` | 15s |
| Qdrant | HTTP fetch to `http://localhost:6333/healthz` | 15s |

### Horizontal Pod Autoscaler

In Kubernetes, the Gateway deployment has an HPA configured:

- **Min replicas**: 2
- **Max replicas**: 8
- **Scale-up trigger**: CPU > 70% or Memory > 80% utilization

Check autoscaler status:

```bash
kubectl -n forgeteam get hpa
```

---

## 7. Backup & Recovery

### PostgreSQL

**Backup:**

```bash
# Docker Compose
docker exec forgeteam-postgres pg_dump -U forgeteam forgeteam > backup_$(date +%Y%m%d).sql

# Kubernetes
kubectl -n forgeteam exec statefulset/postgres -- pg_dump -U forgeteam forgeteam > backup_$(date +%Y%m%d).sql
```

**Restore:**

```bash
# Docker Compose
docker exec -i forgeteam-postgres psql -U forgeteam forgeteam < backup_20260228.sql

# Kubernetes
kubectl -n forgeteam exec -i statefulset/postgres -- psql -U forgeteam forgeteam < backup_20260228.sql
```

### MinIO (Object Storage)

**Backup with MinIO Client (`mc`):**

```bash
# Configure mc alias
mc alias set forgeteam http://localhost:9000 forgeteam-admin YOUR_SECRET_KEY

# Mirror bucket to local directory
mc mirror forgeteam/forgeteam-artifacts ./backup/minio-artifacts/

# Mirror to another S3-compatible target
mc mirror forgeteam/forgeteam-artifacts s3backup/forgeteam-artifacts/
```

### Redis

Redis is configured with AOF (Append Only File) persistence via the `--appendonly yes` flag. The AOF data is stored in the `redisdata` Docker volume (or the `5Gi` PVC in Kubernetes).

**Manual snapshot:**

```bash
# Docker Compose
docker exec forgeteam-redis redis-cli -a forgeteam_redis_secret BGSAVE

# Kubernetes
kubectl -n forgeteam exec statefulset/redis -- redis-cli BGSAVE
```

Redis data is primarily used as a cache and pub/sub layer. Full recovery from PostgreSQL is possible if Redis data is lost.

---

## 8. Troubleshooting

### Common Issues

| Problem | Likely Cause | Solution |
|---|---|---|
| Gateway won't start | Missing or invalid API keys | Verify `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY` are set in `.env` or Kubernetes secrets |
| Dashboard shows "Connecting..." | Gateway not reachable on port 18789 | Confirm Gateway is running: `curl http://localhost:18789/health` |
| Database connection failed | Incorrect `DATABASE_URL` or Postgres not ready | Check `DATABASE_URL` matches Postgres credentials; verify Postgres is healthy: `docker exec forgeteam-postgres pg_isready` |
| Voice features not working | Missing voice API keys | Set `ELEVENLABS_API_KEY` (TTS) and `WHISPER_API_KEY` (STT) in environment |
| CORS errors in browser | Proxy or direct-access misconfiguration | Ensure requests go through the same origin or configure a reverse proxy; check `NEXT_PUBLIC_GATEWAY_URL` |
| Pods stuck in CrashLoopBackOff | Container failing healthcheck or missing config | Check logs: `kubectl -n forgeteam logs deployment/gateway` |
| MinIO bucket not found | First-run bucket not yet created | The Gateway auto-creates the bucket on startup; check MinIO console at `http://localhost:9001` |
| Qdrant connection refused | Qdrant container not started | Verify: `curl http://localhost:6333/healthz` |

### Checking Logs

```bash
# Docker Compose - all services
docker compose -f docker/docker-compose.yml logs -f

# Docker Compose - specific service
docker compose -f docker/docker-compose.yml logs -f gateway

# Kubernetes
kubectl -n forgeteam logs deployment/gateway -f
kubectl -n forgeteam logs deployment/dashboard -f
kubectl -n forgeteam logs statefulset/postgres -f
```

### Resetting the Environment

```bash
# Docker Compose: stop and remove all data
docker compose -f docker/docker-compose.yml down -v

# Restart fresh
docker compose -f docker/docker-compose.yml up -d --build
```

For Kubernetes, delete and recreate the namespace (this destroys all data):

```bash
kubectl delete namespace forgeteam
kubectl apply -f infrastructure/k8s/namespace.yaml
# Re-apply all manifests in order (see Section 2)
```
