# ⛳ Break Par

> A daily browser golf game. One real course a day, 18 holes. Play each hole shot by shot — drive, approach, then putt or scramble — read the greens, manage the risk, and try to shoot under par.

### 🔗 [Play it live → breakpar.xyz](https://breakpar.xyz)

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-PostgreSQL-2D3748?logo=prisma&logoColor=white">
  <img alt="Clerk" src="https://img.shields.io/badge/Auth-Clerk-6C47FF?logo=clerk&logoColor=white">
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green">
  <a href="https://breakpar.xyz"><img alt="Live" src="https://img.shields.io/badge/Live-breakpar.xyz-22C55E"></a>
</p>

**Break Par** gives you one real course a day and 18 holes. Each hole plays as a short chain of
decisions: a **tee shot** that lands you in a lie (dialed / fairway / rough / trouble), an
**approach** that leaves you on or around the green, and then either a **putt** (Lag / Roll it /
Charge) or a **scramble** (Punch / Chip / Flop) to finish. Kick-ins tap in automatically, so a hole
is just 2–3 quick decisions. Par 3s play differently — the tee shot *is* the approach — and par 5s
can be reached in two for an eagle. Occasional seeded **events** (a gust, pure greens, momentum
after back-to-back birdies) and shot-by-shot **play-by-play** ("Drained it from 12 feet 🐦",
"Three-jacked from the fringe 😬") add texture. You only get a handful of aggressive tee/approach
plays per round — putts and chips are free — so spending the budget well is the skill. Shoot under
the course's par — about 3 in 10 smart rounds get there. There's also an **Unlimited Practice** mode
(`/courses`) to play any course as often as you like.

## 📑 Table of Contents

