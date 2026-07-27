# Career Mode — Gate 5/6 technical + schema design (implementation blueprint)

**Status: historical implementation blueprint.** Its schema and service design
have been implemented locally, then adapted to the authoritative player-paced
model in [`career-player-paced-design.md`](./career-player-paced-design.md).
Shared calendars, human cohorts, deadlines, no-shows, inactivity, and scheduled
progression described below are superseded and must not be reintroduced.

Read alongside: `docs/career-formula-freeze.md` (Gate 3 frozen formulas),
`docs/career-settlement-recovery.md` (Gate 4 settlement contract),
`docs/career-simulator-report.md`, `lib/career/rules.ts`, `lib/career/simulator.ts`.

---

## 0. Conventions to match (from existing schema)

- Postgres via Prisma; `id String @id @default(cuid())`; `DateTime @default(now())`.
- Pooled `DATABASE_URL` at runtime, `DIRECT_URL` for migrations.
- Timestamped migration folders under `prisma/migrations/`.
- **Additive only.** New models are namespaced `Career*`. **Do not touch**
  `Tournament`, `TournamentEntry`, or any Weekly Tournament code/behaviour.
- Reuse pure helpers only (engine, ranking, `lib/career/rules.ts`). Never read or
  mutate `Tournament.status`/`cutComputedAt`/`winnerUserId`.

---

## 1. Gate 5 — bot roster / recurring identity design

Frozen inputs: tier mixes (Local 60/35/5, Challenger 10/45/45, Pro 2/28/70),
error rates (Rusty 0.65 / Scratch 0.14 / Ace 0.02), tendencies (Conservative,
Balanced, Aggressive, Situational), ability is decision-error frequency through
the real engine.

**Identity is separate from ability** (v5 principle). A bot *identity* is a
stable name/flavour/tendency within a Career World; its *ability band for a given
cohort slot* is assigned deterministically by the frozen tier mix at lock time.

- Per world: 30 seeded identities (satisfies "24–36"). 8 are `recurring: true`
  (frequently reselected so they become recognizable rivals), 22 rotate.
- Identity fields: `botKey` (stable slug, unique per world), `displayName`,
  `homeFlavor`, `tendency` (fixed per identity), `recurring`.
- Deterministic identity generation for a world: seed = `career:{worldKey}:bots`;
  names from a curated pool in `lib/career/botRoster.ts` (new), initials avatar.
- **Slot → identity assignment at lock** (`CareerFieldSlot`): for each bot slot,
  `abilityBand = botAbilityForSlot(tier, slotIndex, "{worldKey}:s{season}:{tier}", "tier-scaled", TIER_SCALED_BOT_MIX)`
  (reuse the frozen function in `simulator.ts`). Identity chosen deterministically:
  prefer recurring identities of the required tendency, then rotate — seeded by
  `career:{worldKey}:{season}:{tier}:{eventNumber}:slot{slotId}`. Recurring rivals
  are preferentially selected into the human's current tier.
- **Bot result materialization** uses the real engine exactly like
  `simulateArchetypeRound(..., model="error", errorRates=FROZEN)` but seeded per
  the settlement doc's `bot-result:{eventId}:{lockRevision}:{slotId}:{formulaVersion}`
  namespace, producing a real `Round`-shaped result + `outputHash`.
- Recent form / prior wins for a rival are *derived* from that world's committed
  season/event history (no autonomous bot careers — the v1 boundary).

Design decisions recorded (Gate 5):
1. 30 identities/world, 8 recurring — inside the frozen 24–36 / 6–8 bands.
2. Ability band is per-slot (frozen tier mix), identity is per-world stable —
   keeps identity ⟂ ability as v5 requires.
3. Tendency is fixed per identity and only flavours error direction (never the
   error rate), so it cannot distort skill ordering.

---

## 2. Gate 6 — data model (full Prisma schema, ready to append)

