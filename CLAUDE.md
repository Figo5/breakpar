# CLAUDE.md

Guidance for AI coding agents working in this repo. Read this first, then the
`README.md` for product/architecture detail.

## What this is

**Break Par** — a Next.js 15 (App Router) golf score-attack game. One ranked
**daily** round per UTC day on a shared course, plus **unlimited practice**.
Outcomes are simulated **server-side** from a deterministic per-hole RNG so the
client can't cheat. Auth is optional Clerk; guests get an anonymous cookie
identity that's adopted on sign-in.

## Stack

- Next.js 15 / React 19, TypeScript, Tailwind.
- Prisma 5 + PostgreSQL.
- Clerk for auth (optional — guests work without it).
- Vitest for unit tests.

## Commands

```bash
npm run dev                # next dev (localhost:3000)
npm run build              # prisma generate && next build
npm test                   # vitest run (the unit suite)
npm run test:watch         # vitest watch
npm run lint               # next lint

# Local database (dockerised Postgres 16 on port 5433, creds breakpar/breakpar)
npm run db:setup           # up + wait-for-healthy + apply schema + seed  (idempotent)
npm run db:reset           # ⚠️ DESTRUCTIVE: down -v (wipes volume) then re-setup
npm run db:seed            # tsx prisma/seed.ts (loads data/courses.ts)

# Prisma
npm run db:migrate         # dev: create + apply a new migration
npm run db:migrate:deploy  # prod/CI: apply pending migrations
npm run db:push            # push schema without a migration (fresh-DB fallback)
```

## Layout

- `app/` — screens (`page.tsx`, `play/`, `courses/`, `result/`, `leaderboard/`,
  `profile/`, `admin/`) and API routes under `app/api/`.
- `lib/engine/` — the simulation core: `rng.ts` (deterministic seed),
  `probabilities.ts`, `shots.ts` (multi-shot), `resolveHole.ts`. **Do not** make
  outcomes depend on client input beyond the player's chosen action.
- `lib/` — `daily.ts`, `scoring.ts`, `streak.ts`, `leaderboard.ts`, `user.ts`
  (guest + Clerk), `db.ts` (Prisma client), `api.ts` (error wrapper),
  `rateLimit.ts`, `holeRead.ts`, `admin.ts`, `profile.ts`.
- `data/courses.ts` — the course catalogue that seeds the DB.
- `prisma/` — `schema.prisma`, `migrations/`, `seed.ts`.
- `tests/` — vitest (`engine`, `shots`, `scoring`, `daily`, `holeRead`).
- `scripts/` — `setup.sh`, `db-reset.sh`, `calibrate.ts` (Monte Carlo difficulty).

## Data flow per round

1. `GET /api/daily` → today's course + holes (public, cached).
2. `POST /api/round` → start/resume the player's round (one per UTC day).
3. `PATCH /api/round/[id]/hole` → submit shot sequence; **server resolves** each
   shot and persists the hole result.
4. `POST /api/round/[id]/finish` → finalize, update streak + best score.
5. `GET /api/leaderboard` → today's top players + your rank.

Prisma models: `User`, `Course`, `Hole`, `Round`, `HoleResult`, `Feedback`, `Streak`.

## Conventions & gotchas

- **Server authority**: hole resolution lives in `lib/engine`. Never trust the
  client for outcomes; the client sends intent (action/aggression), the server
  rolls the RNG and returns the lie/result.
- **Two DB URLs**: `DATABASE_URL` is the **pooled** connection used at runtime;
  `DIRECT_URL` is the **direct** connection used only by migrations / `db push`.
  Locally both point at the same docker Postgres.
- **Migrations are the source of truth** in prod — `vercel.json` runs
  `prisma migrate deploy` on deploy. Add schema changes via `npm run db:migrate`,
  not `db push`. `db:push` exists only as a fresh-DB fallback in `setup.sh`.
- **Streaks** follow Wordle rules: a streak is "alive" only if played today or
  yesterday (`isStreakAlive`); `maxStreak` survives a miss.
- **Time is UTC**: the "daily" boundary is UTC — see `lib/daily.ts`.
- Run `npm test` after touching anything in `lib/engine`, `lib/scoring`, or
  `lib/daily` — these have the most coverage and are easy to regress.

## When adding a feature

1. Schema change? Edit `prisma/schema.prisma`, run `npm run db:migrate`, commit
   the generated migration.
2. New course data? Edit `data/courses.ts`, re-run `npm run db:seed`.
3. Keep new game logic server-side and add/extend a vitest test in `tests/`.
