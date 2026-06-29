#!/usr/bin/env bash
# Vercel build entrypoint.
#
# Every deploy: generate the Prisma client + build Next. These never connect to
# the database, so they don't need DIRECT_URL.
#
# Production ONLY: apply migrations. Previews/branch builds must NOT migrate
# (and must never re-seed) — they'd either fail without DIRECT_URL or, worse,
# mutate the shared prod DB from a branch build. Seeding is deliberately NOT
# here: prod already has its data; seed is a manual `npm run db:seed` if ever
# needed (prisma/seed.ts is idempotent — upserts).
set -euo pipefail

npx prisma generate

if [ "${VERCEL_ENV:-}" = "production" ]; then
  npx prisma migrate deploy
fi

npx next build
