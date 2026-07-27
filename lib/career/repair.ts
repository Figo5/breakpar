/**
 * Career Mode — read-triggered repair (nonblocking overdue detection).
 *
 * Scheduled work (`runCareerTick`, the cron) is PRIMARY. This module is the
 * backup the design allows a page/API read to use (docs/career-settlement-
 * recovery.md §13): a read may only
 *   1. detect that work is overdue using a cheap, read-only query;
 *   2. enqueue / invoke the same nonblocking tick entrypoint;
 *   3. return immediately with the last valid view.
 *
 * It must NEVER calculate standings, mutate lifecycle, materialize bots, or hold
 * a settlement transaction in the request path — that is the Weekly Tournament
 * anti-pattern (`getActiveTournament` mutating lifecycle from a read) that this
 * design deliberately avoids. `careerWorkPending` runs indexed existence counts
 * only; `triggerCareerRepairIfPending` hands off to an injectable, non-awaited
 * `enqueue` so the caller's request never blocks on settlement.
 */
import type { PrismaClient } from "@prisma/client";

import { runCareerTick } from "./scheduler";

export interface CareerWorkPending {
  /** FORMING cohorts whose field was never locked (shell-only seasons). */
  readonly seasonsUnlocked: number;
  /** ACTIVE events whose player has finished but which are not settled. */
  readonly eventsToClose: number;
  /** ENDED events awaiting settlement. */
  readonly eventsEndedUnsettled: number;
  /** ACTIVE cohorts whose four events are all SETTLED (ready to close). */
  readonly seasonsToClose: number;
  /** ENDED cohorts awaiting settlement. */
  readonly cohortsEndedUnsettled: number;
  /** SETTLED cohorts with no successor season. */
  readonly seasonsMissingSuccessor: number;
  /** FORMING championships whose field was never published. */
  readonly championshipsFieldPending: number;
  /** ACTIVE championships whose player has finished but which are not closed. */
  readonly championshipsToClose: number;
  /** ENDED championships awaiting settlement. */
  readonly championshipsEndedUnsettled: number;
  /** Attempts explicitly marked retryable. */
  readonly retryableAttempts: number;
  /** Sum of all pending categories. */
  readonly total: number;
}

/** True when any Career lifecycle work is overdue. */
export function careerWorkIsPending(work: CareerWorkPending): boolean {
  return work.total > 0;
}

/**
 * Cheap, READ-ONLY overdue detection. Runs a handful of indexed existence
 * counts and never mutates lifecycle state. Over-detection is safe (the tick
 * re-checks full readiness and no-ops); under-detection is the only real risk,
 * so each check errs toward inclusion.
 */
export async function careerWorkPending(
  db: PrismaClient,
  _now = new Date(),
): Promise<CareerWorkPending> {
  const [
    seasonsUnlocked,
    eventsToClose,
    eventsEndedUnsettled,
    seasonsToClose,
    cohortsEndedUnsettled,
    settledCohorts,
    championshipsFieldPending,
    championshipsToClose,
    championshipsEndedUnsettled,
    retryableAttempts,
  ] = await Promise.all([
    // A season whose shell exists but whose field never locked.
    db.careerCohort.count({ where: { state: "FORMING" } }),
    // The player finished; the event should have closed and settled.
    db.careerCompetition.count({
      where: {
        kind: "EVENT",
        state: "ACTIVE",
        eventEntries: { some: {}, every: { completed: true } },
      },
    }),
    db.careerCompetition.count({ where: { kind: "EVENT", state: "ENDED" } }),
    db.careerCohort.count({
      where: { state: "ACTIVE", competitions: { some: {}, every: { state: "SETTLED" } } },
    }),
    db.careerCohort.count({ where: { state: "ENDED" } }),
    db.careerCohort.findMany({
      where: { state: "SETTLED" },
      select: { worldId: true, seasonNumber: true },
    }),
    db.careerChampionship.count({ where: { state: "FORMING" } }),
    db.careerChampionship.count({
      where: {
        state: "ACTIVE",
        results: { some: { competitorType: "HUMAN", completed: true } },
      },
    }),
    db.careerChampionship.count({ where: { state: "ENDED" } }),
    db.careerSettlementAttempt.count({ where: { state: "FAILED_RETRYABLE" } }),
  ]);

  // A settled season must always have a successor waiting.
  let seasonsMissingSuccessor = 0;
  if (settledCohorts.length > 0) {
    const successors = new Set(
      (await db.careerCohort.findMany({
        where: { worldId: { in: settledCohorts.map((cohort) => cohort.worldId) } },
        select: { worldId: true, seasonNumber: true },
      })).map((cohort) => `${cohort.worldId}:${cohort.seasonNumber}`),
    );
    seasonsMissingSuccessor = settledCohorts.filter(
      (cohort) => !successors.has(`${cohort.worldId}:${cohort.seasonNumber + 1}`),
    ).length;
  }

  const total =
    seasonsUnlocked
    + eventsToClose
    + eventsEndedUnsettled
    + seasonsToClose
    + cohortsEndedUnsettled
    + seasonsMissingSuccessor
    + championshipsFieldPending
    + championshipsToClose
    + championshipsEndedUnsettled
    + retryableAttempts;

  return {
    seasonsUnlocked,
    eventsToClose,
    eventsEndedUnsettled,
    seasonsToClose,
    cohortsEndedUnsettled,
    seasonsMissingSuccessor,
    championshipsFieldPending,
    championshipsToClose,
    championshipsEndedUnsettled,
    retryableAttempts,
    total,
  };
}

export interface CareerRepairResult {
  readonly pending: boolean;
  readonly work: CareerWorkPending;
  readonly enqueued: boolean;
}

/**
 * How to run the tick out of band. It MUST NOT be awaited by the read path.
 * The default fires `runCareerTick` detached and swallows errors (the cron is
 * the reliable path; this is best-effort backup). A production deployment can
 * inject a durable enqueue instead — e.g. Vercel `waitUntil`, a task queue, or
 * an internal fetch to `/api/career/tick`.
 */
export type CareerRepairEnqueue = (db: PrismaClient, now: Date) => void;

const detachedTickEnqueue: CareerRepairEnqueue = (db, now) => {
  void runCareerTick(db, { now }).catch(() => {
    // Swallow — the cron re-drives any work this best-effort tick missed.
  });
};

interface CareerRepairOptions {
  readonly now?: Date;
  readonly enqueue?: CareerRepairEnqueue;
}

/**
 * Detect overdue Career work with a cheap read and, if any exists, hand off to a
 * nonblocking tick. This function performs NO lifecycle mutation itself — it only
 * reads and enqueues. Safe to call from a request path; it returns immediately.
 */
export async function triggerCareerRepairIfPending(
  db: PrismaClient,
  options: CareerRepairOptions = {},
): Promise<CareerRepairResult> {
  const now = options.now ?? new Date();
  const work = await careerWorkPending(db, now);
  const pending = careerWorkIsPending(work);
  if (!pending) return { pending: false, work, enqueued: false };
  const enqueue = options.enqueue ?? detachedTickEnqueue;
  enqueue(db, now);
  return { pending: true, work, enqueued: true };
}
