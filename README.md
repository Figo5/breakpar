# Break Par

A daily browser golf game. One real course a day, 18 holes, one Safe/Normal/Aggressive
decision per hole. Shoot under the course's par — about 3 in 10 smart rounds get there.
There's also an **Unlimited Practice** mode (`/courses`) to play any course as often as you like.

## Stack
Next.js (App Router) · React · TypeScript · Tailwind · Prisma + PostgreSQL · Clerk · Vercel

## How the game is built

The interesting part is **server-authoritative simulation**. The browser sends only a
*decision*; the server resolves the outcome with a seeded RNG and stores it. A hole can't
be replayed for a better result — the seed is `hash(SERVER_SEED, roundId, holeNumber)`,
so each hole is deterministic and idempotent. That's the anti-cheat backbone.

Difficulty lives entirely in `lib/engine/probabilities.ts`. It's calibrated so smart course
management breaks par ~29% of the time while reckless aggression scores worse on average and
blows up more. Re-run the calibration any time you touch those numbers: `npm run engine:calibrate`.

## Layout
```
app/            screens (page.tsx, play/, courses/, result/) + API routes (api/)
lib/engine/     probabilities.ts · rng.ts · resolveHole.ts  ← the simulation core
lib/            daily.ts · scoring.ts · streak.ts · leaderboard.ts · db.ts
lib/            user.ts (guest + Clerk) · api.ts (error wrapper) · rateLimit.ts
data/courses.ts the course catalogue (seeds the DB)
prisma/         schema.prisma · seed.ts
components/      Scorecard · HoleArt
scripts/        calibrate.ts (Monte Carlo difficulty check)
tests/          vitest unit tests (engine, scoring, daily)
```

## Modes
- **Daily** — one ranked round per UTC day, same course for everyone, leaderboard + streak.
- **Unlimited practice** (`/courses`) — play any course as often as you like; no streak impact.

## Accounts & streaks
No sign-in required: a round can be started instantly and an anonymous **guest** identity
is minted in an httpOnly cookie. Signing in with Clerk later **adopts** that guest row, so
rounds and streaks carry over. Day-streaks follow Wordle rules — a streak is only "alive" if
you played today or yesterday (`isStreakAlive`), and `maxStreak` survives a miss.

## Run it
```bash
npm install
cp .env.example .env.local        # DATABASE_URL (pooled) + DIRECT_URL + Clerk + SERVER_SEED
npm run db:push                   # create tables (uses DIRECT_URL)
npm run db:seed                   # load courses + holes
npm run dev                       # http://localhost:3000
npm test                          # run the unit suite
```

## Database migrations
Schema changes go through Prisma **migrations** (not `db push`).
```bash
npm run db:migrate            # dev: create + apply a new migration locally
npm run db:migrate:deploy     # prod: apply pending migrations (run by Vercel build)
```
Vercel's build command (`vercel.json`) runs `prisma migrate deploy` automatically on every
deploy. A **fresh** database (e.g. a new prod DB) applies the `init` migration cleanly.
For an **existing** database that was set up with `db push`, baseline it once so Prisma
doesn't try to recreate the tables:
```bash
npx prisma migrate resolve --applied <timestamp>_init
```

## Production notes
- **Connection pooling**: `DATABASE_URL` must be the POOLED string (Neon `-pooler` /
  PgBouncer) for serverless; `DIRECT_URL` (direct) is used only by migrations.
- **Resilience**: API routes are wrapped by `lib/api.ts` — DB-unreachable returns `503`,
  other failures `500`, logged structurally for a monitor. `GET /api/health` probes the DB.
- **Rate limiting**: `lib/rateLimit.ts` is an in-memory speed-bump; swap for Upstash
  Ratelimit (Redis) for a real multi-instance guarantee.
- **Time zone**: the daily rolls over at **00:00 UTC**.
- **Trademarks**: course names are trademarks of their owners; this project is unaffiliated
  and layouts/yardages are stylized for play. Review before any commercial launch.

## Data flow per round
1. `GET /api/daily` → today's course + holes (public, cached).
2. `POST /api/round` → start/resume the player's round for today (one per day).
3. `PATCH /api/round/[id]/hole` → submit a decision; **server resolves** and persists.
4. `POST /api/round/[id]/finish` → finalize, update streak + best score.
5. `GET /api/leaderboard` → today's top players + your rank.

## What's stubbed for MVP
- Percentiles use an estimate until there's a real daily score distribution to query.
- Course data is representative — swap in curated real numbers before launch.
- Monetization (premium gate, ads) and friends leagues are not built yet; the schema
  leaves room for them.