Append verbatim to `prisma/schema.prisma`. All relations back-reference `User`
and `Course` (add the listed back-relation fields to `User`/`Course`).

```prisma
enum CareerTier { LOCAL CHALLENGER PRO }
enum CareerAbility { RUSTY SCRATCH ACE }
enum CareerTendency { CONSERVATIVE BALANCED AGGRESSIVE SITUATIONAL }
enum CareerProfileStatus { ACTIVE PAUSED RETIRED }
enum CareerCompetitionKind { EVENT CHAMPIONSHIP }
enum CareerCompetitionState { FORMING LOCKING LOCKED ACTIVE ENDED SETTLED MANUAL_REVIEW VOID }
enum CareerCohortState { FORMING ACTIVE ENDED SETTLED MANUAL_REVIEW }
enum CareerAttemptState { CLAIMED SNAPSHOTTED CALCULATED COMMITTED FAILED_RETRYABLE SUPERSEDED MANUAL_REVIEW }
enum CareerAggregateType { EVENT SEASON CHAMPIONSHIP QUALIFICATION FIELD_LOCK }
enum CareerCompetitorType { HUMAN BOT }
enum CareerMovement { PROMOTE HOLD RELEGATE INACTIVE }

model CareerWorld {
  id            String   @id @default(cuid())
  worldKey      String   @unique              // Eastern civil enrollment date, e.g. "2026-07-24"
  state         String   @default("ACTIVE")   // FORMING|ACTIVE|RETIRED|MANUAL_REVIEW
  formulaVersion String  @default("career-v1-freeze-candidate")
  seasonLengthDays Int   @default(7)
  createdAt     DateTime @default(now())

  profiles      CareerProfile[]
  bots          CareerBotIdentity[]
  seasons       CareerSeason[]
  cohorts       CareerCohort[]
  championships CareerChampionship[]
  enrollments   CareerEnrollment[]
}

model CareerBotIdentity {
  id          String   @id @default(cuid())
  worldId     String
  botKey      String                          // stable per world
  displayName String
  homeFlavor  String
  tendency    CareerTendency
  recurring   Boolean  @default(false)
  createdAt   DateTime @default(now())

  world CareerWorld @relation(fields: [worldId], references: [id], onDelete: Cascade)
  @@unique([worldId, botKey])
  @@index([worldId, recurring])
}

model CareerProfile {
  id            String   @id @default(cuid())
  userId        String
  worldId       String
  tier          CareerTier @default(LOCAL)
  status        CareerProfileStatus @default(ACTIVE)
  consecutiveInactiveSeasons Int @default(0)
  movementEvidence Json  @default("[]")        // ≤2 latest ACTIVE-season percentiles + carry
  legacyTotal   Int      @default(0)           // projection = sum of committed ledger
  currentSeason Int      @default(1)
  createdAt     DateTime @default(now())

  user  User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  world CareerWorld @relation(fields: [worldId], references: [id], onDelete: Cascade)
  histories   CareerSeasonHistory[]
  ratings     CareerRatingHistory[]
  legacy      CareerLegacyLedger[]
  trophies    CareerTrophy[]
  enrollments CareerEnrollment[]

  @@unique([userId, worldId])
  @@index([worldId, tier])
}

model CareerSeason {
  id        String   @id @default(cuid())
  worldId   String
  seasonNumber Int
  startsAt  DateTime
  endsAt    DateTime
  championshipDue Boolean @default(false)      // seasonNumber % 4 == 0

  world   CareerWorld @relation(fields: [worldId], references: [id], onDelete: Cascade)
  cohorts CareerCohort[]
  @@unique([worldId, seasonNumber])
}

model CareerCohort {
  id        String   @id @default(cuid())
  worldId   String
  seasonId  String
  seasonNumber Int
  tier      CareerTier
  state     CareerCohortState @default(FORMING)
  lockedAt  DateTime?
  settledAt DateTime?
  createdAt DateTime @default(now())

  world   CareerWorld  @relation(fields: [worldId], references: [id], onDelete: Cascade)
  season  CareerSeason @relation(fields: [seasonId], references: [id], onDelete: Cascade)
  competitions CareerCompetition[]
  settlement   CareerSeasonSettlement?
  @@unique([worldId, seasonNumber, tier])
  @@index([state])
}

// The single lockable competition (regular EVENT or CHAMPIONSHIP).
model CareerCompetition {
  id            String   @id @default(cuid())
  kind          CareerCompetitionKind
  cohortId      String?                        // EVENT only
  eventNumber   Int?                           // 1..4 for EVENT
  championshipId String?                       // CHAMPIONSHIP only
  courseId      String
  state         CareerCompetitionState @default(FORMING)
  targetFieldSize Int    @default(20)
  deadlineAt    DateTime
  fencingToken  Int      @default(0)           // monotonic per competition
  claimOwner    String?
  claimToken    Int?
  leaseExpiresAt DateTime?
  createdAt     DateTime @default(now())

  cohort       CareerCohort?     @relation(fields: [cohortId], references: [id], onDelete: Cascade)
  championship CareerChampionship? @relation(fields: [championshipId], references: [id], onDelete: Cascade)
  course       Course            @relation(fields: [courseId], references: [id])
  lockRevisions CareerLockRevision[]
  slots        CareerFieldSlot[]
  results      CareerResult[]
  finals       CareerEventFinal[]

  @@unique([cohortId, eventNumber])
  @@index([state, deadlineAt])
}

model CareerLockRevision {
  id            String   @id @default(cuid())
  competitionId String
  revision      Int
  lockHash      String
  formulaBundle Json
  rosterSnapshot Json
  createdAt     DateTime @default(now())

  competition CareerCompetition @relation(fields: [competitionId], references: [id], onDelete: Cascade)
  @@unique([competitionId, revision])
}

model CareerFieldSlot {
  id            String   @id @default(cuid())
  competitionId String
  lockRevisionId String
  slotId        Int                            // stable slot identity within the field
  competitorType CareerCompetitorType
  profileId     String?
  botIdentityId String?
  abilityBand   CareerAbility?
  tendency      CareerTendency?
  seedNamespace String

  competition CareerCompetition @relation(fields: [competitionId], references: [id], onDelete: Cascade)
  @@unique([lockRevisionId, slotId])
  @@index([competitionId, competitorType])
}

model CareerResult {
  id            String   @id @default(cuid())
  competitionId String
  lockRevisionId String
  slotId        Int
  competitorType CareerCompetitorType
  relativeToPar Int?
  completed     Boolean  @default(false)
  noShow        Boolean  @default(false)
  roundId       String?                        // link to real Round for humans
  outputHash    String?
  createdAt     DateTime @default(now())

  competition CareerCompetition @relation(fields: [competitionId], references: [id], onDelete: Cascade)
  @@unique([lockRevisionId, slotId])
}

model CareerEventFinal {
  id            String   @id @default(cuid())
  competitionId String
  lockRevisionId String
  formulaVersion String
  standings     Json
  outputHash    String
  createdAt     DateTime @default(now())

  competition CareerCompetition @relation(fields: [competitionId], references: [id], onDelete: Cascade)
  @@unique([competitionId, lockRevisionId, formulaVersion])
}

model CareerSeasonSettlement {
  id         String   @id @default(cuid())
  cohortId   String   @unique
  seasonNumber Int
  formulaVersion String
  revision   Int      @default(1)
  inputHash  String
  outputHash String
  committedAt DateTime @default(now())

  cohort CareerCohort @relation(fields: [cohortId], references: [id], onDelete: Cascade)
}

model CareerSeasonHistory {
  id         String   @id @default(cuid())
  profileId  String
  cohortId   String
  worldId    String
  seasonNumber Int
  tier       CareerTier
  nextTier   CareerTier
  active     Boolean
  completedEvents Int
  rank       Int?
  activeFieldSize Int
  seasonPoints Float
  movement   CareerMovement
  evidence   Json
  revisionId String
  createdAt  DateTime @default(now())

  profile CareerProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  @@unique([profileId, cohortId])
  @@index([worldId, seasonNumber])
}

model CareerRatingHistory {
  id         String   @id @default(cuid())
  profileId  String
  worldId    String
  seasonNumber Int
  rating     Float
  active     Boolean
  tier       CareerTier
  createdAt  DateTime @default(now())

  profile CareerProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  @@unique([profileId, worldId, seasonNumber])
}

model CareerLegacyLedger {
  id         String   @id @default(cuid())
  profileId  String
  sourceType String
  sourceId   String
  awardType  String
  points     Int
  revisionId String
  payloadHash String
  createdAt  DateTime @default(now())

  profile CareerProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  @@unique([profileId, sourceType, sourceId, awardType])
  @@index([profileId])
}

model CareerTrophy {
  id         String   @id @default(cuid())
  profileId  String
  sourceType String
  sourceId   String
  trophyType String
  revisionId String
  createdAt  DateTime @default(now())

  profile CareerProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  @@unique([profileId, sourceType, sourceId, trophyType])
}

model CareerEnrollment {
  id         String   @id @default(cuid())
  profileId  String
  worldId    String
  seasonNumber Int                             // the NEXT season
  tier       CareerTier
  sourceRevisionId String
  createdAt  DateTime @default(now())

  profile CareerProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  world   CareerWorld   @relation(fields: [worldId], references: [id], onDelete: Cascade)
  @@unique([profileId, worldId, seasonNumber])
}

model CareerChampionship {
  id         String   @id @default(cuid())
  worldId    String
  cycleNumber Int
  state      CareerCompetitionState @default(FORMING)
  deadlineAt DateTime
  createdAt  DateTime @default(now())

  world CareerWorld @relation(fields: [worldId], references: [id], onDelete: Cascade)
  competitions CareerCompetition[]
  contributions CareerQualificationContribution[]
  slots      CareerChampionshipSlot[]
  results    CareerChampionshipResult[]
  @@unique([worldId, cycleNumber])
}

model CareerQualificationContribution {
  id         String   @id @default(cuid())
  championshipId String
  cohortId   String
  seasonNumber Int
  sourceList Json
  committedAt DateTime @default(now())

  championship CareerChampionship @relation(fields: [championshipId], references: [id], onDelete: Cascade)
  @@unique([championshipId, cohortId, seasonNumber])
}

model CareerChampionshipSlot {
  id         String   @id @default(cuid())
  championshipId String
  slotNumber Int                               // 1..20
  competitorType CareerCompetitorType
  profileId  String?
  botIdentityId String?
  source     String
  sourceTrace Json

  championship CareerChampionship @relation(fields: [championshipId], references: [id], onDelete: Cascade)
  @@unique([championshipId, slotNumber])
}

model CareerChampionshipResult {
  id         String   @id @default(cuid())
  championshipId String
  slotNumber Int
  profileId  String?
  relativeToPar Int?
  rank       Int?
  isWinner   Boolean  @default(false)

  championship CareerChampionship @relation(fields: [championshipId], references: [id], onDelete: Cascade)
  @@unique([championshipId, slotNumber])
}

model CareerSettlementAttempt {
  id            String   @id @default(cuid())
  aggregateType CareerAggregateType
  aggregateId   String
  fencingToken  Int
  state         CareerAttemptState @default(CLAIMED)
  owner         String
  trigger       String                         // cron|read-repair|manual
  codeRevision  String?
  leaseExpiresAt DateTime
  formulaBundleVersion String?
  inputHash     String?
  outputHash    String?
  inputSnapshot Json?
  outputSnapshot Json?
  error         Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([aggregateType, aggregateId, state])
  @@index([state, leaseExpiresAt])
}

model CareerOutbox {
  id            String   @id @default(cuid())
  committedRevisionId String
  effectType    String
  scope         String
  payload       Json
  deliveredAt   DateTime?
  attempts      Int      @default(0)
  createdAt     DateTime @default(now())

  @@unique([committedRevisionId, effectType, scope])
  @@index([deliveredAt])
}

model CareerOperatorAudit {
  id            String   @id @default(cuid())
  actor         String
  command       String
  aggregateType CareerAggregateType
  aggregateId   String
  expectedState String?
  before        Json?
  after         Json?
  reason        String
  createdAt     DateTime @default(now())
}
```

