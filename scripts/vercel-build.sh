#!/usr/bin/env bash
# Vercel build entrypoint.
#
# Every deploy: generate the Prisma client + build Next. These never connect to
# the database, so they don't need DIRECT_URL.
#
# Production ONLY: apply migrations and synchronize the static course catalogue.
# Previews/branch builds must NOT do either — they'd either fail without
# DIRECT_URL or, worse, mutate the shared prod DB from a branch build. The seed
# is safe to run on each production deploy because prisma/seed.ts only upserts.
set -euo pipefail

npx prisma generate

if [ "${VERCEL_ENV:-}" = "production" ]; then
  npx prisma migrate deploy
  npm run db:seed
fi

npx next build
