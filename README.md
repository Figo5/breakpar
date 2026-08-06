# Break Par

A daily browser golf game. One real course a day, 18 holes, played shot by shot — drive, approach, then putt or scramble. Read the greens, manage the risk, and try to shoot under par.

**Live at [breakpar.xyz](https://breakpar.xyz)**

## Overview

Break Par gives you one real course a day and 18 holes. Each hole plays as a short chain of decisions: a **tee shot** that lands you in a lie (dialed / fairway / rough / trouble), an **approach** that leaves you on or around the green, and then either a **putt** (Lag / Roll it / Charge) or a **scramble** (Punch / Chip / Flop) to finish. Kick-ins tap in automatically, so a hole is just 2–3 quick decisions. Par 3s play differently — the tee shot *is* the approach — and par 5s can be reached in two for an eagle. Seeded **events** (a gust, pure greens, momentum after back-to-back birdies) and shot-by-shot **play-by-play** add texture. You get a handful of aggressive tee/approach plays per round — putts and chips are free — so spending the budget well is the skill. About 3 in 10 smart rounds break par.

## Game Modes

- **Daily** — one ranked round per UTC day, same course for everyone, with a leaderboard and streak.
- **Unlimited practice** — play any course as often as you like; no streak impact.
- **Weekly tournaments** — one course, four rounds, cumulative score against par, a cut after two rounds, and a trophy for the winner. Everyone in a tournament plays identical hole conditions each round.
- **Career** — an unlimited personal tour with four events per season, 19 recurring rivals, promotion and relegation, Tour Rating, and permanent Legacy progress.
- **Challenges** — head-to-head against a friend or a bot, with live progress during the round.
- **Friends & profiles** — follow players, see their rounds, and view public profiles at `/u/[username]`.
- **Hall of Fame** — course records and trophies for milestones and achievements.

## How the Game Is Built

The interesting part is **server-authoritative simulation**. The browser sends only a *decision*; the server resolves the outcome with a seeded RNG and stores it. A hole can't be replayed for a better result — the seed is `hash(SERVER_SEED, roundId, holeNumber)`, so each hole is deterministic and idempotent. That's the anti-cheat backbone.

Each hole is a **variable-length decision chain**: `lib/engine/shots.ts` resolves the tee shot into a lie, the approach into a green position (`lib/engine/putting.ts`: kick-in / makeable / lag / scramble), then a putt or short-game shot into the final outcome — each stage seeded per shot so it can't be re-rolled. Kick-ins auto-resolve and missed greens add a scramble decision, so the length varies (2–3 decisions, capped at 3). The client just renders the **next stage** the server returns; the server replays the decision list deterministically and writes a single result per hole on completion. Seeded **events** (`lib/engine/events.ts`) and the deterministic **play-by-play** notes (`lib/engine/notes.ts`) derive from the same per-shot seeds, so a replay reproduces the identical chain, events, and narration.

Difficulty lives in `lib/engine/shots.ts` and `lib/engine/putting.ts` (shot / green / putt tables) and `lib/engine/probabilities.ts` (outcome deltas). It's calibrated so smart course management breaks par ~36% of the time while reckless aggression scores worse and blows up more. The harness also reports a **skill gap** (strong vs mindless play) and putting feel-metrics — GIR, one-putt, three-putt and up-and-down rates. Re-run it any time you touch those numbers:

```bash
npm run engine:calibrate          # Monte Carlo: break-par %, skill gap, putting metrics
npx tsx scripts/transcript.ts     # human-readable sample holes (shot-by-shot + events)
```

## Tech Stack

Next.js (App Router) · React · TypeScript · Tailwind · Prisma + PostgreSQL · Clerk · Vercel · PostHog · Vercel Analytics

## Accounts & Streaks

No sign-in required: a round can be started instantly and an anonymous **guest** identity is minted in an httpOnly cookie. Signing in with Clerk later **adopts** that guest row, so rounds and streaks carry over. Day-streaks follow Wordle rules — a streak is only "alive" if you played today or yesterday (`isStreakAlive`), and `maxStreak` survives a miss.

## Authentication (Clerk)

Auth is handled by [Clerk](https://clerk.com/). Sign-in is **optional** — guests can play instantly and adopt their history on sign-up. The sign-in/sign-up modals show whatever methods are enabled in the Clerk Dashboard, so this is all configured there — no code changes needed. In the **production** instance under **User & Authentication**:

- **Username** → ON, set as a required identifier
- **Password** → ON
- **Email address** → OFF (or optional)
- **Social Connections (SSO)** → Google/etc. OFF

The chosen username flows straight onto the leaderboard (`upsertClerkUser` in `lib/user.ts`).

> [!IMPORTANT]
> A **custom production domain** (e.g. `breakpar.xyz`) requires Clerk **production** keys (`pk_live_…` / `sk_live_…`), not the development keys (`pk_test_…` / `sk_test_…`). Dev keys only authenticate on `localhost` / `*.accounts.dev`, so on a real domain every visitor falls back to a guest. Add the domain in Clerk, set the DNS records it gives you, then put the live keys in your host's production env vars and redeploy.
>
> Disabling email also disables email-based password recovery — keep email as an optional recovery field if you need self-serve password resets.

## Project Structure

```
app/            screens (page.tsx, play/, courses/, result/, career/, tournament/,
                challenges/, friends/, hall/, u/, how-it-works/, changelog/) + API routes (api/)
lib/engine/     shots.ts (shot chain) · putting.ts (green/putt/scramble) · events.ts · notes.ts
lib/engine/     probabilities.ts · rng.ts · resolveHole.ts · rulesets.ts · hazards.ts  ← sim core
lib/            daily.ts · scoring.ts · streak.ts · leaderboard.ts · db.ts
lib/            user.ts (guest + Clerk) · api.ts (error wrapper) · rateLimit.ts · cronAuth.ts
lib/            career/ · tournament.ts · tournamentSeed.ts · trophies.ts · hallOfFame.ts
lib/            friends.ts · challenge.ts · botPlayer.ts · oddsReveal.ts · xHandle.ts
data/courses.ts the course catalogue (seeds the DB) · data/changelog.ts
prisma/         schema.prisma · seed.ts
components/     Scorecard · HoleArt · PuttView (top-down green) · HoleMap · OpponentStrip
scripts/        calibrate.ts (Monte Carlo difficulty) · transcript.ts (sample holes)
tests/          vitest unit tests (engine, putting, events, scoring, daily)
```

## Data Flow per Round

1. `GET /api/daily` → today's course + holes (public, cached).
2. `POST /api/round` → start/resume the player's round for today (one per day).
3. `PATCH /api/round/[id]/hole` → submit the hole's decision sequence so far; **server resolves** the chain deterministically and returns the **next stage** (lie / green / putt read, the play-by-play note, any event), persisting a single result once the hole completes.
4. `POST /api/round/[id]/finish` → finalize, update streak + best score.
5. `GET /api/leaderboard` → today's top players + your rank.

## Database Migrations

Schema changes go through Prisma **migrations** (not `db push`).

```bash
npm run db:migrate            # dev: create + apply a new migration locally
npm run db:migrate:deploy     # prod: apply pending migrations (run by Vercel build)
```

Vercel's build command (`vercel.json`) runs `prisma migrate deploy` automatically on every production deploy, then idempotently upserts the static course catalogue. Preview builds never migrate or seed. A **fresh** database (e.g. a new prod DB) applies the `init` migration cleanly. For an **existing** database that was set up with `db push`, baseline it once so Prisma doesn't try to recreate the tables:

```bash
npx prisma migrate resolve --applied <timestamp>_init
```

## Production Notes

- **Connection pooling**: `DATABASE_URL` must be the POOLED string (Neon `-pooler` / PgBouncer) for serverless; `DIRECT_URL` (direct) is used only by migrations.
- **Resilience**: API routes are wrapped by `lib/api.ts` — DB-unreachable returns `503`, other failures `500`, logged structurally for a monitor. `GET /api/health` probes the DB.
- **Rate limiting**: `lib/rateLimit.ts` is an in-memory speed-bump; swap for Upstash Ratelimit (Redis) for a real multi-instance guarantee.
- **Cron auth**: `lib/cronAuth.ts` fails cron endpoints closed in production via `CRON_SECRET`.
- **Time zone**: the daily rolls over at **00:00 UTC**.
- **Trademarks**: course names are trademarks of their owners; this project is unaffiliated and layouts/yardages are stylized for play. Review before any commercial launch.

## Roadmap

Each item records the decision *and* what would make us revisit it — an open question with no trigger is just a wish.

- **Rate limiting is in-memory** (`lib/rateLimit.ts`). The bucket Map lives in one serverless instance, so it's an abuse speed-bump, not a global guarantee — a spammer spread across instances gets N× the allowance. Swap the Map for Upstash Ratelimit (Redis) keeping the same `limit()` signature. *Revisit when:* abuse actually shows up, or anything expensive sits behind a limiter.
- **Monetization (premium gate, ads) and friends leagues are not built.** The schema leaves room for them.
- **Calibration headroom is thin.** At 63 courses, with the water penalty at 0.20, smart play breaks par at 36.1% against a `[30–37%]` CI band — about 1pt of margin. Any change that makes scoring easier is calibration-sensitive, and that **includes adding courses**: an easy course nudges the aggregate up, since the main harness averages across the whole roster. *Revisit when:* the next batch lands — run `npm run engine:calibrate` before assuming, and consider whether the band itself wants re-centring rather than repeatedly squeezing under it.
- **`/api/tournament/tick` runs unauthenticated, on purpose.** It supports `CRON_SECRET` and 401s when the variable is set, but it is deliberately left unset: the route takes no input, every write is idempotent and claim-guarded, and it returns only data already public on `/tournament`. The public tournament page triggers the same lifecycle work at higher cost per request, so the endpoint adds no attack surface. *Revisit when:* the tick grows expensive or outward-facing side effects — notifications, third-party posts, anything metered — at which point set `CRON_SECRET` in Vercel and redeploy.

## Contributing

Contributions, bug reports, and feature ideas are welcome. Feel free to open an [issue](../../issues) or submit a pull request. For larger changes, please open an issue first to discuss what you'd like to change. Please run `npm test` before submitting.

## License

Released under the [MIT License](LICENSE).