Back-relations to add: on `User` → `careerProfiles CareerProfile[]`; on `Course`
→ `careerCompetitions CareerCompetition[]`.

Migration: `npm run db:migrate -- --name add_career_mode` (dev, DIRECT_URL) —
purely additive; no changes to existing tables. `winnerUserId=""`-style sentinels
are NOT used; explicit result state everywhere.

---

## 3. Service / module layout (new, under `lib/career/`)

- `rules.ts` (exists — frozen pure calculators; reuse, do NOT change semantics).
- `simulator.ts` (exists — reuse `botAbilityForSlot`, error model, `TIER_SCALED_BOT_MIX`).
- `botRoster.ts` — deterministic per-world identity generation (Gate 5).
- `canonical.ts` — canonical JSON serializer (sorted keys, explicit nulls,
  integer-safe, UTC + Eastern civil keys) + SHA-256 (`crypto`), `inputHash`/`outputHash`.
- `effectKeys.ts` — the exact idempotency-key builders from settlement doc §9.
- `formulaBundle.ts` — immutable versioned registry; `career-v1-freeze-candidate`
  pins error rates, movement thresholds (0.65/0.58/0.32, carry 0.25), tier mix,
  multipliers (1/1.5/2.25), Legacy schedule, event-points, qualification version.
