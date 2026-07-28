import { Prisma, type PrismaClient } from "@prisma/client";
import { requireCareerFormulaBundle } from "./formulaBundle";
import {
  requireCareerSkillRanks,
  type CareerSkillRanks,
} from "./development";

function profileSkillRanks(profile: {
  drivingRank: number;
  approachRank: number;
  shortGameRank: number;
  puttingRank: number;
}): CareerSkillRanks {
  return requireCareerSkillRanks({
    driving: profile.drivingRank,
    approach: profile.approachRank,
    shortGame: profile.shortGameRank,
    putting: profile.puttingRank,
  });
}

export type StartCareerEventResult =
  | {
    readonly ok: true;
    readonly roundId: string;
    readonly roundNumber: number;
    readonly roundsTotal: number;
  }
  | {
    readonly ok: false;
    readonly error:
      | "not-found"
      | "not-unlocked"
      | "event-closed"
      | "not-enrolled";
  };

export type FinishCareerRoundResult =
  | {
    readonly ok: true;
    readonly score: number;
    readonly relativeToPar: number;
    readonly replayed: boolean;
    readonly roundNumber: number;
    readonly roundsCompleted: number;
    readonly roundsTotal: number;
    readonly eventComplete: boolean;
    readonly eventRelativeToPar: number;
  }
  | {
    readonly ok: false;
    readonly error: "not-found" | "event-closed" | "round-incomplete";
  };

/**
 * Player-paced eligibility. There are no unlock days and no deadlines: an event
 * is playable while it is ACTIVE, and closed once it has been settled (or voided
 * / sent to manual review). "not-unlocked" survives only for a field that has
 * not finished forming yet — a transient state the player should retry.
 */
function eventPlayable(
  event: { state: string; eventNumber: number | null },
): "playable" | "not-unlocked" | "event-closed" {
  if (event.state === "ACTIVE") return "playable";
  if (["ENDED", "SETTLED", "MANUAL_REVIEW", "VOID"].includes(event.state)) {
    return "event-closed";
  }
  // FORMING / LOCKING: the field is still being locked.
  return "not-unlocked";
}

