# Career Mode settlement and recovery architecture

**Status: historical safety architecture, implemented with a player-paced
cadence.** The claims, leases, fencing, immutable snapshots, deterministic
effects, atomic publication, idempotent retry, reconciliation, and
`MANUAL_REVIEW` rules remain authoritative.

Calendar cadence, shared cohorts, enrollment windows, deadline closure,
no-shows, inactivity, and time-driven progression in this document are
superseded by [`career-player-paced-design.md`](./career-player-paced-design.md).
Do not use those historical sections as an operations runbook.

This document specifies failure behavior, ownership, ordering, idempotency,
concurrency, recovery, and verification for Career Mode settlement. Its
surviving safety rules are implemented in the current Career code.

## 1. Status and boundaries

### In scope

This gate defines settlement and recovery for:

- regular Career events;
- regular Career seasons;
- promotion, relegation, inactivity, and tier transitions;
- Tour Rating history;
- Legacy Points and trophies;
- Championship qualification and Championship settlement;
- next-season enrollment;
- day-one provisional fields and field locking;
- deterministic retries, reconciliation, and operator recovery.

### Frozen inputs

Gate 3's approved formula package is `career-v1-freeze-candidate`. Its event points, Candidate H movement rules, tier mixes, Tour Rating, Legacy schedule, Championship qualification, and deterministic bot behavior are inputs to this architecture. Gate 4 does not retune them.

The frozen package includes, among other rules:

- four events per regular season, with the best three event-point totals counting;
- active status at three completed events;
- two-active-season rolling movement evidence;
- promotion at rolling average at least `0.65` with both seasons at least `0.58`;
- relegation at rolling average at most `0.32`;
- Local floor and Pro ceiling;
- human movement limit `clamp(ceil(activeHumans * 0.20), 4, 40)`, with exact boundary ties kept together;
- Tour Rating as best six of the last eight chronological regular-season ratings, with inactive seasons occupying a zero slot;
- the frozen balanced Legacy award schedule;
- fixed Championship qualification and pass-down rules.

The exact formulas remain authoritative in [`career-formula-freeze.md`](./career-formula-freeze.md) and the versioned pure rules package. This document defines how those formulas are applied safely, not what their values should be.

### Explicit non-goals

- No Prisma models, migration, API, route, server action, UI, navigation, cron, queue, or production settlement worker is designed at field-level or implemented here.
- No Weekly Tournament behavior changes.
- No scoring-probability changes.
- No deployment or changelog work.
- No Gate 5 bot-roster implementation.

Weekly Tournament and Career Mode are separate products and separate aggregates. Career settlement must never infer, mutate, or reuse Weekly Tournament's mutable `Tournament.status`, `cutComputedAt`, `winnerUserId`, entries, or rounds. Shared low-level utilities may be reused only when they are pure and accept explicit inputs.

## 2. Ownership model

Every mutable decision has one authoritative aggregate owner. Child records cannot independently advance their parent's lifecycle.

| Concept | Authoritative identity | Owns | Does not own |
|---|---|---|---|
| Career World | stable world key, determined by the locked enrollment rule | shared calendar, season sequence, formula-package assignment, Championship cadence | a player's tier or personal history |
| Career Profile | player + Career World | current tier, inactivity counter, movement evidence, cumulative Legacy summary, participation status | shared standings or bot identities |
| Cohort | Career World + season number + tier | one tier field for one regular season, its four event identities, locked roster | profiles in another tier or Championship state |
| Regular event | cohort + event number `1..4` | event deadline, locked field reference, submitted human results, bot results, final standings | season movement, Tour Rating, next enrollment |
| Regular season settlement | cohort identity | season standings, active status, movement decisions, season rating/history, Legacy effects, next enrollment | other cohorts; Championship result |
| Championship | Career World + Championship cycle | fixed 20-player field, Championship results, winner, Championship Legacy/trophy effects | regular-season movement or Tour Rating |
| Provisional field | event identity + forming revision | human reservations and stable provisional bot slots before lock | final results or standings |
| Locked field | event identity + immutable lock revision | exact competitor identities, competitor type, bot identity/archetype, deterministic seed references | later joiners or mutable display metadata |
| Individual round result | event + competitor | submitted or materialized score, completion state, deterministic evidence | event rank or season points |
| Career Profile history | profile + Career World + season | immutable record of that season's tier, activity, rank, rating, movement, next tier, and evidence | future profile state |

The regular-season settlement aggregate is the cohort, not the whole Career World. Different tier cohorts and different worlds may settle concurrently. A Championship is a separate aggregate and may settle concurrently with a regular cohort.

## 3. Lifecycle state machines

### 3.1 Competition lifecycle

Use one durable lifecycle for each lockable competition (regular event or Championship):

| State | Meaning | Allowed next states |
|---|---|---|
| `FORMING` | Enrollment is open; human reservations may replace unmaterialized provisional bot slots. | `LOCKING`, `VOID` |
| `LOCKING` | One fenced lock attempt is freezing the roster and materializing missing bot identities/results. Gameplay is not open. | `LOCKED`, `FORMING`, `MANUAL_REVIEW` |
| `LOCKED` | The immutable field snapshot and lock hash exist; no competitor may be added, removed, or replaced. | `ACTIVE`, `MANUAL_REVIEW` |
| `ACTIVE` | Play is open and valid round results may be accepted. | `ENDED`, `MANUAL_REVIEW` |
| `ENDED` | Deadline passed; result inputs are immutable; settlement is pending. | `SETTLED`, `MANUAL_REVIEW` |
| `SETTLED` | One committed settlement revision is authoritative and all required effects are published. Terminal. | none |
| `MANUAL_REVIEW` | An invariant, determinism, version, or historical-state problem prevents safe automation. | `FORMING`, `LOCKED`, `ACTIVE`, `ENDED`, or `SETTLED` only through an audited operator action with explicit expected state |
| `VOID` | Competition was cancelled before any valid play, under an explicit product/operator decision. Terminal. | none |

Rules:

- Time makes a transition eligible; time alone does not write the state.
- `FORMING -> LOCKING` is a compare-and-set transition with a lock lease and fencing token.
- `LOCKING -> FORMING` is allowed only when no immutable lock revision was published and the enrollment deadline has not passed.
- Once `LOCKED`, the roster is immutable. Repair restores missing derived/materialized records from the lock snapshot; it never edits the snapshot.
- `ACTIVE -> ENDED` closes writes before settlement input is captured.
- `ENDED -> SETTLED` occurs only in the primary settlement publication transaction.
- `MANUAL_REVIEW` never means "best effort complete." It blocks dependent settlement and records the violated invariant.
- `VOID` cannot be used to hide a played or partially settled competition.