- `world.ts` — world key (Eastern date via `lib/daily.ts`), get-or-create,
  enrollment, pause/resume, next-cohort shell.
- `formation.ts` — FORMING reservations, provisional bot slots, concurrent-join
  safety (unique `(competition, profile)`), lock procedure (fenced), bot
  materialization (staged, deterministic key), lock publication (Boundary A).
- `eventSettlement.ts` — pure event calc + publication (Boundary D).
- `seasonSettlement.ts` — the 13-step ordered season settlement; movement via
  `rollingMovementForSeason`/`humanMovementLimit`/`boundHumanMovement` in
  `simulator.ts`/`rules.ts`; rating via `tourRating`; Legacy via frozen schedule.
- `championship.ts` — qualification contribution + separate coordinator (exactly-20).
- `settlementEngine.ts` — claim/lease/fence, snapshot, stage, atomic publish,
  retry classification, MANUAL_REVIEW.
- `projections.ts` — profile tier/rating/legacy projections from committed effects (CAS).
- `reconcile.ts` — invariant checker over snapshots (§15 named invariants).

All movement/rating/points/legacy math MUST route through the frozen functions.
Do NOT reintroduce the slot-only `movementForSeason` for production.

---

## 4. Settlement engine mapping (Gate 4 → code)

- **Claim** (`settlementEngine.claim`): one `UPDATE ... WHERE state='ENDED' AND
  (leaseExpiresAt IS NULL OR leaseExpiresAt < now) RETURNING`, bump
  `fencingToken`, insert `CareerSettlementAttempt(CLAIMED)`. Real-PG CAS.
