/**
 * Career Mode — Championship round play and deterministic bot materialization.
 *
 * This is the Championship analogue of `eventPlay.ts` (human play) and the bot
 * half of `formation.ts` (deterministic bot score materialization). It runs
 * AFTER the Championship field has been published (`championship.ts`):
 *
 *  - `materializeChampionshipBots` scores every BOT slot deterministically at the
 *    frozen ACE ability through the real Break Par engine, staged idempotently
 *    into `CareerChampionshipResult` with deterministic effect keys. It never
 *    rewrites an already-materialized (shown) result.
 *  - `startCareerChampionshipRound` opens a real `Round` (mode="career") for a
 *    human slot and links its `CareerChampionshipResult`.
 *  - `finishCareerChampionshipRound` finalizes the human's `Round` and writes the
 *    human result. It never touches daily/streak/Hall-of-Fame/tournament state
 *    (mode-guarded, exactly like event play).
 *
 * This iteration deliberately stops here: it does NOT rank the field, award
 * Championship Legacy/trophies, or settle results. Those are later iterations.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import { COURSES, type Course as GameCourse } from "@/data/courses";

import { canonicalHash } from "./canonical";
import { careerEffectKey } from "./effectKeys";
import { CAREER_FORMULA_VERSION, CAREER_CURRENT_FORMULA_BUNDLE } from "./formulaBundle";
import { simulateArchetypeRound, type Tendency } from "./simulator";

/** Championship bots always play at the frozen ACE ability. */
export const CAREER_CHAMPIONSHIP_BOT_ABILITY = "ace" as const;

function championshipSeedNamespace(worldKey: string, cycleNumber: number): string {
  return `career:championship:${worldKey}:c${cycleNumber}`;
}

/** The deterministic per-slot RNG namespace shared by bot and human scoring. */
export function championshipSlotSeed(
  worldKey: string,
  cycleNumber: number,
  slotNumber: number,
): string {
  return `${championshipSeedNamespace(worldKey, cycleNumber)}:slot${slotNumber}`;
}

/**
 * Player-paced eligibility: a Championship never expires, so it is playable
 * while ACTIVE and closed only once it has been settled (or voided / sent to
 * manual review). An unplayed Championship stays playable indefinitely.
 */
function championshipPlayable(
  competition: { state: string },
): "playable" | "not-unlocked" | "championship-closed" {
  if (competition.state === "ACTIVE") return "playable";
  if (["ENDED", "SETTLED", "MANUAL_REVIEW", "VOID"].includes(competition.state)) {
    return "championship-closed";
  }
  return "not-unlocked";
}

function gameCourseForSlug(slug: string): GameCourse {
  const course = COURSES.find((entry) => entry.slug === slug);
  if (!course) {
    throw new Error(`Career championship course ${slug} is not in the game catalogue`);
  }
  return course;
}

// ---------------------------------------------------------------------------
// Bot materialization
// ---------------------------------------------------------------------------

export type MaterializeChampionshipBotsResult =
  | { readonly status: "materialized"; readonly championshipId: string; readonly created: number }
  | { readonly status: "not-ready"; readonly championshipId: string; readonly reason: string }
  | { readonly status: "not-found" };

interface MaterializeOptions {
  readonly now?: Date;
  /** Test seam so suites can force a deterministic bot score. */
  readonly simulateBotRound?: (
    seed: string,
    course: GameCourse,
    tendency: Tendency,
  ) => number;
}

function defaultChampionshipBotRound(
  seed: string,
  course: GameCourse,
  tendency: Tendency,
): number {
  return simulateArchetypeRound(
    seed,
    course,
    { ability: CAREER_CHAMPIONSHIP_BOT_ABILITY, tendency },
    "error",
    CAREER_CURRENT_FORMULA_BUNDLE.ability.errorRates,
  );
}

/**
 * Deterministically materialize every BOT slot's ACE-level score into
 * `CareerChampionshipResult`. Advisory-locked and idempotent: already-scored
 * slots are left untouched, and a re-run creates nothing new.
 */
