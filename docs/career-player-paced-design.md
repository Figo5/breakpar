# Career Mode — Player-Paced Design (authoritative for Career v1 cadence)

Status: **live, with the four-round event amendment implemented after launch.**
The long-horizon Legacy scale and Candidate H remain frozen. Database invariants,
multi-season and Championship flows, non-Career isolation, and responsive UI
remain authoritative.

## 0. Scope and supersession

This document **supersedes the synchronized-cadence sections** of
`Career-Mode-Design-Doc-v5.md` and of `docs/career-technical-design.md`.

Specifically superseded: Career World ownership by enrollment date, shared human
cohorts, day-one formation windows, event unlock days 1/2/4/6, seven-day season
deadlines, calendar-driven cron progression, real-time no-shows, calendar
inactivity and relegation-for-absence, automatic time-based next-season
enrollment, and cross-human Championship qualification coordination.

**Still authoritative and preserved unchanged:**

- `docs/career-formula-freeze.md` — the frozen scoring, ability, tier-scaling,
  event-points, best-three-of-four, ranking, Tour Rating, and Legacy *award*
  definitions. (One movement sub-rule is retired; see §12. The frozen package
  itself is never edited — a new version id is introduced.)
- `docs/career-settlement-recovery.md` — claims, leases, fencing tokens,
  immutable snapshots, canonical hashing, deterministic effect keys, invisible
  staging, atomic publication, idempotent retry, MANUAL_REVIEW, and the rule
  that **read paths never mutate lifecycle**. All of it survives the pivot.
- The real Break Par hole engine, course data, deterministic round seeds, and
  the `/play` integration.

Daily Challenge, Weekly Tournament, Challenges, and Unlimited practice are
untouched by this design.

## 1. Product model in one paragraph

A player owns a private, permanent **Career Journey**. A Journey contains an
unbounded sequence of **seasons**. Each season is four events against a locked
field of the player plus nineteen named bots. Every event is four cumulative
rounds, with one attempt per numbered round and deterministic resume. All four
events are playable immediately, in any order. When the fourth event is finished
the season settles deterministically — movement, Tour Rating, Legacy, history —
and the next season becomes playable in the same transaction. Every
fourth settled season unlocks an optional Championship the player may take at any
later time. Nothing waits on a clock; nothing is lost by not playing.

## 2. The personal Career aggregate (Q1, Q2)

**Decision: `CareerWorld` is repurposed as the personal, immutable Journey.** It
is not deleted and not reduced to a bot namespace.

Rationale: every downstream aggregate already hangs off a world
(`CareerCohort` → `CareerCompetition` → `CareerFieldSlot`/`CareerResult` →
finals; plus profiles, bot identities, championships). Repurposing the root
preserves the entire proven settlement machinery, which this pivot is explicitly
directed not to rewrite. Replacing the root would force a rewrite of formation,
event settlement, season settlement, championship, effect keys, and every test.

Changes to the model:

| Field | Today | Player-paced |
|---|---|---|
| `worldKey` | Eastern enrollment date `YYYY-MM-DD`, shared by all players who joined that day | Personal stable key `journey:{userId}`, unique per player |
| `seasonLengthDays` | 7 | removed |
| ownership | many profiles per world | **exactly one profile per world** |

Consequences:

- `parseWorldKey`/`careerSeasonWindow` (civil-date parsing and 7-day windows) are
  deleted. No Career date arithmetic remains anywhere.
- The 30-identity bot roster stays generated deterministically from the world
  key, so it is now **per player**. Recurring rivals persist across that
  player's whole career, which is a product improvement: your rivals are yours.
- `CareerCohort`'s unique `[worldId, seasonNumber, tier]` becomes, in practice,
  "one season per journey per season number" — the shared-cohort semantics
  disappear without a schema change to the key.
- `CareerCohortMember` retains exactly one row (the human, slot 1). It is kept
  rather than dropped because `CareerEventEntry.memberId` and the formation
  slot-assignment path both depend on it; keeping it is strictly cheaper than
  removing it.

**Ownership rule:** a Journey is created once per user, on first Career entry,
and is immutable thereafter. There is no enrollment window, no date ownership,
and no way for a second player to enter another player's Journey.

## 3. Identities (Q3, Q4)

- **Journey**: `CareerWorld.id`, keyed `journey:{userId}` (unique).
- **Season**: `CareerCohort` identified by `(worldId, seasonNumber, tier)`.
  `seasonNumber` starts at 1 and increments by exactly one per settlement.
  `tier` is the player's tier at the moment the season is created and never
  changes for that season.
- **Event**: `CareerCompetition` identified by `(cohortId, eventNumber)`,
  `eventNumber ∈ {1,2,3,4}` (existing unique constraint).
- **Championship**: `CareerChampionship` identified by `(worldId, cycleNumber)`,
  `cycleNumber = settledSeasons / 4` (existing unique constraint).

**Seed derivation (unchanged in shape, now personal):**