- **Fence**: every snapshot/stage/commit write predicated on
  `fencingToken = :token AND state = :expected`. Stale token → no rows → abort.
- **Snapshot** (Boundary B): short tx; canonical input + `inputHash` +
  formula bundle → attempt `SNAPSHOTTED`.
- **Calculate + stage** (Boundary C): pure; `outputHash`; deterministic staged
  effects (invisible; `ON CONFLICT` only no-ops when `payloadHash` matches).
- **Publish** (Boundary D): ONE tx — re-verify state/fence/hashes/expected-effect
  counts, insert immutable finals/history/rating/legacy/enrollment by deterministic
  key, projections via CAS, outbox rows, mark `COMMITTED` + aggregate `SETTLED`,
  DB postconditions.
- **Championship**: contributions publish with their cohort; coordinator builds
  exactly-20 all-or-nothing. Invariant rejects movement/rating effects in
  Championship output.

---

## 5. Scheduler, APIs, UI (surface list)

**Scheduler** `app/api/career/tick/route.ts` (+ `vercel.json` cron, separate from
tournament tick; gated by `CRON_SECRET`): create due worlds/seasons/cohorts,
lock at deadline, unlock events (days 1/2/4/6), end + claim settlement, next-season
enrollment (effect of settlement), championships every 4 seasons. Idempotent.

