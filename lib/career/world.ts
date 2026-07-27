import {
  CareerTier as PrismaCareerTier,
  Prisma,
  type CareerCohort,
  type CareerCompetition,
  type CareerProfile,
  type CareerWorld,
  type PrismaClient,
} from "@prisma/client";

import { hashSeed } from "@/lib/engine/rng";
import { COURSES } from "@/data/courses";

import { generateCareerBotRoster } from "./botRoster";
import {
  CAREER_BASE_FIELD_SIZE,
  CAREER_EVENTS_PER_SEASON,
  CAREER_NO_DEADLINE,
  careerJourneyKey,
} from "./constants";
import { CAREER_FORMULA_VERSION } from "./formulaBundle";

export {
  CAREER_BASE_FIELD_SIZE,
  CAREER_EVENTS_PER_SEASON,
  CAREER_NO_DEADLINE,
  careerJourneyKey,
};

type CareerDb = PrismaClient | Prisma.TransactionClient;

export interface CareerEnrollmentState {
  readonly created: boolean;
  readonly world: CareerWorld;
  readonly profile: CareerProfile;
  readonly cohort: CareerCohort;
  readonly competitions: readonly CareerCompetition[];
  readonly memberId: string;
  readonly slotId: number;
}

/**
 * Deterministically pick this season's four courses.
 *
 * The namespace is derived from the personal Journey key, so a player's course
 * rotation is stable and reproducible for them, and independent of anyone else.
 */
function deterministicCourseIds(
  courses: readonly { id: string; slug: string }[],
  worldKey: string,
  seasonNumber: number,
  tier: PrismaCareerTier,
): readonly string[] {
  if (courses.length < CAREER_EVENTS_PER_SEASON) {
    throw new Error(
      `Career Mode requires at least ${CAREER_EVENTS_PER_SEASON} seeded courses; found ${courses.length}`,
    );
  }
  const namespace = `career:${worldKey}:s${seasonNumber}:${tier.toLowerCase()}:courses`;
  return [...courses]
    .sort((left, right) => {
      const leftDraw = hashSeed(`${namespace}:${left.slug}`);
      const rightDraw = hashSeed(`${namespace}:${right.slug}`);
      return leftDraw - rightDraw || left.slug.localeCompare(right.slug);
    })
    .slice(0, CAREER_EVENTS_PER_SEASON)
    .map((course) => course.id);
}

async function advisoryLock(
  tx: Prisma.TransactionClient,
  namespace: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
}

/**
 * Get-or-create the player's personal Journey and its 30 persistent bot
 * identities. Idempotent: the unique `worldKey` guarantees one Journey per
 * player, and the roster insert skips duplicates.
 */