Entity-specific lifecycles refine that shared competition machine:

| Entity | Conceptual lifecycle | Authority rule |
|---|---|---|
| Career World | `FORMING -> ACTIVE -> RETIRED`, with `MANUAL_REVIEW` for calendar/identity corruption | Activating a world freezes its identity and calendar basis. A world is not settled as one giant aggregate. |
| Cohort / regular season | `FORMING -> ACTIVE -> ENDED -> SETTLED`, with `MANUAL_REVIEW` | `ACTIVE` requires four event identities and an enrolled tier roster. It cannot settle until all four event finals commit. |
| Regular event | full competition lifecycle above | Owns its field lock and event final; it cannot publish season effects. |
| Championship | full competition lifecycle above | Owns its fixed field and result settlement; it cannot publish regular-season effects. |
| Provisional field | `FORMING -> LOCKING -> SUPERSEDED_BY_LOCK` | It is mutable only during forming and ceases to be authoritative when a lock revision publishes. |
| Locked field revision | `STAGED -> COMMITTED` | Immutable and authoritative only when committed; never edited in place. |
| Individual human result | `RESERVED -> IN_PROGRESS -> SUBMITTED`, or `RESERVED/IN_PROGRESS -> NO_SHOW` at deadline | `SUBMITTED` and `NO_SHOW` are terminal for that event; post-deadline corrections create audited replacement evidence rather than editing silently. |
| Individual bot result | `PLANNED -> STAGED -> COMMITTED` | It becomes visible only with the matching locked-field revision and cannot exist before lock calculation. |
| Career Profile season history | `STAGED -> COMMITTED`, with optional append-only `CORRECTED` successor | Exactly one authoritative committed history per profile/world/season; old evidence remains inspectable. |

The regular-season settlement aggregate is the cohort. Different tier cohorts and worlds may settle concurrently. Their shared Championship qualification is coordinated separately as described in section 10.

### 3.2 Settlement-attempt lifecycle

Settlement execution is orthogonal to competition lifecycle. A competition may remain `ENDED` while several failed or superseded attempts exist.

| Attempt state | Meaning |
|---|---|
| `CLAIMED` | A worker owns an unexpired lease and a unique fencing token. |
| `SNAPSHOTTED` | Canonical immutable input, version bundle, and input hash are persisted. |
| `CALCULATED` | Pure output snapshot and output hash are persisted and validated. |
| `COMMITTING` | Logical worker phase immediately before the primary transaction; emitted to logs. It need not be a separately observable durable database state because transaction rollback must not leave it stranded. |
| `COMMITTED` | This attempt's revision was atomically published and the aggregate is `SETTLED`. Terminal. |
| `FAILED_RETRYABLE` | A transient failure occurred; the aggregate remains unchanged and may be reclaimed. |
| `SUPERSEDED` | A newer fencing token replaced this attempt. Terminal; it may never publish. |
| `MANUAL_REVIEW` | Inputs, outputs, versions, or history are contradictory. No automatic retry. |

An aggregate has at most one authoritative committed revision. Attempts are append-only audit evidence; their error details must not be overwritten by later retries.

### 3.3 Career Profile state

A profile's current state is a projection of committed immutable history:

- current tier equals the `nextTier` of its latest committed regular-season history;
- movement evidence contains only eligible active regular-season evidence under the frozen rules;
- inactivity count advances only from committed regular-season history;
- Tour Rating derives from committed chronological rating history;
- Legacy total is the sum of committed award-ledger entries;
- Championship results never alter tier, movement evidence, or Tour Rating.

No worker may mutate a profile because an event merely ended. Profile changes become visible only through a committed season or Championship revision.

## 4. Day-one field locking and bot materialization

### Forming behavior

Each event begins with a target field and stable provisional slots. A slot has a deterministic identity independent of who eventually occupies it. During day one:

- a joining human reserves an available slot;
- replacing a provisional bot reservation does not delete any result, because no bot result may exist before lock;
- displays may show the field as provisional and must not show final bot scores or final standings;
- a repeated enrollment request is idempotent for `(event, profile)`;
- one profile cannot occupy two slots in the same event.

### Lock procedure

The scheduled worker is primary. At the enrollment deadline it:

1. atomically claims the field lock and increments its fencing token;
2. reads the complete human reservation set;
3. deterministically assigns stable bot identities/archetypes to every remaining slot using the frozen package, world/cohort/event identity, and slot identity;
4. creates the canonical ordered roster snapshot;
5. materializes deterministic bot results against that snapshot;
6. verifies target field size, unique slot occupancy, unique competitors, valid bot versions, and one result per locked bot;
7. atomically publishes the lock revision/hash and transitions `LOCKING -> LOCKED`.

Materialization may be staged and retried by deterministic effect key. Staged bot results are invisible until the lock revision is published. A crash after 40 of 100 bot rows therefore leaves no partially locked field: retry fills or verifies the same staged keys and publishes only after the complete-set invariant passes.

### Bot-result identity

Use a stable conceptual idempotency identity:

`bot-result:{eventId}:{lockRevision}:{slotId}:{formulaPackageVersion}`

The result records:

- locked competitor/bot identity;
- bot archetype and tier-mix version;
- deterministic seed namespace;
- engine/scoring version;
- complete round output;
- canonical output hash.

If retry produces a different output for the same identity, do not overwrite. Move the lock attempt to `MANUAL_REVIEW` with both hashes.

## 5. Eligibility and exact settlement ordering

### 5.1 Regular event finalization

A regular event may be finalized only when:

- its lifecycle is `ENDED`;
- deadline and Eastern civil-date checks agree;
- a valid immutable locked-field revision exists;
- human result writes are closed;
- every locked competitor has exactly one terminal result representation: completed score or explicit no-show;
- each bot result matches the lock revision and deterministic version bundle.

Event calculation is pure:

1. validate the locked field and terminal results;
2. rank completed results using frozen tie rules and deterministic fallback;
3. preserve no-shows as field members with zero event points;
4. calculate occupied-position event points;
5. calculate event-completion, top-five, and event-win Legacy candidates;
6. emit one final standing/output per locked competitor.

Event publication writes one immutable event-final revision plus deterministic **award candidates**. Event-completion, top-five, and event-win Legacy ledger effects are published exactly once by season settlement, after all four event finals are available. Event finalization does not mutate Legacy totals, season movement, rating, or next enrollment.

### 5.2 Regular season settlement