export async function materializeChampionshipBots(
  db: PrismaClient,
  championshipId: string,
  options: MaterializeOptions = {},
): Promise<MaterializeChampionshipBotsResult> {
  if (!championshipId.trim()) throw new TypeError("Championship bot materialization requires a championship id");
  const now = options.now ?? new Date();
  const simulateBotRound = options.simulateBotRound ?? defaultChampionshipBotRound;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`career:championship-bots:${championshipId}`}, 0))
    `;
    const championship = await tx.careerChampionship.findUnique({
      where: { id: championshipId },
      include: { world: true },
    });
    if (!championship) return { status: "not-found" } as const;

    const competition = await tx.careerCompetition.findFirst({
      where: { championshipId, kind: "CHAMPIONSHIP" },
      include: { course: { select: { slug: true } } },
    });
    if (!competition) {
      return { status: "not-ready", championshipId, reason: "championship field is not published" } as const;
    }
    // Materialization is deterministic and time-independent; it only needs the
    // field to have unlocked (so bot scores are not revealed early). It stays
    // available after close so late settlement always finds a complete field.
    if (competition.unlocksAt.getTime() > now.getTime()) {
      return { status: "not-ready", championshipId, reason: "championship has not unlocked" } as const;
    }

    const botSlots = await tx.careerChampionshipSlot.findMany({
      where: { championshipId, competitorType: "BOT" },
      include: { botIdentity: true },
      orderBy: { slotNumber: "asc" },
    });
    const existing = new Set(
      (await tx.careerChampionshipResult.findMany({
        where: { championshipId },
        select: { slotNumber: true },
      })).map((result) => result.slotNumber),
    );
    const gameCourse = gameCourseForSlug(competition.course.slug);

    const pending = botSlots.filter((slot) => !existing.has(slot.slotNumber));
    if (pending.length === 0) {
      return { status: "materialized", championshipId, created: 0 } as const;
    }

    const rows = pending.map((slot) => {
      if (!slot.botIdentity) {
        throw new Error(`Championship bot slot ${slot.slotNumber} has no persistent identity`);
      }
      const tendency = slot.botIdentity.tendency.toLowerCase() as Tendency;
      const seed = championshipSlotSeed(
        championship.world.worldKey,
        championship.cycleNumber,
        slot.slotNumber,
      );
      const relativeToPar = simulateBotRound(seed, gameCourse, tendency);
      const outputHash = canonicalHash({
        championshipId,
        slotNumber: slot.slotNumber,
        seed,
        relativeToPar,
        formulaVersion: CAREER_FORMULA_VERSION,
      });
      return {
        championshipId,
        slotNumber: slot.slotNumber,
        competitorType: "BOT" as const,
        botIdentityId: slot.botIdentityId,
        relativeToPar,
        completed: true,
        outputHash,
        competitorId: `bot:${slot.botIdentityId}`,
      };
    });

    await tx.careerChampionshipResult.createMany({
      data: rows.map((row) => ({
        championshipId: row.championshipId,
        slotNumber: row.slotNumber,
        competitorType: row.competitorType,
        botIdentityId: row.botIdentityId,
        relativeToPar: row.relativeToPar,
        completed: row.completed,
        outputHash: row.outputHash,
      })),
      skipDuplicates: true,
    });
    await tx.careerCommittedEffect.createMany({
      data: rows.map((row) => {
        const payload = {
          championshipId,
          slotNumber: row.slotNumber,
          relativeToPar: row.relativeToPar,
          outputHash: row.outputHash,
        };
        return {
          aggregateType: "CHAMPIONSHIP" as const,
          aggregateId: championshipId,
          committedRevisionId: `${championshipId}:${CAREER_FORMULA_VERSION}:bots`,
          effectKey: careerEffectKey.championshipResult(championshipId, row.competitorId),
          effectType: "championship-bot-result",
          scope: row.competitorId,
          isOutbox: false,
          payload: payload as Prisma.InputJsonValue,
          payloadHash: canonicalHash(payload),
        };
      }),
      skipDuplicates: true,
    });

    return { status: "materialized", championshipId, created: rows.length } as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Human play
// ---------------------------------------------------------------------------

export type StartCareerChampionshipResult =
  | { readonly ok: true; readonly roundId: string }
  | {
    readonly ok: false;
    readonly error: "not-found" | "not-unlocked" | "championship-closed" | "not-qualified";
  };

export type FinishCareerChampionshipResult =
  | {
    readonly ok: true;
    readonly score: number;
    readonly relativeToPar: number;
    readonly replayed: boolean;
  }
  | {
    readonly ok: false;
    readonly error: "not-found" | "championship-closed" | "round-incomplete";
  };

export async function startCareerChampionshipRound(
  db: PrismaClient,
  userId: string,
  championshipId: string,
  now = new Date(),
): Promise<StartCareerChampionshipResult> {
  if (!userId.trim() || !championshipId.trim()) {
    throw new TypeError("Career championship start requires a user and championship ID");
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`career:championship-entry:${championshipId}:${userId}`}, 0))
    `;
    const championship = await tx.careerChampionship.findUnique({
      where: { id: championshipId },
      select: { id: true },
    });
    if (!championship) return { ok: false, error: "not-found" } as const;

    const slot = await tx.careerChampionshipSlot.findFirst({
      where: { championshipId, competitorType: "HUMAN", profile: { userId } },
      select: { slotNumber: true, profileId: true },
    });
    if (!slot || !slot.profileId) return { ok: false, error: "not-qualified" } as const;

    const competition = await tx.careerCompetition.findFirst({
      where: { championshipId, kind: "CHAMPIONSHIP" },
      include: { championship: { include: { world: true } } },
    });
    if (!competition || !competition.championship) return { ok: false, error: "not-found" } as const;
    const eligibility = championshipPlayable(competition);
    if (eligibility !== "playable") return { ok: false, error: eligibility } as const;

    const existing = await tx.careerChampionshipResult.findUnique({
      where: { championshipId_slotNumber: { championshipId, slotNumber: slot.slotNumber } },
    });
    if (existing?.roundId) return { ok: true, roundId: existing.roundId } as const;

    const seedKey =
      `${championshipSlotSeed(
        competition.championship.world.worldKey,
        competition.championship.cycleNumber,
        slot.slotNumber,
      )}:human`;
    const round = await tx.round.create({
      data: {
        userId,
        courseId: competition.courseId,
        mode: "career",
        dateKey: null,
        seedKey,
      },
    });
    if (existing) {
      await tx.careerChampionshipResult.update({
        where: { championshipId_slotNumber: { championshipId, slotNumber: slot.slotNumber } },
        data: { roundId: round.id },
      });
    } else {
      await tx.careerChampionshipResult.create({
        data: {
          championshipId,
          slotNumber: slot.slotNumber,
          competitorType: "HUMAN",
          profileId: slot.profileId,
          roundId: round.id,
          completed: false,
        },
      });
    }
    return { ok: true, roundId: round.id } as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 20_000,
  });
}

