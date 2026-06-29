#!/usr/bin/env bash
# Break Par — DESTRUCTIVE local database reset.
#
# `docker compose down -v` removes the `breakpar-pgdata` volume, permanently
# deleting ALL local data (rounds, users, leaderboard, seeded courses). This
# only touches the local docker volume — it can never reach a remote/prod DB —
# but it is irreversible, so we gate it behind an explicit confirmation.
#
# Skip the prompt in scripts/CI with:  FORCE=1 ./scripts/db-reset.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${FORCE:-}" != "1" ]; then
  echo "⚠️  This will DELETE the local Postgres volume (breakpar-pgdata)."
  echo "    All local rounds, users, and seeded data will be lost."
  read -r -p "Type 'reset' to continue: " reply
  if [ "$reply" != "reset" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Tearing down Postgres and removing its volume"
docker compose down -v

echo "==> Rebuilding a fresh database"
exec ./scripts/setup.sh