A cohort season may settle only after all four expected event identities exist and all four have valid committed event-final revisions. The exact order is:

1. **Confirm eligibility.** Verify cohort identity, season deadline, lifecycle `ENDED`, four event finals, matching locked rosters/formula versions, and no prior committed season revision.
2. **Lock or verify immutable fields.** No late lock is silently invented during season settlement. A missing lock is a prerequisite failure; invoke the field-lock workflow first.
3. **Verify final event standings.** One result and one final standing per locked competitor per event, including no-shows.
4. **Read frozen event points.** Verify the event-point outputs and hashes; never recalculate with a newer unpinned package.
5. **Determine activity.** A human is active exactly when the frozen completion threshold is met; no-shows remain explicit.
6. **Rank the season.** Apply best-three-of-four and frozen tiebreak rules to the complete season input.
7. **Calculate movement.** Apply Candidate H rolling evidence, tier boundaries, inactivity behavior, promotion carry, human limit, and exact tie expansion.
8. **Calculate Tour Rating history.** Produce the season rating entry and the resulting best-six-of-eight aggregate. Championships are excluded.
9. **Calculate Legacy and trophies.** Emit each award as an independently keyed immutable effect.
10. **Record history.** Emit exactly one immutable season-history and movement-history result per human, including hold/inactive outcomes.
11. **Determine Championship qualification when due.** Emit this cohort's immutable qualification contribution. When all required Pro/Challenger season contributions are committed, the separate qualification coordinator builds the complete deterministic 20-slot output with duplicate-source pass-down.
12. **Create or verify next-season enrollment.** Emit one intended enrollment for every eligible unpaused profile using its settled `nextTier`.
13. **Publish settlement.** Atomically make the revision and all effects authoritative, update projections from the immutable effects, enqueue external side effects, and transition the cohort to `SETTLED`.

Steps 1–12 are pure calculation after the immutable input snapshot is captured. Reads used to build that snapshot and all writes used to publish it have transactional requirements described below.

### 5.3 Championship settlement

Championship settlement is a distinct aggregate and code path:

1. verify the Championship is `ENDED` and its exactly-20 locked field is immutable;
2. verify one terminal result per qualifier;
3. rank with the pinned Championship formula/tiebreak version;
4. identify the settled result and winner, if one exists under the frozen rule;
5. emit Championship result history for all human qualifiers;
6. emit qualification Legacy effects if they were not already committed at qualification time;
7. emit one Championship-win Legacy effect and one trophy effect for the winner;
8. publish atomically and mark the Championship `SETTLED`.

Championship settlement must contain no movement, inactivity, regular-season rating, rolling evidence, or regular next-enrollment effects. An invariant rejects any Championship output containing those effect types.

## 6. Determinism and versioning

### Version bundle

Every lock and settlement input snapshot pins:

- `formulaPackageVersion` (`career-v1-freeze-candidate` for this gate);
- event-points formula version;
- Candidate H movement version;
- bot tier-mix and ability calibration version;
- bot policy/archetype version;
- game engine and scoring version used to materialize bots;
- Tour Rating formula and tier-multiplier version;
- Legacy schedule version;
- Championship qualification/pass-down version;
- Championship result/tiebreak version;
- canonical serialization version;
- runtime build/revision identifier for diagnostics.

The formula package is an immutable registry entry. Deploying new formulas creates a new version; it never mutates the implementation referenced by an old version.

### Input snapshot

Persist a canonical input snapshot before calculation. It includes:

- aggregate identity, world, season/cycle, tier, deadlines, and timezone interpretation;
- authoritative lock revision/hash for every relevant event;
- ordered field entries with stable competitor/slot identities and human/bot type;
- all terminal event results and explicit no-shows;
- prior committed movement evidence and inactivity state for each profile;
- prior chronological Tour Rating history needed by the frozen window;
- existing immutable Legacy/trophy effect identities relevant to duplicate prevention;
- qualification inputs and deterministic fallback values when due;
- current eligible/unpaused enrollment status;
- every deterministic seed namespace.

Canonicalization requires sorted object keys, fixed array ordering by stable identity, explicit nulls, integer-safe number representation, UTC instants plus Eastern civil keys where calendar rules depend on them, and a versioned serializer. Compute a SHA-256 `inputHash` over the canonical bytes.

The snapshot is immutable once its attempt reaches `SNAPSHOTTED`. A retry normally reuses it. If authoritative source data now hashes differently, the worker must classify why:

- if the prior attempt never published and the source change is a valid pre-snapshot correction, create a new fenced attempt and snapshot, preserving the old attempt;
- if the aggregate had already ended and the source changed without an audited correction, enter `MANUAL_REVIEW`;
- if a committed settlement exists, never recalculate or overwrite it automatically.

### Output snapshot

Persist all pure outputs before publication:

- final event/season/Championship standings;
- activity;
- movement evidence, decisions, and next tiers;
- rating history and aggregate projections;
- every award/trophy effect;
- Championship field/qualification effects;
- next-enrollment intents;
- expected effect counts and invariant evidence.

Canonicalize and hash it as `outputHash`. Persist both inputs and outputs, not hashes alone: hashes detect drift, while snapshots make old settlements inspectable and recoverable without arbitrary live-row queries.

On retry with the same input and version bundle, the output hash must match. A mismatch is never resolved by "latest code wins"; it enters `MANUAL_REVIEW`.

## 7. Claiming, leases, and concurrency

### Atomic claim

Claim an aggregate with one compare-and-set transaction that:

- verifies the aggregate is eligible (`ENDED`, not settled, not manual review);
- verifies no unexpired claim exists;
- increments a monotonically increasing aggregate fencing token;
- creates an append-only attempt with owner, token, claimed time, lease expiry, trigger type, and code revision;
- returns the token to the worker.

Recommended initial lease: long enough for a 500-player calculation under observed p99 plus margin, with bounded heartbeats. The exact duration is an implementation/operations constant, not a product rule.

### Fencing

Fencing tokens are required. Claim ownership and leases alone are insufficient because an old worker can resume after its lease expires.

Every heartbeat, snapshot write, output write, staging write, and primary commit must require:

- aggregate identity;
- attempt identity;
- current fencing token;
- expected attempt state.

When a stale claim is superseded, the aggregate token increments. The old worker's commit predicate fails even if it finishes later.

### Duplicate triggers

Cron, read-triggered repair, and manual retry all call the same claim function and settlement worker. A losing trigger returns an inspectable `already-claimed` or `already-settled` result; it does not execute separate math.

### Process death

