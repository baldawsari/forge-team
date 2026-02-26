#!/bin/sh
# =============================================================================
# ForgeTeam Docker Entrypoint Script
# Handles initialization, health checks, and graceful startup
# =============================================================================

set -e

echo "============================================"
echo " ForgeTeam - Starting initialization"
echo "============================================"

# ---------------------------------------------------------------------------
# Environment validation
# ---------------------------------------------------------------------------
check_required_env() {
    local var_name="$1"
    eval local var_value="\$$var_name"
    if [ -z "$var_value" ]; then
        echo "[ERROR] Required environment variable $var_name is not set"
        exit 1
    fi
    echo "[OK] $var_name is set"
}

echo ""
echo "--- Checking required environment variables ---"
check_required_env "DATABASE_URL"
check_required_env "REDIS_URL"

# Optional but warn if missing
warn_optional_env() {
    local var_name="$1"
    eval local var_value="\$$var_name"
    if [ -z "$var_value" ]; then
        echo "[WARN] Optional variable $var_name is not set"
    else
        echo "[OK] $var_name is set"
    fi
}

echo ""
echo "--- Checking optional environment variables ---"
warn_optional_env "ANTHROPIC_API_KEY"
warn_optional_env "GOOGLE_AI_API_KEY"
warn_optional_env "ELEVENLABS_API_KEY"
warn_optional_env "WHISPER_API_KEY"

# ---------------------------------------------------------------------------
# Wait for PostgreSQL
# ---------------------------------------------------------------------------
echo ""
echo "--- Waiting for PostgreSQL ---"

MAX_RETRIES=30
RETRY_INTERVAL=2
RETRIES=0

# Extract host and port from DATABASE_URL
# Format: postgresql://user:password@host:port/dbname
PG_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
PG_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')

if [ -z "$PG_HOST" ]; then
    PG_HOST="postgres"
fi
if [ -z "$PG_PORT" ]; then
    PG_PORT="5432"
fi

while [ $RETRIES -lt $MAX_RETRIES ]; do
    if nc -z "$PG_HOST" "$PG_PORT" 2>/dev/null; then
        echo "[OK] PostgreSQL is available at $PG_HOST:$PG_PORT"
        break
    fi
    RETRIES=$((RETRIES + 1))
    echo "  Waiting for PostgreSQL ($RETRIES/$MAX_RETRIES)..."
    sleep $RETRY_INTERVAL
done

if [ $RETRIES -eq $MAX_RETRIES ]; then
    echo "[ERROR] PostgreSQL not available after $MAX_RETRIES attempts"
    exit 1
fi

# ---------------------------------------------------------------------------
# Wait for Redis
# ---------------------------------------------------------------------------
echo ""
echo "--- Waiting for Redis ---"

REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|redis://\([^:]*\):.*|\1|p')
REDIS_PORT=$(echo "$REDIS_URL" | sed -n 's|.*:\([0-9]*\)$|\1|p')

if [ -z "$REDIS_HOST" ]; then
    REDIS_HOST="redis"
fi
if [ -z "$REDIS_PORT" ]; then
    REDIS_PORT="6379"
fi

RETRIES=0
while [ $RETRIES -lt $MAX_RETRIES ]; do
    if nc -z "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
        echo "[OK] Redis is available at $REDIS_HOST:$REDIS_PORT"
        break
    fi
    RETRIES=$((RETRIES + 1))
    echo "  Waiting for Redis ($RETRIES/$MAX_RETRIES)..."
    sleep $RETRY_INTERVAL
done

if [ $RETRIES -eq $MAX_RETRIES ]; then
    echo "[ERROR] Redis not available after $MAX_RETRIES attempts"
    exit 1
fi

# ---------------------------------------------------------------------------
# Run database migrations (if applicable)
# ---------------------------------------------------------------------------
echo ""
echo "--- Database initialization ---"

if [ -f "/docker-entrypoint-initdb.d/01-init.sql" ]; then
    echo "Database initialization SQL will be handled by PostgreSQL container"
else
    echo "No init SQL found; database should already be initialized"
fi

# ---------------------------------------------------------------------------
# Print configuration summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo " ForgeTeam - Configuration Summary"
echo "============================================"
echo "  Node Environment: ${NODE_ENV:-development}"
echo "  Port:             ${PORT:-3001}"
echo "  PostgreSQL:       $PG_HOST:$PG_PORT"
echo "  Redis:            $REDIS_HOST:$REDIS_PORT"
echo "============================================"
echo ""

# ---------------------------------------------------------------------------
# Execute the main process
# ---------------------------------------------------------------------------
echo "Starting ForgeTeam gateway..."
exec "$@"