```
field/event seed : career:{worldKey}:{seasonNumber}:{tier}:event{eventNumber}
human round seed : {eventSeed}:round{roundNumber}
per-slot seed    : {eventSeed}:round{roundNumber}:slot{slotId}
championship     : career:championship:{worldKey}:c{cycleNumber}:slot{slotNumber}
```

Because `worldKey` is now `journey:{userId}`, seeds are unique per player,
deterministic, and reproducible. Seed identity is bound to the immutable lock
revision, so a refresh, abandon, or retry can never produce a different seed.

## 4. Immediate bot-filled field creation (Q5, Q6)

**Decision: the field is created and locked in the same transaction that creates
the season, and all four events' bot cards are materialized at that moment.**

This is what `formation.ts` already does at lock time — it simulates every bot's
round for all four competitions and writes `CareerLockRevision` + 20
`CareerFieldSlot` + 20 `CareerResult` rows per event. The pivot removes the
*trigger condition* (Event-2 unlock time) and the provisional-bot/human-backfill
logic, not the mechanism.

Sequence at season creation:

1. Create the cohort and four `CareerCompetition` shells (state `ACTIVE`, no
   unlock gate, no deadline).
2. Assign 19 bots from the Journey roster via the existing
   `assignCareerBotSlots` (tier-scaled ability mix preserved, recurring rivals
   preferred).
3. Human takes slot 1; bots take slots 2–20.
4. Materialize four independently seeded rounds for each bot and store the
   cumulative score for all 4 events through the real engine.
5. Publish atomically with deterministic effect keys (existing Boundary A).

Why eager, not lazy: it is already implemented and proven; it makes every event
independently settleable the instant the human finishes it; and it guarantees the
field is immutable from the first shot, which is the anti-tamper property the
frozen design depends on.

**Integrity rule (new, and it matters):** materialized bot scores for an event
the player has **not yet completed** must not be exposed by any read. Knowing you
need −6 to win changes aggression decisions and is a real competitive advantage,
so this is an anti-exploit rule, not merely a UX preference. The read layer
reveals an event's field only once the player's entry for that event is
complete. Settlement is unaffected.

## 5. Completion-driven lifecycle (Q7, Q8, Q9, Q10, Q18)

```
enter Career
  └─ Journey created (once)
      └─ Season N created + field locked + 4 events ACTIVE   [atomic]
          ├─ player plays event i (any order, four numbered cards)
          │    └─ finish round 4 → entry completed          [write path]
          │         └─ event i finalized: ACTIVE → ENDED → SETTLED
          ├─ … four times …
          └─ on the 4th event settling:
               cohort ACTIVE → ENDED
                 └─ season settlement (fenced, atomic):
                      movement · rating · Legacy · history
                      · Season N+1 created + field locked
                      · every 4th season: Championship unlocked
```

**Q7 — event publication.** Unchanged from today's proven path:
`CareerEventSettlementService.settle` (claim → snapshot → calculateAndStage →
publish → markRetryable) writing one immutable `CareerEventFinal`. The only
change is eligibility: an event becomes `ENDED` when **the human's entry is
complete** (bots are already materialized, so the field is complete), instead of
when a deadline passes.

**Q8 — fourth event triggers the season.** After an event settles, the cohort is
checked: if all four competitions are `SETTLED`, the cohort transitions
`ACTIVE → ENDED`, making it claimable by the SEASON aggregate. This is exactly
what `CareerSeasonSettlementService.closeDue` already does — **minus the deadline
condition**, which is simply deleted.

**Q9 — idempotent collapse.** Already guaranteed and unchanged:
- duplicate finishes → `finishCareerRound` returns `replayed: true` (the round is
  claimed by `updateMany where completed:false`);
- duplicate settlements → engine returns `already-settled` / `already-claimed`;
- duplicate effects → globally unique `effectKey` with payload-hash conflict
  detection.

**Q10 — next season exactly once.** Season N+1 is created **inside the season
settlement publish transaction** (as `ensureCareerCohort` already is today).
Because that transaction is fenced, atomic, and idempotent, the next season is
created exactly once even under concurrent retries. `CareerProfile.currentSeason`
advances in the same transaction, which is also the anti-exploit guard in §7.

**Q18 — who drives settlement.** Player actions drive the primary flow; the
scheduler is demoted to recovery. This does **not** violate the read-path rule:
finishing a round is already a `POST` write request, and settlement is triggered
from that write path, never from a `GET`. To keep the finish request fast and
decoupled, the recommended shape is:

1. commit the round + entry + event result (must succeed — it is the player's
   score);
2. then attempt event finalization and, if it is the fourth, season settlement;
3. treat step 2 failure as **non-fatal to the response** — it is recorded and the
   repair scan (§9) completes it. The player never loses a score because
   settlement hiccupped.

## 6. Championships (Q11, Q12)

**Unlock:** after every four *settled* regular seasons, i.e. when
`settledSeasons % 4 === 0`, cycle `settledSeasons / 4`.

**Q11 — relationship to the next season. Decision: optional and parallel.** An
unlocked Championship never blocks, gates, or delays the next regular season.
Season N+1 is created at settlement regardless. The Championship remains
available indefinitely and may be played at any later time. One valid attempt,
enforced by `CareerChampionshipResult` unique `(championshipId, slotNumber)` plus
unique `roundId`.