- Before claim: no state changed; another trigger may claim.
- After claim, before snapshot: lease expires and a new token supersedes it.
- During pure calculation: no authoritative effects exist; retry reuses the snapshot.
- During staging: deterministic keys make repeated staging inserts verify/no-op; staged data is invisible.
- During the primary transaction: the database commits all authoritative changes or rolls all of them back.
- After commit, before response: retry observes `SETTLED`, verifies effect completeness, and returns success without creating effects.

## 8. Transaction and publication boundaries

### Boundary A: field lock

The field-lock publish transaction must atomically:

- verify the lock claim/fence and deadline;
- verify all expected staged slots and bot results exist and hash correctly;
- publish one immutable locked-field revision;
- transition `LOCKING -> LOCKED`;
- invalidate no human reservation.

Bot simulation may occur outside the transaction. Partial staged materialization is not visible as a locked field.

### Boundary B: settlement snapshot

A short transaction must:

- verify lifecycle eligibility and fence;
- lock or otherwise protect the aggregate version;
- read the authoritative immutable child revisions and prior profile-history versions;
- persist the canonical snapshot/version bundle/input hash;
- advance the attempt to `SNAPSHOTTED`.

After this boundary, source writes for that ended aggregate are prohibited except through audited correction tooling that supersedes the attempt.

### Boundary C: pure calculation and staging

Calculation runs outside a database transaction. The worker may persist a canonical output snapshot and deterministic staged effects in bounded batches. Staged effects:

- are keyed by aggregate revision and effect key;
- are not included in player-facing projections;
- may be retried safely;
- must exactly match on conflict;
- are garbage-collectable only after retention policy and audit requirements are met.

This keeps a 500-player settlement inspectable without holding one opaque transaction during CPU work or network waits.

### Boundary D: primary publication

One database transaction is the only publication point. It must:

1. verify aggregate is still `ENDED`, attempt is current, fence matches, and lease is valid;
2. verify input/output hashes and formula bundle;
3. verify expected staged-effect counts and all pre-commit invariants;
4. insert or activate immutable final standings/history/effects using deterministic keys;
5. create/verify this season's qualification contribution when due; only the separate qualification coordinator may create/verify the complete Championship field;
6. create/verify every next-season enrollment intent;
7. update profile projections from the committed immutable records using compare-and-set history versions;
8. create transactional-outbox messages for external notifications;
9. mark the settlement revision authoritative, attempt `COMMITTED`, and aggregate `SETTLED`;
10. run database-enforceable postconditions before commit.

No player-facing query may count staged/uncommitted effects. A consumer either sees the prior state or the fully published revision.

If inserting all effects is too large for the transaction budget, the future schema must preserve the same atomic visibility contract: effects can be pre-staged in batches, but one final committed-revision pointer controls visibility. It is not acceptable to publish profiles one at a time.

### After publication

Notifications, analytics, cache invalidation, and emails run from a transactional outbox. Delivery uses the outbox message identity as its downstream idempotency key. Delivery failure never rolls back settlement and never invokes settlement math again.

## 9. Idempotency identities

All identities include the Career namespace so they cannot collide with Weekly Tournament effects.

| Effect | Stable conceptual key | Required uniqueness/behavior |
|---|---|---|
| locked field | `career:field-lock:{eventOrChampionshipId}:{lockRevision}` | one authoritative lock revision per competition |
| bot result | `career:bot-result:{competitionId}:{lockRevision}:{slotId}:{formulaVersion}` | one exact result per locked bot slot |
| event finalization | `career:event-final:{eventId}:{lockRevision}:{formulaVersion}` | one authoritative final revision per event |
| event standing | `career:event-standing:{eventFinalId}:{competitorId}` | exactly one per locked competitor |
| season settlement | `career:season-settlement:{cohortId}:{season}:{formulaVersion}` | one authoritative revision per cohort season |
| season history | `career:season-history:{profileId}:{cohortId}:{season}` | one per human participant, including inactive |
| movement history | `career:movement:{profileId}:{cohortId}:{season}` | exactly one action/evidence result per season history |
| Tour Rating history | `career:rating:{profileId}:{cohortId}:{season}` | one chronological rating entry per regular season |
| Legacy award | `career:legacy:{profileId}:{sourceType}:{sourceId}:{awardType}` | one award for each earned source/award pair |
| trophy | `career:trophy:{profileId}:{sourceType}:{sourceId}:{trophyType}` | one trophy effect for the qualifying source |
| qualification contribution | `career:qualification-input:{championshipId}:{cohortId}:{season}` | one immutable source list per required settled cohort |
| Championship qualification | `career:qualification:{championshipId}:{competitorId}` | competitor appears at most once, regardless of sources |
| Championship slot | `career:championship-slot:{championshipId}:{slotNumber}` | exactly one competitor per each of 20 slots |
| Championship result | `career:championship-result:{championshipId}:{competitorId}` | one final result per locked qualifier |
| Championship settlement | `career:championship-settlement:{championshipId}:{formulaVersion}` | one authoritative revision |
| next enrollment | `career:enrollment:{profileId}:{worldId}:{nextSeason}` | exactly one enrollment, whose tier matches settled history |
| outbox message | `career:outbox:{committedRevisionId}:{effectType}:{recipientOrScope}` | at-least-once delivery, exactly-once downstream effect |

Uniqueness is layered:

1. one authoritative committed settlement revision per aggregate;
2. deterministic effect keys;
3. database unique constraints in the later schema;
4. immutable ledger/history rows;
5. compare-and-set lifecycle and projection versions;
6. exact-content verification on duplicate keys.

`ON CONFLICT DO NOTHING` by itself is insufficient. A conflict is a no-op only when the persisted canonical payload hash matches the proposed payload. A different payload under the same key is corruption and requires manual review.

Legacy/profile totals are derived projections. They must equal the sum of committed ledger effects; retries must not issue unkeyed increments.

## 10. Championship qualification

Qualification has two deterministic layers:

1. each due Pro or Challenger season settlement emits one immutable qualification contribution from its own settled season/event output; and
2. one Championship-qualification coordinator waits until every required contribution is committed, then builds and publishes the fixed field using the pinned qualification version.

This avoids making one tier cohort the accidental owner of another cohort's standings and avoids a deadlock in which two cohort transactions each wait for the other.

The pure builder:

- considers sources in the frozen priority order;
- records every source a competitor earned for audit;
- assigns each competitor at most one field slot;
- passes duplicate Pro sources down using the frozen deterministic standings fallback;
- assigns fixed Challenger places;
- fills remaining slots with deterministic elite-bot identities;
- returns exactly 20 ordered unique slots or fails.

