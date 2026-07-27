/**
 * Career Mode — recovery / reconciliation / observability (READ-ONLY diagnostics
 * + one bounded operator repair path).
 *
 * Everything here except `careerManualRetry` is strictly read-only: it queries
 * raw state and NEVER calls an application read that mutates lifecycle (the
 * Weekly Tournament anti-pattern that `scripts/diag-tournaments.ts` deliberately
 * avoids by not calling `getActiveTournament`).
 *
 * The single mutation path, `careerManualRetry`, is bounded to ONE named
 * aggregate, dry-run by default, and reuses the existing settlement services
 * (which go through the same `CareerSettlementEngine` claim entrypoint with
 * `trigger: "manual"`). It never reimplements ranking/settlement math and never
 * performs an unbounded "repair everything" mutation.
 *
 * See docs/career-settlement-recovery.md §13–15.
 */
import type { PrismaClient } from "@prisma/client";

import { CareerEventSettlementService } from "./eventSettlement";
import { CareerSeasonSettlementService } from "./seasonSettlement";
import { CareerChampionshipSettlementService } from "./championshipSettlement";

export type CareerAggregateKind = "EVENT" | "SEASON" | "CHAMPIONSHIP";

// ---------------------------------------------------------------------------
// Observability census (read-only)
// ---------------------------------------------------------------------------

export interface CareerSettlementCensus {
  readonly at: string;
  readonly endedUnsettled: {
    readonly event: number;
    readonly season: number;
    readonly championship: number;
    readonly total: number;
  };
  /** ms since the oldest ended-but-unsettled aggregate became due, or null. */
  readonly oldestUnsettledAgeMs: number | null;
  readonly activeClaims: number;
  readonly staleClaims: number;
  readonly manualReviewAttempts: number;
  readonly retryableAttempts: number;
}

