#!/usr/bin/env bash
# Break Par — one-shot local dev bootstrap.
#
# Brings up the dockerised Postgres, waits for it to be healthy (covering a
# cold image pull + first-boot initdb), applies the schema, and seeds the
# course catalogue. Safe to re-run: every step is idempotent.
#
#   ./scripts/setup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

LOCAL_DB_URL="postgresql://breakpar:breakpar@localhost:5433/breakpar"

echo "==> Starting Postgres (docker compose up -d db)"
echo "    (first run pulls the postgres:16 image — this can take a while)"
docker compose up -d db

# --- Wait for the container to report healthy --------------------------------
# A cold `docker compose up` may pull the image (tens of MB) and run initdb
# before the healthcheck can pass. We poll the container's health status with a
# generous overall budget so the first run on a slow link still succeeds.
echo "==> Waiting for Postgres to become healthy (allowing for a cold pull)"
DEADLINE=$(( $(date +%s) + 300 ))   # up to 5 minutes
until [ "$(docker inspect -f '{{.State.Health.Status}}' breakpar-db 2>/dev/null || echo starting)" = "healthy" ]; do
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "!! Postgres did not become healthy in time. Recent logs:" >&2
    docker compose logs --tail=40 db >&2 || true
    exit 1
  fi
  printf '.'
  sleep 3
done
echo
echo "==> Postgres is healthy"

# --- Apply schema -----------------------------------------------------------
# If committed migrations exist, deploy them (matches production / CI). A fresh
# checkout without a migrations/ directory still gets a working schema via
# `prisma db push` so the DB is never left empty.
export DATABASE_URL="${DATABASE_URL:-$LOCAL_DB_URL}"
export DIRECT_URL="${DIRECT_URL:-$LOCAL_DB_URL}"

if ls prisma/migrations/*/migration.sql >/dev/null 2>&1; then
  echo "==> Applying migrations (prisma migrate deploy)"
  npm run db:migrate:deploy
else
  echo "==> No migrations found — pushing schema (prisma db push)"
  npm run db:push
fi

# --- Seed -------------------------------------------------------------------
echo "==> Seeding courses + holes (npm run db:seed)"
npm run db:seed

echo
echo "✅ Local database ready at: $LOCAL_DB_URL"
echo "   Make sure .env.local has DATABASE_URL/DIRECT_URL set to the above,"
echo "   then run: npm run dev"
