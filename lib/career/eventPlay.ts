import { Prisma, type PrismaClient } from "@prisma/client";

export type StartCareerEventResult =
  | { readonly ok: true; readonly roundId: string }
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
        round: true,
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
    if (entry.round) return { ok: true, roundId: entry.round.id } as const;
    const cohort = entry.competition.cohort;
    if (!cohort || entry.competition.eventNumber == null) {
      return { ok: false, error: "not-found" } as const;
    }
    const seedKey =
      `career:${cohort.world.worldKey}:${cohort.seasonNumber}:${cohort.tier.toLowerCase()}:event${entry.competition.eventNumber}`;
    const round = await tx.round.create({
      data: {
        userId,
        courseId: entry.competition.courseId,
        mode: "career",
        dateKey: null,
        seedKey,
      },
    });
    await tx.careerEventEntry.update({
      where: { id: entry.id },
      data: { roundId: round.id },
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
    return { ok: true, roundId: round.id } as const;
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
      },
    });
    if (
      !round
      || round.userId !== userId
      || round.mode !== "career"
      || !round.careerEventEntry
    ) {
      return { ok: false, error: "not-found" } as const;
    }
    if (round.holeResults.length !== 18) {
      return { ok: false, error: "round-incomplete" } as const;
    }
    if (round.completed && round.careerEventEntry.completed) {
      return {
        ok: true,
        score: round.score,
        relativeToPar: round.relativeToPar,
        replayed: true,
      } as const;
    }

    const eventRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "CareerCompetition"
      WHERE "id" = ${round.careerEventEntry.competitionId}
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
      } as const;
    }
    await tx.careerEventEntry.update({
      where: { id: round.careerEventEntry.id },
      data: {
        completed: true,
        relativeToPar: round.relativeToPar,
        submittedAt: new Date(),
      },
    });
    const lockedSlot = await tx.careerFieldSlot.findFirst({
      where: {
        competitionId: round.careerEventEntry.competitionId,
        profileId: round.careerEventEntry.profileId,
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
          completed: true,
          relativeToPar: round.relativeToPar,
        },
      });
    }
    return {
      ok: true,
      score: round.score,
      relativeToPar: round.relativeToPar,
      replayed: false,
    } as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 20_000,
  });
}