**Championship settlement is completion-driven too, and never forced.** A
Championship settles when the player finishes their round (the bot field is
already materialized, so the field completes at that instant). A Championship the
player never plays **never settles** and remains permanently available — it is not
failed, expired, or converted to an absence.

That makes the timing of the two frozen Legacy awards a real decision:

- **`championshipQualification` (35) publishes at unlock**, inside the fourth
  season's settlement transaction, because it is earned by qualifying, not by
  playing. It can never be stranded by an unplayed Championship.
- **`championshipWin` (100) and the trophy publish at Championship settlement**,
  i.e. only if the player actually plays and wins.

So "missing a Championship costs nothing" is literally true: the player forgoes
only the win award they did not contest. This also removes the last path by which
an unplayed competition could have produced a no-show.

**Q12 — qualification with one human.** The frozen cross-tier pass-down builder
(`championshipField`: Pro top-six → four Pro event winners → Challenger top-two →
elite-bot fill) presumed a shared population and **cannot survive** a personal
field: there is no population to rank. It is retired for Career v1 personal
Championships.

Replacement: **the player qualifies by completing the four-season cycle *and*
being at Challenger or Pro tier at the moment the cycle completes** (product
decision, approved — see §18.2). The field is the player plus 19 elite Ace-level
bots drawn from the Journey roster, ordered deterministically. Prestige comes
from the Ace opposition — which is a genuinely hard field — not from out-ranking
absent humans.

**Consequence of the tier gate, which the implementation must handle
explicitly:** a player who completes a four-season cycle while still at Local
does **not** unlock a Championship and therefore does **not** receive the
`championshipQualification` Legacy award (35). Two rules follow:

- No Championship shell is created for an ungated cycle. `cycleNumber` still
  advances with settled seasons, so a later cycle can unlock normally once the
  player reaches Challenger; cycles are not retroactively granted.