export async function finishCareerChampionshipRound(
  db: PrismaClient,
  roundId: string,
  userId: string,
  durationMs: number,
): Promise<FinishCareerChampionshipResult> {
  return db.$transaction(async (tx) => {
    const round = await tx.round.findUnique({
      where: { id: roundId },
      include: {
        holeResults: { select: { id: true } },
        careerChampionshipResult: true,
      },
    });
    if (
      !round
      || round.userId !== userId
      || round.mode !== "career"
      || !round.careerChampionshipResult
    ) {
      return { ok: false, error: "not-found" } as const;
    }
    const result = round.careerChampionshipResult;
    if (round.holeResults.length !== 18) {
      return { ok: false, error: "round-incomplete" } as const;
    }
    if (round.completed && result.completed) {
      return {
        ok: true,
        score: round.score,
        relativeToPar: round.relativeToPar,
        replayed: true,
      } as const;
    }

    const openRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "CareerCompetition"
      WHERE "championshipId" = ${result.championshipId}
        AND "kind" = 'CHAMPIONSHIP'
        AND "state" = 'ACTIVE'
      FOR UPDATE
    `);
    if (openRows.length !== 1) return { ok: false, error: "championship-closed" } as const;

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
    await tx.careerChampionshipResult.update({
      where: { id: result.id },
      data: {
        completed: true,
        relativeToPar: round.relativeToPar,
        outputHash: canonicalHash({
          championshipId: result.championshipId,
          slotNumber: result.slotNumber,
          roundId,
          relativeToPar: round.relativeToPar,
        }),
      },
    });
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