- [Tech Stack](#-tech-stack)
- [How the Game Is Built](#-how-the-game-is-built)
- [Getting Started](#-getting-started)
- [Game Modes](#-game-modes)
- [Accounts & Streaks](#-accounts--streaks)
- [Authentication Setup (Clerk)](#-authentication-setup-clerk)
- [Project Structure](#-project-structure)
- [Data Flow per Round](#-data-flow-per-round)
- [Database Migrations](#-database-migrations)
- [Production Notes](#-production-notes)
- [Roadmap / Stubbed for MVP](#-roadmap--stubbed-for-mvp)
- [Contributing](#-contributing)
- [License](#-license)

## 🛠 Tech Stack

Next.js (App Router) · React · TypeScript · Tailwind · Prisma + PostgreSQL · Clerk · Vercel

## 🎮 How the Game Is Built

The interesting part is **server-authoritative simulation**. The browser sends only a
*decision*; the server resolves the outcome with a seeded RNG and stores it. A hole can't
be replayed for a better result — the seed is `hash(SERVER_SEED, roundId, holeNumber)`,
so each hole is deterministic and idempotent. That's the anti-cheat backbone.

Each hole is a **variable-length decision chain**: `lib/engine/shots.ts` resolves the tee shot into
a lie, the approach into a green position (`lib/engine/putting.ts`: kick-in / makeable / lag /
scramble), then a putt or short-game shot into the final outcome — each stage seeded per shot so it
can't be re-rolled. Kick-ins auto-resolve and missed greens add a scramble decision, so the length
varies (2–3 decisions, capped at 3). The client just renders the **next stage** the server returns;
the server replays the decision list deterministically and writes a single result per hole on
completion (no schema change). Seeded **events** (`lib/engine/events.ts`) and the deterministic
**play-by-play** notes (`lib/engine/notes.ts`) derive from the same per-shot seeds, so a replay
reproduces the identical chain, events, and narration.

Difficulty lives in `lib/engine/shots.ts` and `lib/engine/putting.ts` (shot / green / putt tables)
and `lib/engine/probabilities.ts` (outcome deltas). It's calibrated so smart course management
breaks par ~30% of the time while reckless aggression scores worse and blows up more. The harness
also reports a **skill gap** (strong vs mindless play) and putting feel-metrics — GIR, one-putt,
three-putt and up-and-down rates. Re-run it any time you touch those numbers:

```bash
npm run engine:calibrate          # Monte Carlo: break-par %, skill gap, putting metrics
npx tsx scripts/transcript.ts     # human-readable sample holes (shot-by-shot + events)
```

## 🚀 Getting Started

**Prerequisites:** [Node.js](https://nodejs.org/) 18.18+, a PostgreSQL database, and a
[Clerk](https://clerk.com/) account for auth.

```bash
git clone https://github.com/Figo5/breakpar.git
cd breakpar
npm install
cp .env.example .env.local        # DATABASE_URL (pooled) + DIRECT_URL + Clerk + SERVER_SEED
npm run db:push                   # create tables (uses DIRECT_URL)
npm run db:seed                   # load courses + holes
npm run dev                       # http://localhost:3000
npm test                          # run the unit suite
```

## 💻 Local development

Don't want to provision a hosted Postgres? A `docker-compose.yml` ships a local
**Postgres 16** instance, and `scripts/setup.sh` wires everything up in one command.

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) (with Compose) and Node 18.18+.

```bash
npm install
cp .env.example .env.local        # then set the two DB URLs as below + add Clerk keys
npm run db:setup                  # start Postgres, apply schema, seed courses
npm run dev                       # http://localhost:3000
```

Point both database URLs in `.env.local` at the local container:

```dotenv
DATABASE_URL="postgresql://breakpar:breakpar@localhost:5433/breakpar"
DIRECT_URL="postgresql://breakpar:breakpar@localhost:5433/breakpar"
```

> The container exposes Postgres on **port 5433** (not the default 5432) so it
> won't clash with a system Postgres. Credentials are `breakpar` / `breakpar`.

**What `npm run db:setup` does** (it's idempotent — safe to re-run):

1. `docker compose up -d db` and waits for the container to report **healthy**
   (the wait budget covers a cold image pull + first-boot `initdb`).
2. Applies the schema: `prisma migrate deploy` when committed migrations exist
   (the default here), or falls back to `prisma db push` on a checkout that has
   no `prisma/migrations/`.
3. Seeds the course catalogue (`npm run db:seed`).

**Resetting the local DB** — ⚠️ destructive:

```bash
npm run db:reset                  # prompts for confirmation, then wipes + rebuilds
```

`db:reset` runs `docker compose down -v`, which **deletes the `breakpar-pgdata`
volume** and every local round/user/leaderboard row before re-running setup. It
only ever touches the local docker volume, but it's irreversible, so it asks you
to type `reset` first. In CI/scripts, skip the prompt with `FORCE=1 npm run db:reset`.

To stop the database without deleting data: `docker compose stop db`.

## 🏌️ Game Modes

- **Daily** — one ranked round per UTC day, same course for everyone, leaderboard + streak.
- **Unlimited practice** (`/courses`) — play any course as often as you like; no streak impact.

## 👤 Accounts & Streaks

No sign-in required: a round can be started instantly and an anonymous **guest** identity
is minted in an httpOnly cookie. Signing in with Clerk later **adopts** that guest row, so
rounds and streaks carry over. Day-streaks follow Wordle rules — a streak is only "alive" if
you played today or yesterday (`isStreakAlive`), and `maxStreak` survives a miss.

## 🔐 Authentication Setup (Clerk)

Auth is handled by [Clerk](https://clerk.com/). Sign-in is **optional** — guests can play
instantly and adopt their history on sign-up (see [Accounts & Streaks](#-accounts--streaks)).

**Username + password only (no email, no social login):** the sign-in/sign-up modals show
whatever methods are enabled in the Clerk Dashboard, so this is all configured there — no code
changes needed. In your **production** instance under **User & Authentication**:

- **Username** → ON, set as a required identifier
- **Password** → ON
- **Email address** → OFF (or optional)
- **Social Connections (SSO)** → Google/etc. OFF

The chosen username flows straight onto the leaderboard (`upsertClerkUser` in `lib/user.ts`).

> [!IMPORTANT]
> A **custom production domain** (e.g. `breakpar.xyz`) requires Clerk **production** keys
> (`pk_live_…` / `sk_live_…`), not the development keys (`pk_test_…` / `sk_test_…`). Dev keys
> only authenticate on `localhost` / `*.accounts.dev`, so on a real domain every visitor falls
> back to a guest. Add the domain in Clerk, set the DNS records it gives you, then put the live
> keys in your host's production env vars and redeploy.
>
> Disabling email also disables email-based password recovery — keep email as an optional
> recovery field if you need self-serve password resets.

## 📁 Project Structure

```
app/            screens (page.tsx, play/, courses/, result/) + API routes (api/)
lib/engine/     shots.ts (shot chain) · putting.ts (green/putt/scramble) · events.ts · notes.ts
lib/engine/     probabilities.ts · rng.ts · resolveHole.ts  ← sim core
lib/holeRead.ts player-facing reads (hole cues, lie/putt reads, aggression budget)
lib/            daily.ts · scoring.ts · streak.ts · leaderboard.ts · db.ts
lib/            user.ts (guest + Clerk) · api.ts (error wrapper) · rateLimit.ts
data/courses.ts the course catalogue (seeds the DB)
prisma/         schema.prisma · seed.ts
components/     Scorecard · HoleArt · PuttView (top-down green)
scripts/        calibrate.ts (Monte Carlo difficulty) · transcript.ts (sample holes)
tests/          vitest unit tests (engine, putting, events, scoring, daily)
```

## 🔄 Data Flow per Round

1. `GET /api/daily` → today's course + holes (public, cached).
2. `POST /api/round` → start/resume the player's round for today (one per day).
3. `PATCH /api/round/[id]/hole` → submit the hole's decision sequence so far; **server resolves**
   the chain deterministically and returns the **next stage** (lie / green / putt read, the
   play-by-play note, any event), persisting a single result once the hole completes.
4. `POST /api/round/[id]/finish` → finalize, update streak + best score.
5. `GET /api/leaderboard` → today's top players + your rank.

## 🗄 Database Migrations

Schema changes go through Prisma **migrations** (not `db push`).

```bash
npm run db:migrate            # dev: create + apply a new migration locally
npm run db:migrate:deploy     # prod: apply pending migrations (run by Vercel build)
```

Vercel's build command (`vercel.json`) runs `prisma migrate deploy` automatically on every
production deploy, then idempotently upserts the static course catalogue. Preview builds
never migrate or seed. A **fresh** database (e.g. a new prod DB) applies the `init` migration cleanly.
For an **existing** database that was set up with `db push`, baseline it once so Prisma
doesn't try to recreate the tables:

```bash
npx prisma migrate resolve --applied <timestamp>_init
```

## 🏭 Production Notes

- **Connection pooling**: `DATABASE_URL` must be the POOLED string (Neon `-pooler` /
  PgBouncer) for serverless; `DIRECT_URL` (direct) is used only by migrations.
- **Resilience**: API routes are wrapped by `lib/api.ts` — DB-unreachable returns `503`,
  other failures `500`, logged structurally for a monitor. `GET /api/health` probes the DB.
- **Rate limiting**: `lib/rateLimit.ts` is an in-memory speed-bump; swap for Upstash
  Ratelimit (Redis) for a real multi-instance guarantee.
- **Time zone**: the daily rolls over at **00:00 UTC**.
- **Trademarks**: course names are trademarks of their owners; this project is unaffiliated
  and layouts/yardages are stylized for play. Review before any commercial launch.

## 🧭 Roadmap / Stubbed for MVP

- Percentiles use an estimate until there's a real daily score distribution to query.
- Course data is representative — swap in curated real numbers before launch.
- Monetization (premium gate, ads) and friends leagues are not built yet; the schema
  leaves room for them.

## 🤝 Contributing

Contributions, bug reports, and feature ideas are welcome! Feel free to open an
[issue](../../issues) or submit a pull request. For larger changes, please open an issue first
to discuss what you'd like to change. Please run `npm test` before submitting.

## 📄 License

Released under the [MIT License](LICENSE).
