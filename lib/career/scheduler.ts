/**
 * Career Mode — recovery scan (player-paced).
 *
 * Player-paced Career is driven by the PLAYER: finishing a round closes and
 * settles its event, the fourth finish settles the season and opens the next,
 * and a Championship settles when its round is played (see `journey.ts`). None
 * of that waits on a clock, so the cron is no longer a progression engine.
 *
 * What remains is a safety net. This scan finds work the write path failed to
 * finish — a crashed request, a lost connection, a transient conflict — and
 * completes it by calling the very same orchestrators, never a parallel
 * implementation. Every calendar predicate is gone: nothing here is "due"
 * because time passed, only because a state transition was left incomplete.
 *
 * Failures are recorded per aggregate and skipped, so one bad row can never
 * stop the rest of the sweep.
 */
import type { PrismaClient } from "@prisma/client";

import { CareerChampionshipSettlementService } from "./championshipSettlement";
import { CareerEventSettlementService } from "./eventSettlement";
import { CareerSeasonSettlementService } from "./seasonSettlement";
import {
  advanceCareerAfterFinish,
  advanceChampionshipAfterFinish,
  ensureChampionshipFieldsPublished,
  ensureSeasonFieldLocked,
} from "./journey";

export const CAREER_TICK_OWNER = "career-tick";

export interface CareerTickSummary {
  readonly at: string;
  /** Shell-only seasons whose field this scan locked. */
  readonly seasonFieldsLocked: number;
  /** Events this scan closed and settled. */
  readonly eventsSettled: number;
  /** Seasons this scan settled. */
  readonly seasonsSettled: number;
  /** Successor seasons whose field this scan locked. */
  readonly successorFieldsLocked: number;
  /** Championship fields this scan published. */
  readonly championshipsFieldPublished: number;
  /** Championships this scan settled. */
  readonly championshipsSettled: number;
  readonly errors: readonly string[];
}

interface CareerTickOptions {
  readonly now?: Date;
  readonly owner?: string;
  readonly runtimeRevision?: string;
}