Each contribution publishes atomically with its source season. The complete field publishes all-or-nothing inside the qualification coordinator's fenced primary transaction. There is no visible 14-of-20 Championship field. No cohort may independently append competitors to the shared field.

When regular-season and Championship play overlap:

- their aggregate identities, claims, and settlement revisions remain independent;
- a player's Championship participation does not pause or mutate regular-season math;
- skipping a regular event follows normal active/inactive rules;
- Championship settlement cannot update movement or Tour Rating;
- Legacy keys distinguish qualification from Championship result/win.

## 11. Automatic next-season enrollment

Next enrollment is an effect of committed season settlement, not a best-effort follow-up.

For every eligible unpaused profile:

- target season is exactly current season + 1 in the same Career World;
- target tier equals committed `nextTier`;
- enrollment key is deterministic;
- the enrollment records its source settlement/history identity;
- a duplicate with identical source/tier is success;
- an existing enrollment with a different tier, world, season, or source is a conflict and blocks publication.

The season is not `SETTLED` if movement/history publishes without consistent next enrollment. If product policy permits a paused/retired profile not to enroll, the immutable season output must explicitly record the exclusion reason; absence is never ambiguous.

Creating the next cohort shell may be idempotent shared setup. It must not silently lock the next field or materialize bots during this transaction.

## 12. Failure matrix

| Failure | Detection | Safe automatic response | Retry | Human review? | Recovery proof |
|---|---|---|---|---|---|
| Roster lock fails before snapshot | lock attempt error; no published lock revision | mark attempt retryable; leave competition `FORMING` before deadline or `LOCKING` with expired lease after deadline | reclaim with higher fence | no, unless repeated/unknown | one complete lock revision; field-size and uniqueness invariants pass |
| Bot materialization partially succeeds | staged count/hash set differs from expected slots | keep staged rows invisible; regenerate missing deterministic keys | same snapshot/version; verify existing payloads | only on payload mismatch | exactly one matching result per locked bot slot |
| One regular event is missing | cohort expects four identities but finds fewer | do not snapshot season; enqueue/create missing prerequisite only if calendar contract allows | after event exists and settles | yes if deadline passed with no legitimate event | four distinct committed event finals |
| One event is incomplete | event not `SETTLED`, missing terminal result, or invariant failure | settle/repair event first; season stays `ENDED` | yes, at event scope | on impossible source state | one terminal result/final standing per locked competitor |
| Settlement starts before deadline | clock/civil key before deadline or lifecycle not `ENDED` | reject claim as not eligible; no writes | next scheduled tick | no | first successful claim timestamp is at/after deadline |
| Settlement starts twice | active lease/CAS conflict | one attempt wins; other reports already claimed | loser may poll/exit | no | one current fence and at most one committed revision |
| Worker dies before claiming | no attempt/claim exists | next trigger claims normally | yes | no | later valid claim and settlement |
| Worker dies after claiming | lease expires without commit | supersede with incremented fence | yes | no, unless repeated | old attempt `SUPERSEDED`; new attempt commits |
| Worker dies during calculation | attempt `SNAPSHOTTED`, no output or partial staging | recalculate from persisted snapshot | yes | only if output differs | same input produces expected output hash |
| Worker dies midway through staging | expected effect manifest not satisfied | fill/verify deterministic staged keys | yes | on conflicting payload | staged manifest complete; still invisible until publish |
| Worker/database dies during primary writes | transaction abort or commit outcome unknown | read aggregate/revision by idempotency key; never assume | if uncommitted, rerun publish; if committed, verify | only if DB state contradicts transaction semantics | either zero authoritative effects or complete committed revision |
| Movement writes but rating does not | impossible under publication transaction; reconciler detects missing effect if legacy corruption/import | do not patch one side; republish uncommitted revision or enter review | only from same output snapshot | yes if aggregate says settled | movement, rating, history, enrollment all reference same committed revision |
| Awards write but next enrollment does not | publication transaction rollback, or invariant scan detects historical corruption | same as above; no unkeyed award compensation | retry whole publication if not committed | yes if marked settled | expected award keys and enrollment keys all present exactly once |
| Championship field is partially created | fewer/more than 20 visible slots or duplicate slot/competitor | partial staged field remains invisible; rebuild from qualification snapshot | yes | on source/output mismatch | exactly 20 unique committed slots and one field hash |
| Duplicate qualification sources target one player | pure builder sees repeated competitor | retain source evidence, assign player once, pass slot down deterministically | deterministic/no special retry | no unless field cannot fill | 20 unique competitors; source/pass-down trace matches output |
| Next season already exists identically | deterministic enrollment key/payload match | treat as verified idempotent success | continue publication | no | one matching enrollment |
| Next season exists with conflicting data | key or logical identity exists with different tier/source/world | abort transaction and enter manual review | no automatic retry | yes | conflict resolved by audited correction; history and enrollment agree |
| Stale settlement claim | lease expired or heartbeat absent | new claim increments fence and supersedes old attempt | yes | no | stale token cannot write; newer attempt is current |
| Old worker completes after newer retry | commit predicate's fence is no longer current | reject old commit and mark attempt superseded | no for old worker | no | only newest valid fence can be committed |
| Database timeout outside transaction | operation returns timeout/unknown | inspect attempt/effect identity, then retry idempotently | yes with bounded backoff/jitter | after retry threshold | one canonical row per key, matching hash |
| Database timeout during transaction | commit outcome unknown | query aggregate committed revision and effect manifest before retry | yes after read-back | if read-back contradicts invariants | all-or-nothing revision proof |
| Deterministic calculation mismatch on retry | same input/version yields different `outputHash` | stop; preserve both outputs; enter manual review | no automatic overwrite | yes | approved canonical output and cause documented |
| Corrupted/impossible historical state | invariant scan, missing prior history, invalid tier transition, negative Legacy delta, broken hash chain | quarantine affected aggregate/profile; do not infer missing truth | only after audited repair plan | yes | complete invariant audit and before/after report |
| Production hotfix changes code between attempts | build revision differs; pinned formula registry unavailable or output hash differs | run pinned version; if unavailable, stop | only with archived pinned package | yes if reproducibility unavailable | stored input/output match pinned version and hashes |
| Formula package/version unavailable | registry lookup fails | mark manual review; never substitute latest | no | yes | original immutable package restored and verifies output |
| Read-triggered repair races cron | same atomic claim sees active lease | loser exits quickly; page rendering continues | normal worker continues | no | one claim/fence and one revision |
| External notification fails after commit | outbox undelivered/retry count | retry delivery only | yes, independent of settlement | after delivery threshold | settlement remains committed; one downstream effect per outbox key |
| Projection total differs from ledger | reconciliation recomputes total | rebuild projection from committed ledger under CAS; never alter ledger | yes if ledger valid | yes if ledger itself conflicts | projection equals ledger sum and history version |
| Manual retry targets wrong aggregate/state | explicit expected-state and identity precondition fails | abort with no writes | operator corrects command | no data review unless command exposed a real mismatch | audit log shows rejected attempt and zero mutations |

