/**
 * Career Mode — immutable per-round bot cards.
 *
 * A four-round Career event stores one total per bot in `CareerResult`. That
 * total is the SUM of four deterministic cards, and a leaderboard that updates
 * after every round needs the components, not the sum. This module owns the one
 * seed formula those cards are generated from, so field formation and the
 * backfill script cannot drift apart.
 *
 * Rules that everything here exists to protect:
 *  - a card is generated exactly once, during field formation, from the PINNED
 *    formula bundle — never from `CAREER_CURRENT_FORMULA_BUNDLE` at read time;
 *  - the cards for an event always sum to the total already stored;
 *  - reads never regenerate, repair, or write cards.
 */
import type { PrismaClient } from "@prisma/client";

import { COURSES, type Course as GameCourse } from "@/data/courses";
import { simulateArchetypeRound, type CareerArchetype } from "./simulator";
import { requireCareerFormulaBundle, type CareerFormulaBundle } from "./formulaBundle";

export interface CareerBotRoundCard {
  readonly roundNumber: number;
  readonly relativeToPar: number;
  readonly seed: string;
}

/**
 * The seed a single bot card is rolled from. Frozen: changing this string
 * changes every bot score in every future event, and would make already-stored
 * cards unreproducible.
 */
export function careerBotRoundSeed(
  seedNamespace: string,
  roundNumber: number,
  slotId: number,
): string {
  return `${seedNamespace}:round${roundNumber}:slot${slotId}`;
}

/**
 * Roll one bot's cards for an event. Pure: identical inputs always produce
 * identical cards, which is what makes both formation and backfill safe.
 */
export function careerBotRoundCards(input: {
  readonly seedNamespace: string;
  readonly slotId: number;
  readonly roundsPerPlayer: number;
  readonly course: GameCourse;
  readonly archetype: CareerArchetype;
  readonly errorRates: CareerFormulaBundle["ability"]["errorRates"];
}): readonly CareerBotRoundCard[] {
  if (!Number.isSafeInteger(input.roundsPerPlayer) || input.roundsPerPlayer < 1) {
    throw new TypeError("Career bot round cards require a positive round count");
  }
  return Array.from({ length: input.roundsPerPlayer }, (_, index) => {
    const roundNumber = index + 1;
    const seed = careerBotRoundSeed(input.seedNamespace, roundNumber, input.slotId);
    return {
      roundNumber,
      relativeToPar: simulateArchetypeRound(
        seed,
        input.course,
        input.archetype,
        "error",
        input.errorRates,
      ),
      seed,
    };
  });
}

export function sumBotRoundCards(cards: readonly CareerBotRoundCard[]): number {
  return cards.reduce((total, card) => total + card.relativeToPar, 0);
}

export interface CareerRebuiltBotSlot {
  readonly slotId: number;
  readonly cards: readonly CareerBotRoundCard[];
  readonly total: number;
  /** The total already stored in `CareerResult`, for verification. */
  readonly storedTotal: number | null;
  readonly matchesStoredTotal: boolean;
}

export interface CareerRebuiltEvent {
  readonly competitionId: string;
  readonly lockRevisionId: string;
  readonly formulaVersion: string;
  readonly roundsPerPlayer: number;
  readonly slots: readonly CareerRebuiltBotSlot[];
  /** True only when every rebuilt bot total equals the stored total. */
  readonly verified: boolean;
}

/**
 * Rebuild an already-formed event's bot cards from its immutable lock revision.
 *
 * Every input comes from persisted, pinned state: the roster snapshot's seed
 * namespace and round count, each slot's ability/tendency, and the formula
 * bundle the lock was published under. Nothing is read from today's current
 * bundle. The caller MUST check `verified` before persisting anything — an
 * unverified rebuild means the exact original cards are not reproducible and a
 * lossy backfill would silently change a live player's rivals.
 */