export async function ensureCareerJourney(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<CareerWorld> {
  const worldKey = careerJourneyKey(userId);
  await advisoryLock(tx, `career:journey:${worldKey}`);
  const world = await tx.careerWorld.upsert({
    where: { worldKey },
    create: { worldKey, formulaVersion: CAREER_FORMULA_VERSION },
    update: {},
  });

  // Rivals are personal: the roster is seeded from this player's Journey key.
  const roster = generateCareerBotRoster(worldKey);
  await tx.careerBotIdentity.createMany({
    data: roster.map((bot) => ({
      worldId: world.id,
      botKey: bot.botKey,
      displayName: bot.displayName,
      homeFlavor: bot.homeFlavor,
      tendency: bot.tendency.toUpperCase() as "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "SITUATIONAL",
      recurring: bot.recurring,
    })),
    skipDuplicates: true,
  });
  return world;
}

/**
 * Get-or-create this player's season N shell: the cohort plus its four events.
 *
 * There are no dates, unlock days, or deadlines. Every event is created
 * immediately playable; `unlocksAt` records when the season was formed and
 * `deadlineAt` is the never-expires sentinel.
 */
export async function ensureCareerCohort(
  tx: Prisma.TransactionClient,
  input: {
    world: CareerWorld;
    seasonNumber: number;
    tier: PrismaCareerTier;
    now?: Date;
  },
): Promise<{ cohort: CareerCohort; competitions: readonly CareerCompetition[] }> {
  if (!Number.isSafeInteger(input.seasonNumber) || input.seasonNumber < 1) {
    throw new TypeError("Career season number must be a positive safe integer");
  }
  const now = input.now ?? new Date();
  await advisoryLock(
    tx,
    `career:cohort-shell:${input.world.id}:${input.seasonNumber}:${input.tier}`,
  );
  const cohort = await tx.careerCohort.upsert({
    where: {
      worldId_seasonNumber_tier: {
        worldId: input.world.id,
        seasonNumber: input.seasonNumber,
        tier: input.tier,
      },
    },
    create: {
      worldId: input.world.id,
      seasonNumber: input.seasonNumber,
      tier: input.tier,
    },
    update: {},
  });

  const courses = await tx.course.findMany({
    where: { slug: { in: COURSES.map((course) => course.slug) } },
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  });
  const courseIds = deterministicCourseIds(
    courses,
    input.world.worldKey,
    input.seasonNumber,
    input.tier,
  );
  for (let index = 0; index < CAREER_EVENTS_PER_SEASON; index++) {
    await tx.careerCompetition.upsert({
      where: {
        cohortId_eventNumber: { cohortId: cohort.id, eventNumber: index + 1 },
      },
      create: {
        kind: "EVENT",
        cohortId: cohort.id,
        eventNumber: index + 1,
        courseId: courseIds[index],
        state: "FORMING",
        targetFieldSize: CAREER_BASE_FIELD_SIZE,
        unlocksAt: now,
        deadlineAt: CAREER_NO_DEADLINE,
      },
      update: {},
    });
  }
  const competitions = await tx.careerCompetition.findMany({
    where: { cohortId: cohort.id },
    orderBy: { eventNumber: "asc" },
  });
  if (competitions.length !== CAREER_EVENTS_PER_SEASON) {
    throw new Error(`Career cohort ${cohort.id} does not have exactly four events`);
  }
  return { cohort, competitions };
}

/**
 * Attach a profile to a season: one member row plus one entry per event.
 * Idempotent — safe to call again for an already-attached profile.
 */
export async function ensureCohortMembership(
  tx: Prisma.TransactionClient,
  input: {
    cohortId: string;
    profileId: string;
    userId: string;
    competitions: readonly CareerCompetition[];
  },
): Promise<{ memberId: string; slotId: number }> {
  const existing = await tx.careerCohortMember.findUnique({
    where: { cohortId_profileId: { cohortId: input.cohortId, profileId: input.profileId } },
  });
  const member = existing ?? await tx.careerCohortMember.create({
    // Slot 1 always: exactly one human per personal field.
    data: { cohortId: input.cohortId, profileId: input.profileId, slotId: 1 },
  });
  await tx.careerEventEntry.createMany({
    data: input.competitions.map((competition) => ({
      competitionId: competition.id,
      memberId: member.id,
      profileId: input.profileId,
      userId: input.userId,
    })),
    skipDuplicates: true,
  });
  return { memberId: member.id, slotId: member.slotId };
}

async function currentEnrollmentState(
  db: CareerDb,
  profile: CareerProfile,
): Promise<CareerEnrollmentState> {
  const world = await db.careerWorld.findUniqueOrThrow({ where: { id: profile.worldId } });
  const cohort = await db.careerCohort.findUniqueOrThrow({
    where: {
      worldId_seasonNumber_tier: {
        worldId: profile.worldId,
        seasonNumber: profile.currentSeason,
        tier: profile.tier,
      },
    },
  });
  const member = await db.careerCohortMember.findUniqueOrThrow({
    where: { cohortId_profileId: { cohortId: cohort.id, profileId: profile.id } },
  });
  const competitions = await db.careerCompetition.findMany({
    where: { cohortId: cohort.id },
    orderBy: { eventNumber: "asc" },
  });
  return {
    created: false,
    world,
    profile,
    cohort,
    competitions,
    memberId: member.id,
    slotId: member.slotId,
  };
}

export class CareerWorldService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Enter Career, or return the existing state. Creates the personal Journey,
   * the profile, season 1's shell, membership, and the four event entries.
   *
   * The field itself is locked separately by `CareerFormationService` (see
   * `startCareerSeason`), because formation owns its own atomic publication
   * boundary and cannot be nested inside this transaction.
   */
  async enter(userId: string, now = new Date()): Promise<CareerEnrollmentState> {
    if (userId.trim().length === 0) throw new TypeError("Career enrollment requires a user ID");
    const existing = await this.db.careerProfile.findFirst({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (existing) return currentEnrollmentState(this.db, existing);

    return this.db.$transaction(async (tx) => {
      await advisoryLock(tx, `career:user:${userId}`);
      const raced = await tx.careerProfile.findFirst({
        where: { userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (raced) return currentEnrollmentState(tx, raced);

      const world = await ensureCareerJourney(tx, userId);
      const { cohort, competitions } = await ensureCareerCohort(tx, {
        world,
        seasonNumber: 1,
        tier: "LOCAL",
        now,
      });
      const profile = await tx.careerProfile.create({
        data: { userId, worldId: world.id, tier: "LOCAL", currentSeason: 1 },
      });
      const { memberId, slotId } = await ensureCohortMembership(tx, {
        cohortId: cohort.id,
        profileId: profile.id,
        userId,
        competitions,
      });

      return { created: true, world, profile, cohort, competitions, memberId, slotId };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 30_000,
    });
  }
}