No automatic response may delete valid rounds, rewrite committed history, lower Legacy, or silently choose a new formula.

## 13. Recovery and operator tooling

### Required read-only commands

Later implementation must provide:

- `career settlement list`: overdue/unsettled aggregates, oldest age, lifecycle, current attempt, claim age;
- `career settlement inspect --aggregate`: ownership, deadlines, claim owner/token/lease, attempt timeline, failures, versions, hashes, expected/effective counts;
- `career settlement input --attempt`: canonical frozen input snapshot;
- `career settlement output --attempt`: persisted calculated output and effect manifest;
- `career settlement dry-run --aggregate`: run the pinned pure calculator without writes and compare hashes;
- `career settlement verify --aggregate`: verify every expected effect and invariant;
- `career settlement reconcile --profile|--world|--season`: detect missing/duplicate history, movement, rating, awards, trophies, qualifications, enrollments, and projection drift;
- `career championship verify-field`: prove exactly 20 unique slots and explain each source/pass-down;
- `career settlement audit-report`: machine-readable and human-readable post-recovery report.

Read-only diagnostics must query raw state and must not call application reads that cause lifecycle mutations. This follows the useful distinction in `scripts/diag-tournaments.ts`, which deliberately avoids `getActiveTournament` because the weekly read path mutates lifecycle state.

### Required mutating commands

- retry exactly one aggregate from its persisted snapshot;
- release/supersede one stale claim with expected token and lease state;
- republish an uncommitted, hash-verified output revision;
- rebuild one projection from a valid immutable ledger;
- apply an explicitly reviewed historical correction as a new correction record/revision;
- quarantine or unquarantine one aggregate after invariant review.

### Safety contract

Every mutating command must:

- default to dry-run;
- require an exact world/cohort/event/Championship identity;
- print current state, proposed state, input/output/effect hashes, and affected counts;
- require an expected current lifecycle, attempt, fence, and version;
- require an explicit confirmation flag and operator identity/reason;
- acquire the same fenced claim used by automation;
- be idempotent and reject conflicting payloads;
- write an immutable operator audit record;
- print and persist before/after invariant results;
- refuse broad unbounded "repair everything" mutation.

Batch recovery is a bounded list of independently reviewed aggregate identities, not one wildcard write.

The targeted checks, dry-run defaults, abort conditions, and before/after census in `scripts/settle-w29-torrey.ts` and `scripts/retire-w30-bogus.ts` are worth retaining. Their hardcoded one-off logic is not.

### Read-triggered repair

Scheduled work is primary. A page/API read may only:

1. detect that an aggregate is overdue or visibly inconsistent using a cheap read;
2. enqueue the same settlement aggregate identity or invoke the same nonblocking claim entrypoint;
3. return the last valid view without waiting indefinitely.

It must not calculate standings, mutate lifecycle state, materialize bots, or maintain a separate settlement implementation. Repeated reads collapse through the same aggregate claim and deterministic keys.

## 14. Observability

### Metrics

At minimum:

- ended-but-unsettled aggregate count by type/world/tier;
- oldest unsettled age;
- settlement claims, successes, retryable failures, manual-review transitions;
- retries per aggregate and attempts per final settlement;
- active and stale claims;
- claim-to-snapshot, calculation, staging, primary-transaction, and end-to-end duration;
- field-lock duration and bot-materialization retries;
- duplicate-effect verified-no-op count;
- duplicate-effect payload-conflict count;
- input/output hash mismatch count;
- missing/duplicate effect count by type;
- projection/ledger mismatch count;
- missing/conflicting next enrollment count;
- Championship field underfill/overfill/duplicate count;
- outbox delivery age/retries;
- manual-review queue size and oldest age.

Alert on:

- any Championship field invariant failure;
- any hash or duplicate-payload mismatch;
- any settled aggregate missing expected effects;
- any stale claim beyond a configured grace period;
- oldest unsettled age beyond the normal settlement SLO;
- manual-review queue nonzero beyond acknowledgement SLO;
- repeated retryable failure for the same aggregate;
- missing next enrollment after a committed season.

### Structured logs

Every log/event includes:

- timestamp and severity;
- environment and code/build revision;
- Career namespace;
- `worldId`, aggregate type/id, season/cycle, tier, event number where applicable;
- lifecycle before/after;
- trigger (`cron`, `read-repair`, `manual`);
- attempt id, claim owner, fencing token, lease expiry;
- formula package and component versions;
- lock revision/hash, input hash, output hash, committed revision;
- expected and observed field/effect counts;
- transaction id/correlation id and duration;
- retry number and prior-attempt id;
- error class, safe public summary, internal stack/cause reference;
- operator identity/reason for manual actions.

These fields must allow an operator to diagnose one settlement from logs plus its snapshots, without arbitrary exploratory production queries.

## 15. Machine-checkable invariants

Identifiers below are intended to become named assertions/queries in the implementation and recovery verifier.

### Field and event invariants

1. `FIELD_ONE_LOCK`: a locked/active/ended/settled competition has exactly one authoritative lock revision.
2. `FIELD_SLOT_COUNT`: the authoritative field contains exactly its declared target number of slots.
3. `FIELD_SLOT_UNIQUE`: every slot identity appears once.
4. `FIELD_COMPETITOR_UNIQUE`: every competitor appears at most once.
5. `FIELD_IMMUTABLE_AFTER_LOCK`: lock hash never changes after `LOCKED`.
6. `BOT_RESULT_COMPLETE`: every locked bot slot has exactly one result matching its deterministic key and hash.
7. `EVENT_RESULT_COMPLETE`: every completed event has exactly one terminal result per locked competitor.
8. `EVENT_NO_SHOW_PRESENT`: a non-completer has an explicit no-show result and zero event points; it is not omitted.
9. `EVENT_STANDING_COMPLETE`: a settled event has exactly one final standing per locked competitor.
10. `EVENT_POINTS_MATCH`: stored event points equal the frozen occupied-position/tie calculation from the event snapshot.

### Regular-season invariants