- The UI must state the requirement plainly on the Career dashboard ("Reach
  Challenger to contest the Championship"), so an ungated cycle reads as a goal
  rather than as a missing reward.

`CareerQualificationContribution` and the exactly-20 cross-cohort coordinator
therefore become obsolete (§11). Championship *play* and *settlement*
(`championshipPlay.ts`, `championshipSettlement.ts`) are unchanged: same Ace
materialization, same ranking, same Legacy/trophy publication, same invariant
that Championships emit no movement/inactivity/rating/enrollment effects.

**Open product question (§17.1):** whether to gate entry on reaching
Challenger/Pro. This design recommends *no gate* — gating punishes newer players
and adds a dead-end state — but it is a product call.

## 7. One attempt and anti-reroll rules

| Rule | Enforcement |
|---|---|
| One attempt per numbered event round | `CareerEventRound` unique `(entryId, roundNumber)`; `roundId` resumes exactly |
| Resume returns the same round | `startCareerEventRound` returns the existing `entry.roundId` if present |
| Refresh/abandon cannot reroll the seed | Seed is derived from the immutable lock namespace and persisted on `Round.seedKey`; it is never recomputed per request |
| < 4 events cannot settle a season | Cohort only reaches `ENDED` when all four competitions are `SETTLED` |
| Cannot start season N+1 early | Season N+1 only exists after N's settlement publish; `profile.currentSeason` advances in that same transaction |
| Repeated settlement is idempotent | Engine claim + `already-settled` + unique effect keys |
| Repeated "next season" returns the same season | `ensureCareerCohort` is an advisory-locked upsert on `(worldId, seasonNumber, tier)` |
| One Championship attempt | Unique `(championshipId, slotNumber)`; unique `roundId` |
| Opponent scores hidden until you finish the round | Read-layer frontier from §4 and §14a |
| Starting or resuming a round reveals nothing | Frontier counts completed rounds only (§14a) |
| A bot round card cannot be duplicated or rewritten | Unique `(lockRevisionId, slotId, roundNumber)`; written once at field lock |

Unlimited play multiplies *volume*, not *attempts*. Every one-attempt guarantee
above is a database constraint or a fenced transaction, not a UI affordance.

## 8. Inactivity removed (Q15)

Real-time inactivity is deleted outright. It has no replacement because it has
no meaning: a season cannot be "missed" — it waits.

- `applyInactivity` is removed from the season settlement path.
- The `active` concept collapses: a settling season is always fully complete, so
  every settled season is active by construction. `activeSeasonCompletion`
  Legacy is therefore awarded on every settled season.
- Rolling movement evidence gains exactly one entry per settled season, which is
  precisely the window semantics Candidate-H was calibrated for.
**Real-time no-shows are deleted with it.** In the old model an unfinished human
entry became a no-show once the deadline passed, and settlement converted it
(`noShow = true`, `relativeToPar = null`, rank null, 0 points). With no deadline
anywhere in Career v1, a human competition has only two states — unfinished (not
yet settleable) or finished (settled with a real score). A human no-show is
therefore **unreachable**, for regular events *and* for Championships (§6: an
unplayed Championship simply never settles). Bots are always materialized and
always complete. The no-show conversion logic is removed from the event, season,
and Championship paths.

The `noShow` column is retained as a vestigial, always-false field so the
existing result shape and its tests stay stable; nothing may write `true` to it.
Dropping it is an acceptable alternative in the pivot migration (§18.5).

- No relegation, tier change, or penalty may ever be caused by elapsed time.
- `consecutiveInactiveSeasons` becomes permanently 0. Retain the column (harmless,
  keeps history readable) or drop it in the pivot migration; either is safe.
- `CareerProfile.status` (`ACTIVE`/`PAUSED`/`RETIRED`) is retained **only** as an
  account-level archival flag. It must not affect ordinary progression, since
  pausing is meaningless when nothing expires.

## 9. Scheduler and repair (Q19)

The cron no longer drives progression. `runCareerTick` is rewritten as a
**recovery scan** that finds and completes work the player's write path failed to
finish:

- events whose human entry is complete but which are not `SETTLED`;
- cohorts whose four events are all `SETTLED` but which are not `SETTLED`;
- settled seasons with no successor season;
- unlocked Championships whose bot field is unmaterialized;
- ENDED Championships awaiting settlement;
- stale claims / `FAILED_RETRYABLE` attempts eligible for retry.

All calendar predicates (deadline passed, unlock day reached, season window
elapsed) are deleted. The cron cadence stays as-is (it is now a safety net, so
frequency is not correctness-critical); the Weekly Tournament cron is untouched.

`lib/career/repair.ts` keeps its exact contract — cheap read-only detection plus a
**nonblocking** enqueue, never synchronous settlement in a `GET`. Only its
predicates change, to the list above.

`lib/career/reconcile.ts` and `scripts/career-ops.ts` survive essentially intact:
census counters, read-only invariant checks, and the single bounded dry-run-default
`careerManualRetry` remain correct under the new cadence.

## 10. API changes (Q12 surface, §13 UI needs)

| Route | Change |
|---|---|
| `POST /api/career/enroll` | Retained. Creates the Journey + Season 1 + locked field on first call; idempotent thereafter. No enrollment window. |
| `GET /api/career/state` | Retained. Drops all `unlocksAt`/`deadlineAt`/"locks tomorrow" semantics; adds season completion progress (`completedEvents`/4), `settledSeasons`, and `championshipUnlocked`. Keeps the nonblocking repair trigger. |
| `GET /api/career/event/[id]/leaderboard` | Retained, with the §4 reveal rule: opponents hidden until the player's entry is complete. |
| `GET /api/career/season/standings` | Retained unchanged (reads `CareerSeasonHistory`). |
| `GET /api/career/championship` | Retained; qualification display switches from cross-tier sources to "cycle complete". |
| `POST /api/round` `{ careerEventId }` | Retained as the single play entry. No second play surface. |
| **New** `POST /api/career/season/advance` | *Optional.* An explicit idempotent "settle now / continue" write endpoint if the UI wants a deliberate transition rather than automatic settlement on the fourth finish. Must reuse the same settlement service. |
| `GET /api/career/tick` | Retained, `CRON_SECRET`-gated, now recovery-only. |

## 11. Tables and services: retain / simplify / replace / remove (Q16, Q17)

**Retain unchanged:** `CareerProfile`, `CareerBotIdentity`, `CareerCompetition`,
`CareerLockRevision`, `CareerFieldSlot`, `CareerResult`, `CareerEventFinal`,
`CareerSeasonSettlement`, `CareerSeasonHistory`, `CareerRatingHistory`,
`CareerLegacyLedger`, `CareerTrophy`, `CareerChampionship`,
`CareerChampionshipSlot`, `CareerChampionshipResult`, `CareerSettlementAttempt`,
`CareerStagedEffect`, `CareerCommittedEffect`, `CareerOutbox`.

**Repurpose:** `CareerWorld` → personal Journey (§2).

**Simplify:** `CareerCohort` (drop date/window semantics; it is now a personal
season), `CareerCohortMember` (exactly one human row).

**Remove / obsolete:**
- `CareerSeason` — a shared calendar season with `startsAt`/`endsAt`/
  `championshipDue`. Nothing in the player-paced model needs it; the cohort *is*
  the season.
- `CareerQualificationContribution` — cross-cohort Championship coordination,
  replaced by the personal cycle counter (§6).
- `CareerEnrollment` — next-season enrollment is now implicit in settlement.
  Keep only if an explicit audit trail of tier-at-season-start is wanted;
  otherwise drop (`CareerSeasonHistory` already records tier and nextTier).

**Services:**

| Module | Disposition |
|---|---|
| `canonical.ts`, `effectKeys.ts`, `settlementEngine.ts` | unchanged |
| `botRoster.ts`, `rules.ts`, `simulator.ts` | unchanged (new formula id in §12) |
| `formulaBundle.ts` | **add** `career-v2-player-paced`; never edit v1 |
| `world.ts` | simplify — personal Journey creation; delete `careerSeasonWindow`, date parsing, enrollment gating |
| `formation.ts` | simplify — lock at season creation; delete provisional-bot/human-backfill and the Event-2 trigger |
| `eventPlay.ts` | near-unchanged — drop unlock-time gating |
| `eventSettlement.ts` | unchanged math; eligibility becomes completion-driven |
| `seasonSettlement.ts` | remove inactivity + human movement cap; everything else intact |
| `championship.ts` | replace qualification source (personal cycle); keep field assembly + publication |
| `championshipPlay.ts` | unchanged |
| `championshipSettlement.ts` | settle on player completion instead of deadline close; **stop emitting the `championshipQualification` award** (it moves to season settlement, §6); keep ranking, win award, trophy, and the no-movement/rating invariant |
| `scheduler.ts` | rewrite as recovery scan |
| `repair.ts` | new predicates, same contract |
| `reconcile.ts`, `read.ts` | minor updates for new state shape |

## 12. Movement: what survives, what dies (Q13, Q14)

Both answers are settled by the code, not by opinion.

**Q13 — Candidate-H rolling movement survives unchanged.**
`activeSeasonPercentile(activeFieldSize, activeRank)` ranks against the **full
active field**, humans and bots alike. With one human in a 20-competitor field
the percentile is `(20 − rank) / 19` — a well-distributed, meaningful signal.
Rolling window 2, promote ≥ 0.65 with each season ≥ 0.58, relegate ≤ 0.32,
promotion carry `0.5 + 0.25·(prior − 0.5)`, Local floor and Pro ceiling: **all
retained exactly.**

**Q14 — the human movement cap is removed, because it is provably inert.**
`humanMovementLimit(activeHumans, {model:"percentage-cap", min:4, scale:0.2, max:40})`
evaluates, for one human, to `min(40, max(4, ceil(0.2 × 1))) = 4`. The cap is 4
against a population of 1. It can never bind. Retaining it would leave dead code
implying a constraint that cannot exist, and would mislead every future reader of
the settlement path.

Therefore `boundHumanMovement` and the cap are dropped from the season path, and
the new formula package sets `humanMovementLimitModel: "none"`.

**Versioning rule (important for auditability):** settlement snapshots pin
`formulaVersion`, and `career-v1-freeze-candidate` is referenced by already-committed
local snapshots. It must **not** be edited in place. Introduce
`career-v2-player-paced`, identical to v1 except `humanMovementLimitModel: "none"`
and the recalibrated Legacy milestones of §13. Old snapshots keep resolving v1;
new settlements pin v2.

## 13. Legacy and Tour Rating under unlimited play (Q20)

**Tour Rating is already volume-neutral and needs no change.** It is best-six-of-eight
over a rolling window of recent seasons with tier multipliers (Local 1.0 /
Challenger 1.5 / Pro 2.25). Playing more seasons cannot inflate it; only playing
*better* can. Championships are excluded. Careers of different lengths stay
comparable. **Retained exactly.**

**Legacy is cumulative and is *supposed* to reward longevity** — the pivot does
not change that, and per-award values stay frozen. Only the milestone display
scale required long-horizon validation.

### Iteration 8 long-horizon validation — PASS

The reproducible run in
[`career-player-paced-simulator-report.md`](./career-player-paced-simulator-report.md)
uses the real-engine score bank and the pinned `career-v2-player-paced` package:
200 deterministic careers per Rusty/Scratch/Ace band, 500 immediately settled
seasons each, one human plus nineteen tier-scaled named bots, no inactivity, and
every unlocked Championship played immediately. That is **600 careers and
300,000 settled seasons**. Balanced human tendency is held constant to isolate
ability; bot tendencies remain their persistent roster identities.

Legacy distributions (P25 / median / P75):

| Ability | S10 | S25 | S50 | S100 | S250 |
|---|---:|---:|---:|---:|---:|
| Rusty | 140 / 175 / 225 | 395 / 460 / 550 | 835 / 960 / 1,044 | 1,750 / 1,851 / 2,037 | 4,510 / 4,743 / 4,960 |
| Scratch | 225 / 285 / 339 | 665 / 745 / 846 | 1,377 / 1,501 / 1,681 | 2,863 / 3,096 / 3,310 | 7,364 / 7,740 / 8,079 |
| Ace | 270 / 339 / 396 | 786 / 890 / 985 | 1,574 / 1,740 / 1,843 | 3,280 / 3,484 / 3,676 | 8,408 / 8,687 / 8,980 |

The provisional ladder is therefore **frozen unchanged**:

| Milestone | Legacy | Simulated median seasons (Rusty / Scratch / Ace) |
|---|---:|---:|
| Club Regular | 250 | 15 / 9 / 8 |
| Tour Veteran | 1,000 | 53 / 33 / 29 |
| Established Pro | 2,500 | 133 / 81 / 72 |
| Tour Legend | 5,000 | 264 / 164 / 144 |
| Hall of Fame | 10,000 | ~520 / 323 / 289 |
| Immortal | 25,000 | ~1,300 / ~805 / ~715 |

The final two Rusty/Immortal estimates extrapolate only to communicate scale:
the report records exact reach through season 500, where 21.5% of Rusty careers
had reached 10,000 and no tested career had reached 25,000. The thresholds are
well spaced, reward longevity without compressing strong careers into the same
band, and leave the final tier rare but reachable in an intentionally unlimited
mode.

Milestones are display/prestige only. Per the product decision, **no global
Legacy leaderboard** is added — Legacy is a personal, permanent record.

### Progression recommendation — retain Candidate H unchanged

The perfect-play browser case can reach Pro after season 3, but that is an
extreme upper bound, not typical pacing. In the long-horizon run:

| Ability | Pro by S10 | Pro by S25 | Median seasons to Pro | Mean / median first Championship | Pro survival |
|---|---:|---:|---:|---:|---:|
| Rusty | 7.0% | 21.5% | 84 | 21.9 / 16 | 67.5% |
| Scratch | 36.0% | 78.5% | 14 | 7.6 / 4 | 82.5% |
| Ace | 61.5% | 95.0% | 9 | 6.2 / 4 | 85.9% |

Relegations occurred in 0.065 / 0.108 / 0.104 of all Rusty/Scratch/Ace seasons.
The higher Scratch/Ace frequency reflects spending far more seasons above the
Local floor, not weaker results. Candidate H still separates skill, lets mastery
climb quickly, and gives ordinary strong play a multi-season journey. Ace median
9 is one season beyond the earlier approximate 4–8 target, but unlimited,
no-wait play makes that modest delay preferable to a formula retune that would
also accelerate weak careers. **No formula change is recommended or applied.**

### Tour Rating volume neutrality — numerically confirmed

An eight-season recent-form vector produced Tour Rating **750.00**. Prepending
192 arbitrary older seasons produced **750.00** again: difference **0.00**.
Only the latest eight regular seasons enter the best-six calculation, so career
volume cannot inflate Tour Rating. Championships remain excluded.

## 14. UI state changes

**Removed language and states:** "forming", "locks tomorrow", "opens on <date>",
countdowns, deadlines, "waiting for other players", inactivity warnings.

**New states:**

- **Not enrolled** → single "Start your Career" CTA.
- **Season in progress** → four event cards, all playable now, each showing
  *not started* / *round n of 4 (resume)* / *complete (cumulative score)*; a
  season progress indicator `n/4`; opponents hidden per §4 until all four rounds
  of an event are finished.
- **Season complete, settling** → brief transitional state; must be safe to
  refresh (settlement is idempotent).
- **Season settled** → result summary (rank, points, movement, rating delta,
  Legacy earned) with "Start Season N+1" leading straight into a ready field.
- **Championship unlocked** → a persistent optional entry point, clearly marked
  as never expiring and never blocking the regular season.
- **Event finished / season history** → immutable results.

Existing responsive Career visual system, `CareerChrome`, and the `/play`
integration are preserved.

## 14a. The visibility frontier

Hiding a rival's score is an anti-exploit rule, not a presentation choice:
knowing the number to beat changes how a player attacks a hole. But hiding the
*field* was never part of that rule, and hiding everything until an event ended
made a live season feel empty. The frontier below is the smallest thing that
keeps the anti-exploit guarantee while making the season legible throughout.

**The frontier is always the viewer's own play — never what exists in the
database.** Bot cards are materialized at field lock (§4), so "does a result
exist" is useless as a visibility test; every rule here keys off the viewer's
completed rounds and completed events.

### Pre-event season standings

All twenty competitors are listed from the moment the field locks, named, with
zero events completed and **no rank at all** — `—`, not a fabricated "1st of 20".
The season standings link is available from the dashboard immediately.

### The event-by-event frontier (season table)

An event is revealed to the season table only once the viewer has completed
**all** of its rounds. A revealed event is revealed for the entire twenty-player
field; an unrevealed event is revealed for nobody.

Provisional standings are computed over the revealed events only. An unrevealed
event is **absent from the maths**, never scored as zero, so it cannot drag a
position down — and because the frontier applies identically to every rival, the
comparison stays fair at every stage. Best-three still governs: with one event
revealed the best one counts, with four the best three count. After the fourth
event the displayed table is the immutable final standings, taken verbatim from
`careerSeasonStandings` rather than recomputed, so the provisional view can never
disagree with the settled one. Historical settled seasons are unchanged.

### The round-by-round frontier (event leaderboard)

Before round one: the field and rival names are visible, every score is not.
After round *n*: the whole field's **cumulative** score through round *n* is
shown, with rounds *n+1* onward sealed. Event **points** are published only when
the event is final — a provisional points number would read as a result.

Starting or resuming a round reveals nothing. Only completing it moves the
frontier, so abandoning a round mid-way cannot be used to peek.

### Immutable bot round snapshots

The event total in `CareerResult` is the SUM of four deterministic cards.
`CareerBotRoundResult` stores those cards — one row per
`(lockRevision, slot, roundNumber)`, enforced by a unique index — generated once
during field formation from the pinned formula bundle. Nothing divides a total
by four, invents a split, or re-simulates from the current bundle at read time.

`lib/career/botRounds.ts` owns the single seed formula
(`{seedNamespace}:round{n}:slot{id}`) so formation and the backfill cannot drift.
Events formed before this table existed can be reconstructed exactly from their
own pinned lock revision — stored seed namespace, per-slot ability and tendency,
and the formula package the lock was published under — and
`scripts/career-backfill-bot-rounds.ts` writes cards **only** when every rebuilt
bot total equals the total already stored. An event that fails that check is
reported and left untouched: its leaderboard simply stays sealed until the player
completes every round, at which point the immutable total is used. Grandfathered
one-round events are unaffected, since round one *is* the whole event.

### Legacy ledger presentation

`/career/legacy` renders `CareerLegacyLedger` directly. Historical awards are
never recalculated from today's formulas — the row is the record. Entries are
ordered `(createdAt, id)` so the same ledger always reads back identically, and
each carries a running balance that reconciles to the displayed total.

Award types map to player-facing words in one place (`lib/career/legacy.ts`); an
unrecognised future type degrades to a readable label rather than leaking a
storage key. The prestige ladder of §13 supplies the title and next threshold.

Reads are account-scoped by construction: the profile is resolved from the
session and `GET /api/career/legacy` takes no id, so no other Journey's ledger is
addressable. The page performs no writes.

**Legacy is permanent and never decreases**, and the UI states so. That rule is
not enforced by hiding data: a negative row, which cannot occur by design, is
displayed honestly and reported through `invariantViolations` for tests and
diagnostics.

## 15. Migration strategy (Q21, Q22) — implemented

**Final local state:**
- `git ls-tree main -- prisma/migrations | grep career` → **none on `main`**.
- `git ls-files prisma/migrations | grep career` → **untracked; not in the git index at all**.
- `npx prisma migrate status` → **12 migrations found, database up to date**.

The unshipped Career migration history was consolidated. Career now has one
additive schema migration (`20260727000710_add_career_mode`) and one additive
filtered-index migration (`20260727120000_career_partial_unique_indexes`).
Neither has been committed, pushed, or deployed.

**Selected: Option A — Consolidate.** The obsolete local Career migration
directories were replaced with a single `add_career_mode` migration reflecting
the final player-paced schema, followed by the required filtered indexes.
*Pros:* one clean migration; no dead columns/tables (`CareerSeason`,
`CareerQualificationContribution`, date fields) shipped only to be dropped by the
next migration; the reviewer sees the real design.
*Cons:* requires a local database reset of Career tables; discards local Career
test data.
*Risk:* effectively zero — nothing is tracked or shipped.

**Option B — Preserve + additive pivot migration.** Keep the four and add a fifth
that alters `CareerWorld`, drops obsolete tables, and adjusts constraints.
*Pros:* no local reset; strictly additive discipline maintained.
*Cons:* ships four migrations of an architecture that never existed in
production, plus a fifth undoing much of it; permanent archaeological noise.

The authorized consolidation preserved unrelated local `User`, `Course`,
`Round`, `Tournament`, Daily, and Challenge data. Final isolation QA restored
Career test data to its pre-test state and hash-verified the non-Career tables.

## 16. Checkpointed implementation sequence

Each step is one iteration, ending in a working repository with recorded
verification, per the session protocol.

1. **Schema + migration strategy** — after authorization on §15: repurpose
   `CareerWorld`, drop obsolete tables, adjust constraints, regenerate Prisma
   Client, apply locally, validate zero drift.
2. **Personal season + instant field formation** — Journey creation, season
   creation with immediate 1-human/19-bot lock, four immediately-playable events,
   eager bot materialization; prove repeated creation returns the same
   season/field.
3. **Completion-driven event + season settlement** — event finalization on human
   completion; fourth completion triggers season eligibility; movement, rating,
   Legacy, history, and next season publish atomically; prove retries create no
   duplicate effects or seasons.
4. **Player-paced Championships** — unlock every four settled seasons, optional
   parallel play, one attempt, Legacy/trophy effects, no movement/rating effects.
5. **Scheduler, repair, APIs, ops** — recovery-only scan, new repair predicates,
   API updates, reconcile/ops updates.
6. **UI pivot** — remove calendar language, all-events-available, progress,
   instant transition, optional Championship entry point.
7. **Simulation + Legacy recalibration** — long-horizon unlimited careers,
   Legacy inflation curve, freeze revised milestones, confirm Tour Rating stays
   volume-neutral and promotion pacing stays meaningful.
8. **Final audit + user testing** — full verification matrix and readiness report.
9. **Visibility and transparency** — live pre-event season standings, the
   event-by-event and round-by-round frontiers of §14a, immutable
   `CareerBotRoundResult` cards, and the `/career/legacy` ledger.

## 17. Test plan

**Pure/unit (no DB):**
- event points, ties, best-three-of-four, season ranking — unchanged, must stay green;
- rolling movement across a one-human field: promote / hold-on-floor-failure /
  relegate / Local floor / Pro ceiling / promotion carry;
- absence of the movement cap: no held-by-cap outcome is reachable;
- Tour Rating volume-neutrality: a 40-season career and an 8-season career with
  identical recent form produce identical ratings;
- Legacy accumulation and the new milestone ladder;
- Championship ranking, single winner, Legacy/trophy derivation — unchanged;
- deterministic seed derivation for personal journeys;
- canonical hashing and effect-key stability — unchanged.

**Real PostgreSQL (`tests/career.db.spec.ts`):**
- Journey creation is idempotent under concurrent first entry;
- season creation locks exactly 20 slots with 1 human and 19 bots, and repeated
  creation returns the same cohort and lock revision;
- all four events are immediately playable; each allows exactly one attempt per
  numbered round and exactly four cumulative rounds;
  resume returns the same round and the same seed;
- an event finalizes on human completion and is idempotent under duplicate finishes;
- the fourth completion settles the season exactly once under concurrent
  triggers, publishing movement/rating/Legacy/history + Season N+1 atomically;
- a rolled-back settlement is invisible and a retry settles exactly once;
- a season cannot settle with three events complete;
- season N+1 cannot be started before N settles;
- four consecutive seasons unlock exactly one Championship; it does not block
  season 5; it permits one attempt; settling it emits no movement/rating/history
  /enrollment effects;
- `championshipQualification` Legacy (35) is published by the fourth season's
  settlement, exactly once, **even if the Championship is never played**;
- an unplayed Championship never settles, is never marked absent, and still
  permits its one attempt an arbitrary number of seasons later;
- `championshipWin` Legacy and the trophy are published only on actual play;
- no competition anywhere in Career ever writes `noShow = true`;
- opponent scores are not exposed for an event the player has not completed;
- the recovery scan completes a season whose write-path settlement failed;
- read paths perform no lifecycle mutation (spy-enqueue proof, as today);
- no Daily / streak / Hall-of-Fame / Tournament / Challenge state is written by
  any Career round.

**Build/integration:** `prisma validate`, `tsc --noEmit`, full unit suite,
real-PG suite, `npm run build`, migration drift, and browser QA across several
consecutive seasons including an immediate season transition.

## 18. Product decisions — RESOLVED (approved before Iteration 2)

All blocking decisions were answered by the product owner prior to Iteration 2:

| # | Decision | Outcome |
|---|---|---|
| 1 | Migration strategy | **Option A — consolidate.** Authorized to delete the four untracked Career migration directories, truncate Career tables only, and generate one clean `add_career_mode` migration. |
| 2 | Championship entry gate | **Require Challenger or Pro.** (Recommendation had been "no gate"; owner chose the gate. Consequences specified in §6.) |
| 3 | Season transition | **Automatic** settlement on the fourth finish; Season N+1 created in the same atomic transaction. No `season/advance` endpoint. |
| 4 | Legacy milestone ladder | **Frozen after Iteration 8 simulation:** 250 / 1,000 / 2,500 / 5,000 / 10,000 / 25,000. |
| 5 | Obsolete tables and columns | **Drop all:** `CareerSeason`, `CareerQualificationContribution`, `CareerEnrollment`, `consecutiveInactiveSeasons`, `noShow`. |
| 6 | Formula version id | `career-v2-player-paced` confirmed. |
| 7 | Async human "ghost" competitors | Confirmed **deferred** until the bot-based version ships and is validated. |

### Original open-questions list (retained for history)

1. **Migration consolidation (§15).** Option A recommended; requires explicit
   authorization plus a Career-only local data reset.
2. **Championship entry gate (§6).** Recommend no tier gate. Alternative: require
   Challenger+.
3. **Explicit vs automatic season transition (§10).** Recommend automatic
   settlement on the fourth finish, with an optional explicit
   `POST /api/career/season/advance` if the UI wants a deliberate "continue" beat.
4. **Legacy milestone ladder (§13).** Resolved and frozen by the Iteration 8
   300,000-season player-paced simulation.
5. **Obsolete-table and vestigial-column disposition (§8, §11).**
   `CareerEnrollment`, `consecutiveInactiveSeasons`, and the now-always-false
   `noShow`: drop them in the pivot migration, or retain as audit/compat.
6. **Asynchronous human "ghost" competitors.** Explicitly deferred until the
   bot-based version ships and is validated; noted here so it is not
   accidentally designed in early.
7. **Formula version id.** `career-v2-player-paced` proposed; confirm the name
   before it is written into pinned snapshots.

## 19. Invariants that must survive the pivot

- Server authority: outcomes come from the server engine; the client sends intent.
- Deterministic, reproducible results from immutable seeds and locked fields.
- One attempt per event and per Championship.
- Read paths never mutate lifecycle.
- Settlement is claimed, fenced, snapshotted, staged invisibly, published
  atomically, and idempotent under retry.
- Effect identities are deterministic and globally unique.
- Legacy is permanent and never decreases.
- Championships never affect movement or Tour Rating.
- Career never writes Daily, streak, Hall-of-Fame, Tournament, or Challenge state.
- Weekly Tournament and core scoring are untouched.