export async function careerSettlementCensus(
  db: PrismaClient,
  now = new Date(),
): Promise<CareerSettlementCensus> {
  const [
    endedEvents,
    endedCohorts,
    endedChampionships,
    oldestEndedEvent,
    oldestEndedCohort,
    oldestEndedChampionship,
    activeCompetitionClaims,
    activeCohortClaims,
    activeChampionshipClaims,
    staleCompetitionClaims,
    staleCohortClaims,
    staleChampionshipClaims,
    manualReviewAttempts,
    retryableAttempts,
  ] = await Promise.all([
    db.careerCompetition.count({ where: { kind: "EVENT", state: "ENDED" } }),
    db.careerCohort.count({ where: { state: "ENDED" } }),
    db.careerChampionship.count({ where: { state: "ENDED" } }),
    db.careerCompetition.findFirst({
      where: { kind: "EVENT", state: "ENDED" },
      orderBy: { deadlineAt: "asc" },
      select: { deadlineAt: true },
    }),
    db.careerCohort.findFirst({
      where: { state: "ENDED" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.careerChampionship.findFirst({
      where: { state: "ENDED" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.careerCompetition.count({ where: { claimOwner: { not: null }, leaseExpiresAt: { gt: now } } }),
    db.careerCohort.count({ where: { claimOwner: { not: null }, leaseExpiresAt: { gt: now } } }),
    db.careerChampionship.count({ where: { claimOwner: { not: null }, leaseExpiresAt: { gt: now } } }),
    db.careerCompetition.count({ where: { claimOwner: { not: null }, leaseExpiresAt: { lte: now } } }),
    db.careerCohort.count({ where: { claimOwner: { not: null }, leaseExpiresAt: { lte: now } } }),
    db.careerChampionship.count({ where: { claimOwner: { not: null }, leaseExpiresAt: { lte: now } } }),
    db.careerSettlementAttempt.count({ where: { state: "MANUAL_REVIEW" } }),
    db.careerSettlementAttempt.count({ where: { state: "FAILED_RETRYABLE" } }),
  ]);

  const candidateTimes = [
    oldestEndedEvent?.deadlineAt,
    oldestEndedCohort?.createdAt,
    oldestEndedChampionship?.createdAt,
  ].filter((value): value is Date => value != null);
  const oldest = candidateTimes.length > 0
    ? Math.min(...candidateTimes.map((value) => value.getTime()))
    : null;

  return {
    at: now.toISOString(),
    endedUnsettled: {
      event: endedEvents,
      season: endedCohorts,
      championship: endedChampionships,
      total: endedEvents + endedCohorts + endedChampionships,
    },
    oldestUnsettledAgeMs: oldest == null ? null : Math.max(0, now.getTime() - oldest),
    activeClaims: activeCompetitionClaims + activeCohortClaims + activeChampionshipClaims,
    staleClaims: staleCompetitionClaims + staleCohortClaims + staleChampionshipClaims,
    manualReviewAttempts,
    retryableAttempts,
  };
}

// ---------------------------------------------------------------------------
// Invariant checks (pure) + DB reconcile wrappers (read-only)
// ---------------------------------------------------------------------------

export interface ReconcileIssue {
  readonly scope: string;
  readonly invariant: string;
  readonly detail: string;
}

/** legacyTotal projection must equal the immutable ledger sum for the profile. */
export function reconcileLegacyProjection(
  profileId: string,
  legacyTotal: number,
  ledgerSum: number,
): ReconcileIssue | null {
  if (legacyTotal === ledgerSum) return null;
  return {
    scope: `profile:${profileId}`,
    invariant: "legacy-projection-matches-ledger",
    detail: `legacyTotal ${legacyTotal} !== ledger sum ${ledgerSum}`,
  };
}

export interface ChampionshipResultView {
  readonly slotNumber: number;
  readonly completed: boolean;
  readonly rank: number | null;
  readonly isWinner: boolean;
}

/**
 * Once a Championship is SETTLED, its results must be internally consistent:
 * a full 20-slot field, exactly one winner, and every competitor completed and
 * ranked. Absence is unreachable in player-paced Career — an unplayed
 * Championship never settles — so an incomplete result here is corruption.
 */
export function reconcileChampionshipStandings(
  championshipId: string,
  state: string,
  fieldSize: number,
  results: readonly ChampionshipResultView[],
): ReconcileIssue[] {
  if (state !== "SETTLED") return [];
  const scope = `championship:${championshipId}`;
  const issues: ReconcileIssue[] = [];
  if (results.length !== fieldSize) {
    issues.push({ scope, invariant: "championship-field-complete", detail: `${results.length} results, expected ${fieldSize}` });
  }
  const winners = results.filter((result) => result.isWinner);
  if (winners.length !== 1) {
    issues.push({ scope, invariant: "championship-single-winner", detail: `${winners.length} winners` });
  }
  for (const result of results) {
    if (result.completed && result.rank == null) {
      issues.push({ scope, invariant: "championship-completed-ranked", detail: `slot ${result.slotNumber} completed but unranked` });
    }
    if (!result.completed) {
      issues.push({ scope, invariant: "championship-all-completed", detail: `slot ${result.slotNumber} is incomplete in a settled championship` });
    }
  }
  return issues;
}

export async function careerReconcileProfile(
  db: PrismaClient,
  profileId: string,
): Promise<ReconcileIssue[]> {
  const profile = await db.careerProfile.findUnique({
    where: { id: profileId },
    select: { legacyTotal: true },
  });
  if (!profile) return [{ scope: `profile:${profileId}`, invariant: "profile-exists", detail: "profile not found" }];
  const ledger = await db.careerLegacyLedger.aggregate({
    where: { profileId },
    _sum: { points: true },
  });
  const issue = reconcileLegacyProjection(profileId, profile.legacyTotal, ledger._sum.points ?? 0);
  return issue ? [issue] : [];
}

export async function careerReconcileChampionship(
  db: PrismaClient,
  championshipId: string,
): Promise<ReconcileIssue[]> {
  const championship = await db.careerChampionship.findUnique({
    where: { id: championshipId },
    include: {
      competitions: { where: { kind: "CHAMPIONSHIP" }, select: { targetFieldSize: true } },
      results: { select: { slotNumber: true, completed: true, rank: true, isWinner: true } },
    },
  });
  if (!championship) {
    return [{ scope: `championship:${championshipId}`, invariant: "championship-exists", detail: "championship not found" }];
  }
  const fieldSize = championship.competitions[0]?.targetFieldSize ?? 20;
  return reconcileChampionshipStandings(
    championshipId,
    championship.state,
    fieldSize,
    championship.results,
  );
}

// ---------------------------------------------------------------------------
// Bounded operator repair (the ONLY mutation path)
// ---------------------------------------------------------------------------

export interface CareerManualRetryResult {
  readonly aggregateType: CareerAggregateKind;
  readonly aggregateId: string;
  readonly committed: boolean;
  /** In dry-run: whether the aggregate is currently eligible to settle. */
  readonly eligible: boolean;
  readonly state: string | null;
  /** Present only when committed. */
  readonly outcome?: string;
}

async function aggregateState(
  db: PrismaClient,
  aggregateType: CareerAggregateKind,
  id: string,
): Promise<string | null> {
  if (aggregateType === "EVENT") {
    return (await db.careerCompetition.findUnique({ where: { id }, select: { state: true } }))?.state ?? null;
  }
  if (aggregateType === "SEASON") {
    return (await db.careerCohort.findUnique({ where: { id }, select: { state: true } }))?.state ?? null;
  }
  return (await db.careerChampionship.findUnique({ where: { id }, select: { state: true } }))?.state ?? null;
}

/**
 * Retry settlement of ONE named aggregate through the same engine claim path
 * (`trigger: "manual"`). Dry-run by default — pass `commit: true` to actually
 * settle. Refuses anything that is not currently ENDED (eligible). It never
 * batches, never scans, and never reimplements settlement math.
 */
export async function careerManualRetry(
  db: PrismaClient,
  aggregateType: CareerAggregateKind,
  id: string,
  options: { commit?: boolean; owner?: string } = {},
): Promise<CareerManualRetryResult> {
  const owner = options.owner ?? "career-ops-manual";
  const state = await aggregateState(db, aggregateType, id);
  const eligible = state === "ENDED";
  if (!options.commit || !eligible) {
    return { aggregateType, aggregateId: id, committed: false, eligible, state };
  }

  let outcome: string;
  if (aggregateType === "EVENT") {
    outcome = (await new CareerEventSettlementService(db).settle(id, owner, "manual")).status;
  } else if (aggregateType === "SEASON") {
    outcome = (await new CareerSeasonSettlementService(db).settle(id, owner, "manual")).status;
  } else {
    outcome = (await new CareerChampionshipSettlementService(db).settle(id, owner, "manual")).status;
  }
  return {
    aggregateType,
    aggregateId: id,
    committed: outcome === "settled",
    eligible,
    state: await aggregateState(db, aggregateType, id),
    outcome,
  };
}