export async function runCareerTick(
  db: PrismaClient,
  options: CareerTickOptions = {},
): Promise<CareerTickSummary> {
  const now = options.now ?? new Date();
  const runtimeRevision = options.runtimeRevision;
  const runtime = runtimeRevision ? { runtimeRevision } : {};
  const owner = options.owner ?? CAREER_TICK_OWNER;
  const errors: string[] = [];

  const note = (stage: string, id: string, error: unknown): void => {
    errors.push(`${stage}:${id}:${error instanceof Error ? error.message : String(error)}`);
  };

  // 1. Shell-only seasons: the cohort exists but its field never locked.
  let seasonFieldsLocked = 0;
  const unlockedSeasons = await db.careerCohort.findMany({
    where: { state: "FORMING" },
    select: { id: true },
  });
  for (const cohort of unlockedSeasons) {
    try {
      if (await ensureSeasonFieldLocked(db, cohort.id, owner, options) === "locked") {
        seasonFieldsLocked += 1;
      }
    } catch (error) {
      note("season-field", cohort.id, error);
    }
  }

  // 2. Events whose player finished but which never closed or settled. Driving
  //    them through `advanceCareerAfterFinish` also picks up the season
  //    settlement and successor-season creation the write path missed.
  let eventsSettled = 0;
  let seasonsSettled = 0;
  let championshipsFieldPublished = 0;
  const strandedEvents = await db.careerCompetition.findMany({
    where: {
      kind: "EVENT",
      state: "ACTIVE",
      eventEntries: { some: {}, every: { completed: true } },
    },
    select: { id: true },
  });
  for (const event of strandedEvents) {
    try {
      const advanced = await advanceCareerAfterFinish(db, event.id, options);
      eventsSettled += advanced.eventsSettled;
      if (advanced.seasonSettled) seasonsSettled += 1;
      if (advanced.championshipId) championshipsFieldPublished += 1;
    } catch (error) {
      note("event", event.id, error);
    }
  }

  // 3. Events already ENDED but unsettled (the close committed, the settle did not).
  const endedEvents = await db.careerCompetition.findMany({
    where: { kind: "EVENT", state: "ENDED" },
    select: { id: true },
  });
  const eventSettlement = new CareerEventSettlementService(db, runtime);
  for (const event of endedEvents) {
    try {
      if ((await eventSettlement.settle(event.id, owner, "cron")).status === "settled") {
        eventsSettled += 1;
      }
    } catch (error) {
      note("event-ended", event.id, error);
    }
  }

  // 4. Seasons whose four events are settled: close, then settle.
  const seasonSettlement = new CareerSeasonSettlementService(db, runtime);
  try {
    await seasonSettlement.closeDue(now);
  } catch (error) {
    note("season-close", "*", error);
  }
  const endedCohorts = await db.careerCohort.findMany({
    where: { state: "ENDED" },
    select: { id: true },
  });
  for (const cohort of endedCohorts) {
    try {
      if ((await seasonSettlement.settle(cohort.id, owner, "cron")).status === "settled") {
        seasonsSettled += 1;
      }
    } catch (error) {
      note("season", cohort.id, error);
    }
  }

  // 5. Settled seasons must always have a playable successor.
  let successorFieldsLocked = 0;
  const settledCohorts = await db.careerCohort.findMany({
    where: { state: "SETTLED" },
    select: { worldId: true, seasonNumber: true },
  });
  for (const cohort of settledCohorts) {
    const successor = await db.careerCohort.findFirst({
      where: { worldId: cohort.worldId, seasonNumber: cohort.seasonNumber + 1 },
      select: { id: true, state: true },
    });
    if (!successor || successor.state !== "FORMING") continue;
    try {
      if (await ensureSeasonFieldLocked(db, successor.id, owner, options) === "locked") {
        successorFieldsLocked += 1;
      }
    } catch (error) {
      note("successor-field", successor.id, error);
    }
  }

  // 6. Championships unlocked but never given a field.
  const pendingWorlds = await db.careerChampionship.findMany({
    where: { state: "FORMING" },
    select: { worldId: true },
    distinct: ["worldId"],
  });
  for (const world of pendingWorlds) {
    try {
      if (await ensureChampionshipFieldsPublished(db, world.worldId, options)) {
        championshipsFieldPublished += 1;
      }
    } catch (error) {
      note("championship-field", world.worldId, error);
    }
  }

  // 7. Championships whose player finished but which never settled.
  let championshipsSettled = 0;
  const playedChampionships = await db.careerChampionship.findMany({
    where: {
      OR: [
        { state: "ACTIVE", results: { some: { competitorType: "HUMAN", completed: true } } },
        { state: "ENDED" },
      ],
    },
    select: { id: true },
  });
  for (const championship of playedChampionships) {
    try {
      if ((await advanceChampionshipAfterFinish(db, championship.id, options)).settled) {
        championshipsSettled += 1;
      }
    } catch (error) {
      note("championship", championship.id, error);
    }
  }

  // 8. Aggregates parked as explicitly retryable get one more claim.
  const retryable = await db.careerSettlementAttempt.findMany({
    where: { state: "FAILED_RETRYABLE" },
    select: { aggregateType: true, aggregateId: true },
    distinct: ["aggregateType", "aggregateId"],
  });
  const championshipSettlement = new CareerChampionshipSettlementService(db, runtime);
  for (const attempt of retryable) {
    try {
      if (attempt.aggregateType === "EVENT") {
        if ((await eventSettlement.settle(attempt.aggregateId, owner, "cron")).status === "settled") {
          eventsSettled += 1;
        }
      } else if (attempt.aggregateType === "SEASON") {
        if ((await seasonSettlement.settle(attempt.aggregateId, owner, "cron")).status === "settled") {
          seasonsSettled += 1;
        }
      } else if (attempt.aggregateType === "CHAMPIONSHIP") {
        if ((await championshipSettlement.settle(attempt.aggregateId, owner, "cron")).status === "settled") {
          championshipsSettled += 1;
        }
      }
    } catch (error) {
      note("retry", attempt.aggregateId, error);
    }
  }

  return {
    at: now.toISOString(),
    seasonFieldsLocked,
    eventsSettled,
    seasonsSettled,
    successorFieldsLocked,
    championshipsFieldPublished,
    championshipsSettled,
    errors,
  };
}