export async function startCareerEventRound(
  db: PrismaClient,
  userId: string,
  competitionId: string,
  now = new Date(),
): Promise<StartCareerEventResult> {
  if (!userId.trim() || !competitionId.trim()) {
    throw new TypeError("Career event start requires a user and competition ID");
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`career:event-entry:${competitionId}:${userId}`}, 0))
    `;
    const entry = await tx.careerEventEntry.findFirst({
      where: { competitionId, userId },
      include: {
        competition: {
          include: {
            cohort: { include: { world: true } },
          },
        },
        profile: {
          select: {
            drivingRank: true,
            approachRank: true,
            shortGameRank: true,
            puttingRank: true,
          },
        },
        round: true,
        rounds: {
          orderBy: { roundNumber: "asc" },
          include: { round: true },
        },
      },
    });
    if (!entry) {
      const event = await tx.careerCompetition.findUnique({
        where: { id: competitionId },
        select: { id: true },
      });
      return { ok: false, error: event ? "not-enrolled" : "not-found" } as const;
    }
    const eligibility = eventPlayable(entry.competition);
    if (eligibility !== "playable") return { ok: false, error: eligibility } as const;
    const cohort = entry.competition.cohort;
    if (!cohort || entry.competition.eventNumber == null) {
      return { ok: false, error: "not-found" } as const;
    }
    const rulesetVersion = requireCareerFormulaBundle(
      cohort.formulaVersion,
    ).gameplayRulesetVersion;
    const skillSnapshot = profileSkillRanks(entry.profile);
    const roundsTotal = entry.competition.roundsPerPlayer;
    // Grandfathered events keep their original one-card contract.
    if (roundsTotal === 1 && entry.round) {
      if (entry.round.rulesetVersion !== rulesetVersion) {
        return { ok: false, error: "event-closed" } as const;
      }
      return {
        ok: true,
        roundId: entry.round.id,
        roundNumber: 1,
        roundsTotal,
      } as const;
    }
    const inProgress = entry.rounds.find((eventRound) => !eventRound.completed);
    if (inProgress) {
      if (inProgress.round.rulesetVersion !== rulesetVersion) {
        return { ok: false, error: "event-closed" } as const;
      }
      return {
        ok: true,
        roundId: inProgress.roundId,
        roundNumber: inProgress.roundNumber,
        roundsTotal,
      } as const;
    }
    const roundNumber = entry.rounds.filter((eventRound) => eventRound.completed).length + 1;
    if (entry.completed || roundNumber > roundsTotal) {
      return { ok: false, error: "event-closed" } as const;
    }
    const seedKey =
      `career:${cohort.world.worldKey}:${cohort.seasonNumber}:${cohort.tier.toLowerCase()}`
      + `:event${entry.competition.eventNumber}:round${roundNumber}`;
    const round = await tx.round.create({
      data: {
        userId,
        courseId: entry.competition.courseId,
        mode: "career",
        rulesetVersion,
        dateKey: null,
        seedKey,
        careerSkillSnapshot: { ...skillSnapshot },
      },
    });
    await tx.careerEventRound.create({
      data: {
        entryId: entry.id,
        roundNumber,
        roundId: round.id,
      },
    });
    const lockedSlot = await tx.careerFieldSlot.findFirst({
      where: {
        competitionId,
        profileId: entry.profileId,
        competitorType: "HUMAN",
      },
      orderBy: { lockRevision: { revision: "desc" } },
    });
    if (lockedSlot) {
      await tx.careerResult.update({
        where: {
          lockRevisionId_slotId: {
            lockRevisionId: lockedSlot.lockRevisionId,
            slotId: lockedSlot.slotId,
          },
        },
        data: { roundId: round.id },
      });
    }
    return { ok: true, roundId: round.id, roundNumber, roundsTotal } as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 20_000,
  });
}

export async function finishCareerRound(
  db: PrismaClient,
  roundId: string,
  userId: string,
  durationMs: number,
): Promise<FinishCareerRoundResult> {
  return db.$transaction(async (tx) => {
    const round = await tx.round.findUnique({
      where: { id: roundId },
      include: {
        holeResults: { select: { id: true } },
        careerEventEntry: {
          include: {
            competition: true,
            member: true,
          },
        },
        careerEventRound: {
          include: {
            entry: {
              include: {
                competition: true,
                member: true,
              },
            },
          },
        },
      },
    });
    const entry = round?.careerEventRound?.entry ?? round?.careerEventEntry;
    if (
      !round
      || round.userId !== userId
      || round.mode !== "career"
      || !entry
    ) {
      return { ok: false, error: "not-found" } as const;
    }
    if (round.holeResults.length !== 18) {
      return { ok: false, error: "round-incomplete" } as const;
    }
    const roundsTotal = entry.competition.roundsPerPlayer;
    const eventRound = round.careerEventRound;
    if (
      round.completed
      && (eventRound?.completed || (round.careerEventEntry && entry.completed))
    ) {
      return {
        ok: true,
        score: round.score,
        relativeToPar: round.relativeToPar,
        replayed: true,
        roundNumber: eventRound?.roundNumber ?? 1,
        roundsCompleted: entry.completed ? roundsTotal : eventRound?.roundNumber ?? 1,
        roundsTotal,
        eventComplete: entry.completed,
        eventRelativeToPar: entry.relativeToPar ?? round.relativeToPar,
      } as const;
    }

    const eventRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "CareerCompetition"
      WHERE "id" = ${entry.competitionId}
        AND "kind" = 'EVENT'
        AND "state" = 'ACTIVE'
      FOR UPDATE
    `);
    if (eventRows.length !== 1) return { ok: false, error: "event-closed" } as const;

    const claimed = await tx.round.updateMany({
      where: { id: roundId, completed: false },
      data: { completed: true, durationMs },
    });
    if (claimed.count === 0) {
      const fresh = await tx.round.findUniqueOrThrow({ where: { id: roundId } });
      return {
        ok: true,
        score: fresh.score,
        relativeToPar: fresh.relativeToPar,
        replayed: true,
        roundNumber: eventRound?.roundNumber ?? 1,
        roundsCompleted: eventRound?.roundNumber ?? 1,
        roundsTotal,
        eventComplete: entry.completed,
        eventRelativeToPar: entry.relativeToPar ?? fresh.relativeToPar,
      } as const;
    }
    let roundsCompleted = 1;
    let eventRelativeToPar = round.relativeToPar;
    let eventComplete = true;
    if (eventRound) {
      await tx.careerEventRound.update({
        where: { id: eventRound.id },
        data: {
          completed: true,
          relativeToPar: round.relativeToPar,
          submittedAt: new Date(),
        },
      });
      const cards = await tx.careerEventRound.findMany({
        where: { entryId: entry.id },
        select: { completed: true, relativeToPar: true },
      });
      const completedCards = cards.filter(
        (card) => card.completed && card.relativeToPar != null,
      );
      roundsCompleted = completedCards.length;
      eventRelativeToPar = completedCards.reduce(
        (sum, card) => sum + (card.relativeToPar ?? 0),
        0,
      );
      eventComplete = roundsCompleted === roundsTotal;
    }
    await tx.careerEventEntry.update({
      where: { id: entry.id },
      data: {
        completed: eventComplete,
        relativeToPar: eventRelativeToPar,
        submittedAt: eventComplete ? new Date() : null,
      },
    });
    const lockedSlot = await tx.careerFieldSlot.findFirst({
      where: {
        competitionId: entry.competitionId,
        profileId: entry.profileId,
        competitorType: "HUMAN",
      },
      orderBy: { lockRevision: { revision: "desc" } },
    });
    if (lockedSlot) {
      await tx.careerResult.update({
        where: {
          lockRevisionId_slotId: {
            lockRevisionId: lockedSlot.lockRevisionId,
            slotId: lockedSlot.slotId,
          },
        },
        data: {
          roundId,
          completed: eventComplete,
          relativeToPar: eventComplete ? eventRelativeToPar : null,
        },
      });
    }
    return {
      ok: true,
      score: round.score,
      relativeToPar: round.relativeToPar,
      replayed: false,
      roundNumber: eventRound?.roundNumber ?? 1,
      roundsCompleted,
      roundsTotal,
      eventComplete,
      eventRelativeToPar,
    } as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 20_000,
  });
}