11. `SEASON_FOUR_EVENTS`: a settled cohort references exactly four distinct committed event finals from that cohort.
12. `SEASON_ONE_HISTORY`: exactly one immutable season history exists per locked human participant.
13. `ACTIVE_MATCHES_COMPLETION`: `active == (completedEvents >= 3)` under the frozen package.
14. `BEST_THREE_MATCHES`: season points equal the frozen best-three-of-four calculation.
15. `SEASON_RANK_MATCHES`: rank and tiebreak evidence reproduce from the snapshot.
16. `MOVEMENT_EVIDENCE_MATCHES`: movement uses exactly the frozen eligible rolling evidence, skipping inactive seasons as specified.
17. `MOVEMENT_THRESHOLDS_MATCH`: promote/relegate/hold matches Candidate H thresholds and promotion floor/carry.
18. `LOCAL_FLOOR`: no performance result moves Local below Local.
19. `PRO_CEILING`: no normal performance result moves Pro above Pro.
20. `INACTIVITY_MATCHES`: inactivity count/tier behavior matches the frozen consecutive-inactivity rule and resets on activity.
21. `MOVEMENT_TIES_TOGETHER`: every exact boundary tie shares the same movement result.
22. `HUMAN_LIMIT`: promoted and relegated human counts are each at most the frozen limit except for the complete exact-boundary tie group; the output records base limit and expansion count.
23. `MOVEMENT_HISTORY_AGREES`: history `tier`, movement, and `nextTier` form a valid transition.
24. `RATING_ONE_PER_SEASON`: exactly one regular-season rating entry exists per season history, including inactive zero.
25. `RATING_AGGREGATE_MATCHES`: displayed Tour Rating equals the frozen best-six-of-last-eight calculation from committed chronological history.
26. `CHAMPIONSHIP_EXCLUDED_FROM_RATING`: no Championship result appears in Tour Rating inputs.
27. `LEGACY_LEDGER_SUM`: profile Legacy total equals the sum of committed immutable award effects.
28. `LEGACY_NONDECREASING`: absent an explicit correction record for corrupt data, committed Legacy never decreases.
29. `LEGACY_EFFECT_COMPLETE`: calculated expected Legacy keys equal persisted committed keys exactly.
30. `TROPHY_EFFECT_UNIQUE`: each source/trophy key appears at most once and points to the committed source revision.
31. `NEXT_ENROLLMENT_ONE`: every eligible unpaused profile has exactly one next-season enrollment.
32. `NEXT_ENROLLMENT_MATCHES`: enrollment world/season/tier/source match committed season history.

### Championship invariants

33. `CHAMPIONSHIP_FIELD_20`: a published Championship field has exactly 20 slots.
34. `CHAMPIONSHIP_UNIQUE`: all 20 competitor identities and slot identities are unique.
35. `QUALIFICATION_TRACE`: every human slot has a valid frozen source/pass-down trace; duplicate sources do not duplicate competitors.
36. `CHAMPIONSHIP_RESULT_COMPLETE`: a settled Championship has exactly one final result per locked qualifier.
37. `CHAMPIONSHIP_ONE_WINNER`: if the frozen rules produce an eligible winner, exactly one winner effect/trophy exists; otherwise an explicit no-winner output exists.
38. `CHAMPIONSHIP_NO_MOVEMENT`: Championship output contains zero movement, inactivity, regular rating, or regular enrollment effects.

### Settlement and retry invariants

39. `ONE_COMMITTED_REVISION`: each aggregate has zero or one authoritative committed settlement revision.
40. `CURRENT_FENCE_ONLY`: only the current fencing token may snapshot, stage, or commit.
41. `HASH_CHAIN_VALID`: committed lock, input, output, effect-manifest, and revision hashes agree.
42. `EFFECT_SET_EXACT`: committed deterministic effect keys equal the calculated manifest—no missing or extra effects.
43. `CONFLICT_PAYLOAD_EQUAL`: every reused idempotency key has the same canonical payload hash.
44. `ATOMIC_VISIBILITY`: if aggregate is not `SETTLED`, none of that revision's staged effects affect player-facing projections; if it is `SETTLED`, all expected effects do.
45. `RETRY_NO_NEW_EFFECTS`: rerunning a successful settlement produces zero new authoritative effects and the same hashes.
46. `PROJECTION_VERSION_MATCH`: profile projection version references its latest committed histories and ledger.
47. `OUTBOX_SOURCE_VALID`: every outbox message references a committed revision and has one stable delivery key.

## 16. Future implementation test plan

### Pure unit/property tests

- canonical serialization and stable hashes;
- event points, no-show zero, occupied ties, and event standing completeness;
- best-three-of-four and every season tiebreak;
- exact Candidate H thresholds (`0.58`, `0.65`, `0.32`) and floating-point representation;
- movement floors/ceilings, inactivity, promotion carry, limit, and exact tie expansion;
- Tour Rating chronological zero slots and best-six-of-eight;
- every Legacy award and duplicate source;
- Championship source priority, pass-down, deduplication, and exactly-20 fill;
- deterministic bot slot assignment/result replay;
- deterministic effect-key generation;
- state-machine transition tables;
- pure invariant checker over valid and deliberately corrupt snapshots;
- Eastern civil-date and DST boundaries.

Property tests should generate fields from 1 through at least 500 humans plus bots, dense ties, all-no-show fields, and duplicate qualification sources.

### Real transactional database tests

Mocks are insufficient for:

- unique constraints and conflicting-payload handling;
- atomic claim compare-and-set;
- lease heartbeat and stale-claim supersession;
- fencing an old worker after a newer claim;
- two or more concurrent cron/read/manual triggers;
- process death/fault injection before claim, after claim, after snapshot, during staging, during publication, and after commit before acknowledgement;
- transaction rollback proving zero partial movement/rating/award/enrollment visibility;
- unknown commit outcome followed by read-back and safe retry;
- deterministic staged-effect retries;
- profile projection compare-and-set conflicts;
- exactly-once next enrollment under concurrent settlement;
- Championship 20-slot atomic publication and uniqueness;
- simultaneous regular-season and Championship settlement for one profile;
- multi-Career-World and multi-tier-cohort concurrency;
- outbox creation in the primary transaction and repeated delivery;
- reconciliation and projection rebuild;
- a full 500-player settlement within transaction/SLO limits.

These tests should run against the same PostgreSQL major version and transaction isolation behavior used in production. SQLite and mocked Prisma do not prove locking, isolation, unique-conflict, or crash semantics.

### End-to-end deterministic replay

Persist a fixture's input snapshot and expected output hash, settle it, change the default formula package in the test process, and prove:

- retry still selects the pinned old package;
- dry-run reproduces the old output byte-for-byte;
- latest formulas cannot overwrite the committed result;
- removing the pinned package causes `MANUAL_REVIEW`, not fallback.

### Recovery acceptance tests

For every row in the failure matrix:

1. create or inject the fault;
2. prove the detector identifies it;
3. run dry-run and inspect proposed effects;
4. execute the bounded repair/retry;
5. run all named invariants;
6. rerun the same action and prove no new authoritative effects;
7. produce a post-recovery audit report.

## 17. Relationship to the current Weekly Tournament system

### Patterns worth reusing

- **Pure clock and ranking functions.** `lib/tournament.ts` keeps schedule, phase, cut, tie expansion, and seed helpers pure and explicitly testable.
- **Database uniqueness as a race backstop.** `Tournament.weekKey`, `(TournamentEntry.tournamentId, userId)`, `(Round.tournamentEntryId, tournamentRoundNo)`, `(HoleResult.roundId, holeNumber)`, and `(TrophyAward.userId, trophyId)` demonstrate useful stable identities in `prisma/schema.prisma`.
- **Conditional updates.** Round finalization and tournament claims use false-to-true/null-to-value compare-and-set updates.
- **Atomic result plus score update.** `app/api/round/[id]/hole/route.ts` correctly uses a transaction so a duplicate hole insert rolls back the score increment.
- **Deterministic bot materialization.** `lib/challengeBot.ts` derives bot play from stable identity/seed and uses unique hole identities.
- **Dry-run and safety rails.** Recovery scripts print exact targets, expected state, leaderboard/census evidence, and require `--commit`.
- **State-based orphan detection.** Looking for ended-but-unsettled aggregates is stronger than a hardcoded week.
- **Tie generosity at a boundary.** `computeCut` extends through exact ties; Career movement preserves the same proven principle.
- **A scheduled heartbeat.** `vercel.json` and `app/api/tournament/tick/route.ts` removed dependence on traffic for weekly rollover.

### Patterns unsafe to reuse

- **Read paths that mutate lifecycle.** `getActiveTournament` creates weeks, runs cuts, settles prior events, updates status, and heals schedules. The tick route invokes a read to drive writes. This made correctness depend on call ordering and caused a skipped/orphaned week.
- **A guard written before non-transactional effects.** `runCut` sets `cutComputedAt` at `lib/tournament.server.ts:470-473`, then performs many independent entry updates at `:497-507`. A crash after the guard can make an incomplete cut appear complete.
- **Winner before trophy.** `settleTournament` writes `winnerUserId` at `lib/tournament.server.ts:579-582`, then awards the trophy at `:585-589`. A crash between them makes retry return early because the winner is already set, leaving a missing trophy.
- **Sentinel values over explicit state.** `winnerUserId = ""` represents settled-with-no-winner. Explicit result state is more inspectable and less error-prone.
- **Calculation from mutable live rows without a snapshot/version.** Weekly settlement recomputes from current entries and rounds, so a later retry cannot prove it used the same inputs or code.
- **No leases or fencing.** `cutComputedAt` and `winnerUserId` prevent some duplicate work but cannot recover safely from a worker that claims and dies, nor fence an old worker after retry.
- **No aggregate transaction for dependent effects.** Cut entries, winner, and trophy are not one publication boundary.
- **Pure-unit-only lifecycle coverage.** `tests/tournament.test.ts` validates schedule/cut functions but does not exercise server settlement concurrency or rollback against a real database.
- **One-off repair scripts as the primary recovery surface.** The scripts are careful but duplicate production ranking logic and require incident-specific code.

### Incident lessons

Repository evidence records three connected failure classes:

1. **Orphaned settlement through control-flow ordering.** The Torrey Pines W29 incident left 118 four-round finishers without a champion because the orphan sweep sat after the live-event early return. Commit `27adcd3` moved the sweep; `scripts/settle-w29-torrey.ts` performed targeted recovery.
2. **Traffic-dependent rollover and skipped weeks.** Commit `b3dec81` added a daily tick, current-week backfill, course self-heal, and champion recency bound after a week could be skipped and an old Pebble Beach champion remained visible.
3. **Schedule identity drift and duplicate/bogus rows.** `scripts/retire-w30-bogus.ts`, `move-torrey-to-thisweek.ts`, and duplicate cleanup scripts show that mutable dates, week identity, and lazy creation can diverge. Repairs had to preserve valid player rounds while retiring only administrative state.

Career Mode has more coupled effects than Weekly Tournament: one season simultaneously determines history, movement, ratings, permanent currency, qualification, and future enrollment. A loose sequence of nullable guards would multiply the same failure modes. Career therefore requires immutable snapshots, deterministic manifests, fenced attempts, atomic publication, and first-class reconciliation from its first production release.

Weekly Tournament remains unchanged during Career work. Its current records are evidence, not a migration source or shared state machine.

## 18. Implementation sequence for later gates

This document authorizes no implementation, but the dependency order is:

1. Gate 5 bot roster/identity design using the field-lock contract;
2. conceptual data/schema design for worlds, profiles, cohorts, competitions, lock revisions, settlement attempts/revisions, immutable histories/ledgers, enrollment, and outbox;
3. pure canonical snapshot/output/effect-manifest package;
4. real-database claim/fence/publication prototype and fault-injection tests;
5. event settlement;
6. season settlement and projections;
7. Championship qualification/settlement;
8. recovery CLI, reconciliation, observability, and runbooks;
9. scheduled worker and read-trigger enqueue;
10. only then API/UI integration.

Each stage must preserve the named invariants and cannot weaken atomic visibility for convenience.

## 19. Gate verdict

**PASS — Gate 4 is complete and ready for bot-roster Gate 5.**

No unresolved product decision blocks settlement architecture. Lease durations, queue provider, physical table layout, transaction isolation tuning, and staging representation are later technical-design choices, but their required behavior is fixed here:

- independent aggregate and attempt state machines;
- immutable locked fields and settlement snapshots;
- versioned deterministic calculation with stored inputs, outputs, and hashes;
- atomic claims with leases and fencing;
- deterministic effect identities and exact-payload conflict checks;
- invisible staging plus one atomic publication boundary;
- immutable histories/ledgers with derived projections;
- exactly-20 atomic Championship fields;
- movement/enrollment consistency;
- dry-run-first, bounded, audited recovery;
- scheduled settlement as primary and nonblocking read-triggered repair as backup;
- real-database crash and concurrency testing before production.

Gate 3 remains frozen as `career-v1-freeze-candidate`. No production Career or Weekly Tournament implementation is part of this gate.
