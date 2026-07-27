/**
 * Career Mode — Journey and season orchestration (player-paced).
 *
 * Composes the two halves of "start a season": the shell (`world.ts` — Journey,
 * profile, cohort, four events, membership, entries) and the locked field
 * (`formation.ts` — one human plus nineteen bots, with every bot's card for all
 * four events materialized deterministically).
 *
 * They are deliberately separate transactions: formation owns its own atomic
 * publication boundary (fencing token, staged effects, outbox) and cannot be
 * nested inside the shell transaction. Both halves are idempotent, so a caller
 * that fails between them simply retries, and the recovery scan finds any season
 * left shell-only. See docs/career-player-paced-design.md §4–§5.
 */
import type { PrismaClient } from "@prisma/client";

import { CareerChampionshipCoordinator } from "./championship";
import { CareerChampionshipSettlementService } from "./championshipSettlement";
import { CareerEventSettlementService } from "./eventSettlement";
import { CareerFormationService, type BotRoundSimulator } from "./formation";
import { CareerSeasonSettlementService } from "./seasonSettlement";
import { CareerWorldService, type CareerEnrollmentState } from "./world";

export interface StartCareerSeasonOptions {
  readonly now?: Date;
  readonly runtimeRevision?: string;
  /** Test seam: force a deterministic bot score. */
  readonly simulateBotRound?: BotRoundSimulator;
}

function formationService(
  db: PrismaClient,
  options: StartCareerSeasonOptions,
): CareerFormationService {
  return new CareerFormationService(db, {
    ...(options.runtimeRevision ? { runtimeRevision: options.runtimeRevision } : {}),
    ...(options.simulateBotRound ? { simulateBotRound: options.simulateBotRound } : {}),
  });
}

/**
 * Lock a season's field if it is not locked yet. Idempotent: an already-locked
 * cohort reports `already-locked` and nothing is rewritten.
 */
export async function ensureSeasonFieldLocked(
  db: PrismaClient,
  cohortId: string,
  owner: string,
  options: StartCareerSeasonOptions = {},
): Promise<"locked" | "already-locked"> {
  const result = await formationService(db, options).lock(cohortId, owner);
  return result.status === "locked" ? "locked" : "already-locked";
}

/**
 * Enter Career (or resume it) with a playable season.
 *
 * Creates the personal Journey, profile, season 1 and its four events on first
 * call, then locks the field so all four events are immediately playable.
 * Repeated calls return the same Journey, the same season, and the same field.
 */
export async function startCareerJourney(
  db: PrismaClient,
  userId: string,
  options: StartCareerSeasonOptions = {},
): Promise<CareerEnrollmentState> {
  const service = new CareerWorldService(db);
  const state = await service.enter(userId, options.now ?? new Date());

  await ensureSeasonFieldLocked(
    db,
    state.cohort.id,
    `career-entry:${state.profile.id}`,
    options,
  );

  // Re-read so the caller sees the locked field's state, not the pre-lock shell.
  return service.enter(userId, options.now ?? new Date());
}

export interface AdvanceCareerResult {
  /** Events that closed and settled as a result of this call. */
  readonly eventsSettled: number;
  /** True when the fourth event completed the season and it settled. */
  readonly seasonSettled: boolean;
  /** The newly created next season's cohort, when a season settled. */
  readonly nextCohortId: string | null;
  /** A Championship whose field was published by this call, if any. */
  readonly championshipId: string | null;
}

/**
 * Publish the field for any Championship this Journey has unlocked but not yet
 * populated. Idempotent, and safe to call when there is nothing to do.
 *
 * Separate from season settlement because field publication is a formation
 * boundary with its own atomic transaction.
 */
export async function ensureChampionshipFieldsPublished(
  db: PrismaClient,
  worldId: string,
  options: StartCareerSeasonOptions = {},
): Promise<string | null> {
  const pending = await db.careerChampionship.findMany({
    where: { worldId, state: "FORMING" },
    orderBy: { cycleNumber: "asc" },
    select: { id: true },
  });
  const coordinator = new CareerChampionshipCoordinator(
    db,
    options.runtimeRevision ? { runtimeRevision: options.runtimeRevision } : {},
  );
  let published: string | null = null;
  for (const championship of pending) {
    const result = await coordinator.publishField(
      championship.id,
      `career-championship:${championship.id}`,
      options.now ?? new Date(),
    );
    if (result.status === "published") published = championship.id;
  }
  return published;
}