**Read-triggered repair**: cheap overdue detection only; enqueue same claim; never
compute/mutate lifecycle in a read path (the tournament anti-pattern).

**APIs** (`app/api/career/...`): `enroll` (POST), `state` (GET current world/tier/
season/status), `schedule`, `event/[id]` play entry (creates a real `Round` linked
to `CareerResult`), `event/[id]/leaderboard`, `season/standings`, `movement`,
`rating`, `legacy`, `history`, `rivals`, `pause`/`resume`, `championship`.

**UI** (`app/career/...`, existing visual language, responsive): entry/onboarding,
world/tier/season header, event schedule, play entry, event leaderboard, season
standings, movement explanation, Tour Rating + Legacy, history, rivals, pause/resume,
championship qualification progress + field/results. All states: empty/forming/
locked/active/ended/settled/retry-safe. Add nav entry without disrupting existing
modes (Home nav + `/career`). No placeholder screens — wire to the service layer.

**Play integration**: a Career event round is a real `Round` (new `mode="career"`)
seeded per the frozen bot/lock namespace, reusing `app/play` and the hole route.
The human's `CareerResult` links `roundId`; **never** alters daily/streak/HoF/
tournament (mode guard, mirroring challenge/tournament exclusion).

---

## 6. Test plan (must include real Postgres)

- Pure: canonical hashing, event points/ties/no-show, best-3, tiebreaks, frozen
  thresholds (0.58/0.65/0.32) + carry, floors/ceilings, inactivity, rating best-6-
  of-8 + zero slots, Legacy schedule + dup source, championship 20-slot pass-down,
  deterministic bot replay, effect keys, state-machine tables, invariant checker,
  Eastern/DST. (Extend `tests/careerRules.test.ts`/`careerSimulator.test.ts`.)
- **Real-PG** (`tests/career.db.test.ts`, against 5433): two concurrent workers →
  one publish; expired worker fenced out; retry each failure stage → exactly one
  settlement; no duplicate ratings/legacy/movement/history/qualification/outbox;
  partial staging invisible; championship not published from incomplete contributions;
  concurrent FORMING joins don't corrupt roster; locked fields never mutate;
  provisional-bot replacement never rewrites shown results; enroll/pause/resume;
  inactive-season movement+rating; tie expansion; one-player field; 500-player
  settlement in budget. Weekly Tournament + gameplay tests stay green.
- Vitest DB tests need a separate config that uses `DIRECT_URL` and a disposable
  schema (`career_test`) — do NOT run against `public`.

---

## 7. Frozen invariants that must not change

All §15 named invariants of `career-settlement-recovery.md`; the frozen formulas
of `career-formula-freeze.md`; ability=decision-error-through-engine (no hidden
bonuses); bot identity ⟂ ability; Weekly Tournament untouched; scoring untouched.