export async function rebuildCareerBotRounds(
  db: PrismaClient,
  competitionId: string,
): Promise<CareerRebuiltEvent | null> {
  const competition = await db.careerCompetition.findUnique({
    where: { id: competitionId },
    include: {
      course: { select: { slug: true } },
      lockRevisions: {
        orderBy: { revision: "desc" },
        take: 1,
        include: {
          slots: { orderBy: { slotId: "asc" } },
          results: { orderBy: { slotId: "asc" } },
        },
      },
    },
  });
  const lock = competition?.lockRevisions[0];
  if (!competition || !lock) return null;

  const course = COURSES.find((candidate) => candidate.slug === competition.course.slug);
  if (!course) {
    throw new Error(`Career course ${competition.course.slug} is not in the game catalogue`);
  }
  const roster = lock.rosterSnapshot as { seedNamespace?: unknown; roundsPerPlayer?: unknown } | null;
  const seedNamespace = typeof roster?.seedNamespace === "string" ? roster.seedNamespace : null;
  if (!seedNamespace) {
    throw new Error(`Career event ${competitionId} has no pinned seed namespace to rebuild from`);
  }
  const roundsPerPlayer = typeof roster?.roundsPerPlayer === "number"
    ? roster.roundsPerPlayer
    : competition.roundsPerPlayer;

  const pin = lock.formulaBundle as { formulaPackageVersion?: unknown } | null;
  const formulaVersion = typeof pin?.formulaPackageVersion === "string"
    ? pin.formulaPackageVersion
    : null;
  if (!formulaVersion) {
    throw new Error(`Career event ${competitionId} has no pinned formula package version`);
  }
  const errorRates = requireCareerFormulaBundle(formulaVersion).ability.errorRates;

  const totalBySlot = new Map(lock.results.map((result) => [result.slotId, result.relativeToPar]));
  const slots = lock.slots
    .filter((slot) => slot.competitorType === "BOT")
    .map((slot) => {
      if (!slot.abilityBand || !slot.tendency) {
        throw new Error(`Career bot slot ${slot.slotId} of ${competitionId} has no archetype`);
      }
      const cards = careerBotRoundCards({
        seedNamespace,
        slotId: slot.slotId,
        roundsPerPlayer,
        course,
        archetype: {
          ability: slot.abilityBand.toLowerCase() as CareerArchetype["ability"],
          tendency: slot.tendency.toLowerCase() as CareerArchetype["tendency"],
        },
        errorRates,
      });
      const total = sumBotRoundCards(cards);
      const storedTotal = totalBySlot.get(slot.slotId) ?? null;
      return {
        slotId: slot.slotId,
        cards,
        total,
        storedTotal,
        matchesStoredTotal: storedTotal === total,
      };
    });

  return {
    competitionId,
    lockRevisionId: lock.id,
    formulaVersion,
    roundsPerPlayer,
    slots,
    verified: slots.length > 0 && slots.every((slot) => slot.matchesStoredTotal),
  };
}

/** Cumulative bot scores through `throughRound`, keyed by slot. Read-only. */
export async function careerBotCumulativeBySlot(
  db: PrismaClient,
  competitionId: string,
  throughRound: number,
): Promise<Map<number, number> | null> {
  if (throughRound < 1) return new Map();
  const cards = await db.careerBotRoundResult.findMany({
    where: { competitionId, roundNumber: { lte: throughRound } },
    select: { slotId: true, roundNumber: true, relativeToPar: true },
    orderBy: [{ slotId: "asc" }, { roundNumber: "asc" }],
  });
  if (cards.length === 0) return null;
  const cumulative = new Map<number, number>();
  const counts = new Map<number, number>();
  for (const card of cards) {
    cumulative.set(card.slotId, (cumulative.get(card.slotId) ?? 0) + card.relativeToPar);
    counts.set(card.slotId, (counts.get(card.slotId) ?? 0) + 1);
  }
  // A partial set cannot be completed at read time, so treat it as unavailable
  // rather than publishing a short cumulative that looks like a good round.
  for (const count of counts.values()) {
    if (count !== throughRound) return null;
  }
  return cumulative;
}