/**
 * Settle a Championship once its player has finished their round.
 *
 * Called from the write path after a Championship round finishes. Idempotent,
 * and a no-op while the Championship is still unplayed — an unplayed
 * Championship never settles and never expires.
 */
export async function advanceChampionshipAfterFinish(
  db: PrismaClient,
  championshipId: string,
  options: StartCareerSeasonOptions = {},
): Promise<{ readonly settled: boolean }> {
  const service = new CareerChampionshipSettlementService(
    db,
    options.runtimeRevision ? { runtimeRevision: options.runtimeRevision } : {},
  );
  await service.closeDue(options.now ?? new Date());
  const championship = await db.careerChampionship.findUnique({
    where: { id: championshipId },
    select: { state: true },
  });
  if (championship?.state !== "ENDED") return { settled: false };
  const settled = await service.settle(
    championshipId,
    `career-championship-finish:${championshipId}`,
    "manual",
  );
  return { settled: settled.status === "settled" };
}

/**
 * Advance a player's Career after they finish a round.
 *
 * This is the completion-driven primary flow (design §5): finalize any event
 * whose human has finished, and when the fourth event settles, settle the season
 * — publishing movement, rating, Legacy, history, the `settledSeasons`
 * increment, and next season atomically — then lock the new season's field.
 *
 * MUST be called from a write path (the round-finish POST), never from a GET.
 * The caller should treat failure as non-fatal: the player's score is already
 * committed, and the recovery scan completes anything left undone.
 */
export async function advanceCareerAfterFinish(
  db: PrismaClient,
  competitionId: string,
  options: StartCareerSeasonOptions = {},
): Promise<AdvanceCareerResult> {
  const runtime = options.runtimeRevision ? { runtimeRevision: options.runtimeRevision } : {};
  const events = new CareerEventSettlementService(db, runtime);
  const seasons = new CareerSeasonSettlementService(db, runtime);

  const competition = await db.careerCompetition.findUnique({
    where: { id: competitionId },
    select: { cohortId: true },
  });
  const cohortId = competition?.cohortId ?? null;

  // 1. Close and settle this event now that its human has finished.
  let eventsSettled = 0;
  if (await events.closeIfComplete(competitionId)) {
    const settled = await events.settle(competitionId, `career-finish:${competitionId}`, "manual");
    if (settled.status === "settled") eventsSettled += 1;
  }

  if (!cohortId) return { eventsSettled, seasonSettled: false, nextCohortId: null, championshipId: null };

  // 2. If that was the fourth, the season is now complete and settles.
  await seasons.closeDue();
  const cohort = await db.careerCohort.findUnique({
    where: { id: cohortId },
    select: { state: true, worldId: true, seasonNumber: true },
  });
  if (cohort?.state !== "ENDED") {
    return { eventsSettled, seasonSettled: false, nextCohortId: null, championshipId: null };
  }

  const settled = await seasons.settle(cohortId, `career-finish:${cohortId}`, "manual");
  if (settled.status !== "settled") {
    return { eventsSettled, seasonSettled: false, nextCohortId: null, championshipId: null };
  }

  // 3. Lock the next season's field. Formation owns its own atomic boundary, so
  //    this necessarily happens after the settlement transaction commits; a
  //    failure here leaves a shell-only season for the recovery scan.
  const nextCohort = await db.careerCohort.findFirst({
    where: { worldId: cohort.worldId, seasonNumber: cohort.seasonNumber + 1 },
    select: { id: true },
  });
  if (nextCohort) {
    await ensureSeasonFieldLocked(db, nextCohort.id, `career-next-season:${nextCohort.id}`, options);
  }

  // 4. Publish the field for any Championship this settlement unlocked. Like
  //    the next season's field, this is a separate formation transaction.
  const championshipId = await ensureChampionshipFieldsPublished(db, cohort.worldId, options);

  return {
    eventsSettled,
    seasonSettled: true,
    nextCohortId: nextCohort?.id ?? null,
    championshipId,
  };
}
