/**
 * Career Mode — READ-ONLY view assembly for the HTTP APIs.
 *
 * These helpers shape the data the Career API routes return. They are strictly
 * read-only: they NEVER mutate lifecycle state. The one composed helper,
 * `careerStateWithRepair`, additionally fires the nonblocking read-repair
 * (`triggerCareerRepairIfPending`) so a page visit can nudge a delayed lifecycle
 * WITHOUT performing settlement in the request path — the design's rule against
 * the Weekly Tournament's lazy-read anti-pattern.
 */
import type { PrismaClient } from "@prisma/client";

import {
  triggerCareerRepairIfPending,
  type CareerRepairEnqueue,
  type CareerRepairResult,
} from "./repair";
import type { CareerEventStanding } from "./eventSettlement";
import { calculateCareerEventStandings } from "./eventSettlement";
import { careerBotCumulativeBySlot } from "./botRounds";
import { hashSeed } from "@/lib/engine/rng";
import {
  compareSeasonPerformance,
  rankEvent,
  rankSeason,
  summarizeSeason,
  type SeasonEventResult,
} from "./rules";
import {
  CAREER_SKILLS,
  careerSkillUpgradeCost,
  requireCareerSkillRanks,
  type CareerSkill,
  type CareerSkillRanks,
} from "./development";
import { requireCareerFormulaBundle } from "./formulaBundle";

/**
 * Order a partially played field by cumulative score. Points are deliberately
 * null: they belong to the settled event only, and publishing a provisional
 * number would invite it being read as final.
 */
function rankCumulativeStandings(
  rows: readonly {
    slotId: number;
    competitorId: string;
    competitorType: "HUMAN" | "BOT";
    displayName: string;
    isMe: boolean;
    relativeToPar: number | null;
  }[],
  roundsCounted: number,
): CareerLeaderboardRow[] {
  const ranked = new Map(
    rankEvent(rows.map((row) => ({
      competitorId: row.competitorId,
      relativeToPar: row.relativeToPar,
    }))).map((standing) => [standing.competitorId, standing]),
  );
  return rows
    .map((row) => {
      const standing = ranked.get(row.competitorId)!;
      return {
        slotId: row.slotId,
        competitorId: row.competitorId,
        competitorType: row.competitorType,
        displayName: row.displayName,
        completed: standing.completed,
        noShow: false,
        roundsCompleted: standing.completed ? roundsCounted : 0,
        relativeToPar: standing.relativeToPar,
        rank: standing.rank,
        points: null,
        isMe: row.isMe,
      };
    })
    .sort((left, right) =>
      (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
      || left.slotId - right.slotId);
}

export interface CareerScheduleEntry {
  readonly competitionId: string;
  readonly eventNumber: number | null;
  readonly courseSlug: string;
  readonly courseName: string;
  readonly courseLocation: string;
  readonly state: string;
  readonly unlocksAt: string;
  readonly deadlineAt: string;
  readonly completed: boolean;
  readonly relativeToPar: number | null;
  readonly roundId: string | null;
  readonly roundsCompleted: number;
  readonly roundsTotal: number;
}

export interface CareerStateView {
  readonly world: { readonly id: string; readonly worldKey: string };
  readonly profile: {
    readonly id: string;
    readonly tier: "LOCAL" | "CHALLENGER" | "PRO";
    readonly status: "ACTIVE" | "PAUSED" | "RETIRED";
    readonly currentSeason: number;
    readonly settledSeasons: number;
    readonly legacyTotal: number;
    readonly careerNumber: number;
    readonly developmentPoints: number;
    readonly skills: CareerSkillRanks;
  };
  readonly development: {
    readonly enabled: boolean;
    readonly points: number;
    readonly skills: readonly {
      readonly skill: CareerSkill;
      readonly rank: number;
      readonly maxRank: number;
      readonly nextCost: number | null;
    }[];
    readonly latestAward: {
      readonly seasonNumber: number | null;
      readonly points: number;
      readonly reasons: readonly string[];
    } | null;
  };
  readonly movement: {
    readonly evidence: readonly number[];
    readonly average: number | null;
    readonly promotionThreshold: number | null;
    readonly promotionFloor: number | null;
    readonly relegationThreshold: number | null;
  };
  readonly retiredCareers: readonly {
    readonly profileId: string;
    readonly careerNumber: number;
    readonly settledSeasons: number;
    readonly legacyTotal: number;
    readonly highestTier: "LOCAL" | "CHALLENGER" | "PRO";
    readonly retiredAt: string | null;
  }[];
  /** How far through the current season the player is, out of four. */
  readonly seasonProgress: { readonly completed: number; readonly total: number };
  /** An unlocked Championship awaiting play, if any. */
  readonly championship:
    | { readonly id: string; readonly cycleNumber: number; readonly state: string }
    | null;
  readonly cohort:
    | { readonly id: string; readonly seasonNumber: number; readonly tier: string; readonly state: string }
    | null;
  readonly schedule: readonly CareerScheduleEntry[];
  readonly latestRating: { readonly seasonNumber: number; readonly rating: number } | null;
  /** The player's latest immutable season result, kept visible after the next
   * season opens immediately. */
  readonly latestSettledSeason: {
    readonly cohortId: string;
    readonly seasonNumber: number;
    readonly tier: string;
    readonly nextTier: string;
    readonly rank: number | null;
    readonly fieldSize: number;
    readonly seasonPoints: number;
    readonly movement: string;
  } | null;
}

export interface CareerLeaderboardRow {
  readonly slotId: number;
  readonly competitorId: string;
  readonly competitorType: "HUMAN" | "BOT";
  readonly displayName: string;
  readonly completed: boolean;
  readonly noShow: boolean;
  /** How many rounds are counted in `relativeToPar`. */
  readonly roundsCompleted: number;
  /** Cumulative score through the revealed round — never a full-event total
   * while rounds are still hidden. */
  readonly relativeToPar: number | null;
  readonly rank: number | null;
  /** Event points exist only once the event is final. */
  readonly points: number | null;
  readonly isMe: boolean;
}

export interface CareerEventLeaderboardView {
  /**
   * False until the viewer has completed at least one round: opponents' scores
   * are withheld. Knowing the number to beat changes aggression decisions, so
   * this is an anti-exploit rule, not a presentation choice.
   */
  readonly revealed: boolean;
  /**
   * How many of the event's rounds the whole field is shown through. It always
   * equals the viewer's own completed rounds — never what happens to exist in
   * the database — so finishing round two reveals exactly two rounds.
   */
  readonly roundsRevealed: number;
  /**
   * False only for a multi-round event formed before per-round bot cards were
   * stored. Splitting its locked total would be an invention, so the field
   * stays hidden until the event is complete and its immutable total is used.
   */
  readonly roundCardsAvailable: boolean;
  readonly competition: {
    readonly id: string;
    readonly eventNumber: number | null;
    readonly courseSlug: string;
    readonly courseName: string;
    readonly courseLocation: string;
    readonly state: string;
    readonly unlocksAt: string;
    readonly deadlineAt: string;
    readonly roundsPerPlayer: number;
  };
  readonly playerProgress: {
    readonly roundsCompleted: number;
    readonly roundsTotal: number;
    readonly nextRound: number | null;
    readonly cumulativeRelativeToPar: number;
    readonly currentRoundId: string | null;
  };
  readonly settled: boolean;
  readonly standings: readonly CareerLeaderboardRow[];
}

/** One event's cell in the season table. Unrevealed cells carry no scores. */
export interface CareerSeasonEventCell {
  readonly eventIndex: number;
  readonly eventNumber: number;
  readonly revealed: boolean;
  readonly relativeToPar: number | null;
  readonly rank: number | null;
  readonly points: number | null;
  /** True when this event is one of the best three currently counting. */
  readonly counting: boolean;
}

export interface CareerSeasonTableRow {
  readonly competitorId: string;
  readonly profileId: string | null;
  readonly displayName: string;
  readonly isMe: boolean;
  readonly tier: string;
  readonly nextTier: string;
  readonly rank: number | null;
  readonly seasonPoints: number;
  readonly eventsCompleted: number;
  readonly movement: string;
  readonly events: readonly CareerSeasonEventCell[];
}

export interface CareerSeasonTableView {
  readonly cohortId: string;
  readonly seasonNumber: number;
  readonly tier: string;
  readonly state: string;
  /** True once the immutable final standings exist; ranks then never change. */
  readonly settled: boolean;
  readonly eventsTotal: number;
  /** Events the viewer has completed — the whole table's visibility frontier. */
  readonly eventsRevealed: number;
  readonly countingEvents: number;
  readonly events: readonly {
    readonly competitionId: string;
    readonly eventIndex: number;
    readonly eventNumber: number;
    readonly courseName: string;
    readonly revealed: boolean;
  }[];
  readonly standings: readonly CareerSeasonTableRow[];
}

export interface CareerSeasonStandingView {
  readonly competitorId: string;
  readonly profileId: string | null;
  readonly displayName: string;
  readonly tier: string;
  readonly nextTier: string;
  readonly active: boolean;
  readonly rank: number | null;
  readonly seasonPoints: number;
  readonly movement: string;
}

export interface CareerChampionshipSlotView {
  readonly slotNumber: number;
  readonly competitorType: "HUMAN" | "BOT";
  readonly profileId: string | null;
  readonly botIdentityId: string | null;
  readonly displayName: string;
  readonly source: string;
  readonly sourceTrace: unknown;
  readonly relativeToPar: number | null;
  readonly completed: boolean;
  readonly noShow: boolean;
  readonly rank: number | null;
  readonly isWinner: boolean;
  readonly roundId: string | null;
  readonly isMe: boolean;
}

export interface CareerChampionshipView {
  readonly id: string;
  readonly cycleNumber: number;
  readonly state: string;
  readonly competition: {
    readonly id: string;
    readonly courseSlug: string;
    readonly courseName: string;
    readonly courseLocation: string;
    readonly state: string;
    readonly unlocksAt: string;
    readonly deadlineAt: string;
  } | null;
  readonly qualified: boolean;
  readonly slots: readonly CareerChampionshipSlotView[];
}

/** Assemble the caller's current Career state. Returns null if not enrolled. */
export async function careerStateForUser(
  db: PrismaClient,
  userId: string,
): Promise<CareerStateView | null> {
  const profile = await db.careerProfile.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: [{ careerNumber: "desc" }, { id: "desc" }],
  });
  if (!profile) return null;

  const world = await db.careerWorld.findUniqueOrThrow({
    where: { id: profile.worldId },
    select: { id: true, worldKey: true, formulaVersion: true },
  });
  const cohort = await db.careerCohort.findUnique({
    where: {
      worldId_seasonNumber_tier: {
        worldId: profile.worldId,
        seasonNumber: profile.currentSeason,
        tier: profile.tier,
      },
    },
    include: {
      competitions: {
        where: { kind: "EVENT" },
        orderBy: { eventNumber: "asc" },
        include: { course: { select: { slug: true, name: true, location: true } } },
      },
    },
  });
  const entries = cohort
    ? await db.careerEventEntry.findMany({
      where: { profileId: profile.id, competition: { cohortId: cohort.id } },
      select: {
        competitionId: true,
        completed: true,
        relativeToPar: true,
        roundId: true,
        rounds: {
          orderBy: { roundNumber: "asc" },
          select: {
            roundId: true,
            roundNumber: true,
            completed: true,
            relativeToPar: true,
          },
        },
      },
    })
    : [];
  const entryByCompetition = new Map(entries.map((entry) => [entry.competitionId, entry]));

  const schedule: CareerScheduleEntry[] = (cohort?.competitions ?? []).map((competition) => {
    const entry = entryByCompetition.get(competition.id);
    const completedRounds = entry?.rounds.filter((round) => round.completed) ?? [];
    const currentRound = entry?.rounds.find((round) => !round.completed);
    return {
      competitionId: competition.id,
      eventNumber: competition.eventNumber,
      courseSlug: competition.course.slug,
      courseName: competition.course.name,
      courseLocation: competition.course.location,
      state: competition.state,
      unlocksAt: competition.unlocksAt.toISOString(),
      deadlineAt: competition.deadlineAt.toISOString(),
      completed: entry?.completed ?? false,
      relativeToPar: entry?.relativeToPar ?? null,
      roundId: currentRound?.roundId ?? entry?.roundId ?? null,
      roundsCompleted: competition.roundsPerPlayer === 1 && entry?.completed
        ? 1
        : completedRounds.length,
      roundsTotal: competition.roundsPerPlayer,
    };
  });

  const [latestRating, latestHistory, latestDevelopment, retiredProfiles] = await Promise.all([
    db.careerRatingHistory.findFirst({
      where: { profileId: profile.id },
      orderBy: { seasonNumber: "desc" },
      select: { seasonNumber: true, rating: true },
    }),
    db.careerSeasonHistory.findFirst({
      where: { profileId: profile.id },
      orderBy: [{ seasonNumber: "desc" }, { createdAt: "desc" }],
      select: {
        cohortId: true,
        seasonNumber: true,
        tier: true,
        nextTier: true,
        rank: true,
        activeFieldSize: true,
        seasonPoints: true,
        movement: true,
      },
    }),
    db.careerDevelopmentLedger.findFirst({
      where: { profileId: profile.id, sourceType: "season-award" },
      orderBy: [{ seasonNumber: "desc" }, { createdAt: "desc" }],
      select: { seasonNumber: true, points: true, reason: true },
    }),
    db.careerProfile.findMany({
      where: { userId, status: "RETIRED" },
      orderBy: [{ careerNumber: "desc" }, { id: "desc" }],
      select: {
        id: true,
        careerNumber: true,
        settledSeasons: true,
        legacyTotal: true,
        tier: true,
        retiredAt: true,
        histories: {
          select: { tier: true, nextTier: true },
        },
      },
    }),
  ]);

  // An unplayed Championship never expires, so surface the oldest outstanding
  // one rather than only the newest.
  const championship = await db.careerChampionship.findFirst({
    where: { worldId: profile.worldId, state: { in: ["FORMING", "ACTIVE"] } },
    orderBy: { cycleNumber: "asc" },
    select: { id: true, cycleNumber: true, state: true },
  });

  const skills = requireCareerSkillRanks({
    driving: profile.drivingRank,
    approach: profile.approachRank,
    shortGame: profile.shortGameRank,
    putting: profile.puttingRank,
  });
  const movementEvidence = Array.isArray(profile.movementEvidence)
    ? profile.movementEvidence.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    )
    : [];
  const formula = requireCareerFormulaBundle(
    cohort?.formulaVersion ?? world.formulaVersion,
  );
  const tierKey = profile.tier.toLowerCase() as "local" | "challenger" | "pro";
  const tierThresholds = formula.movement.tierThresholds?.[tierKey];
  const reason = latestDevelopment?.reason as { reasons?: unknown } | null;
  const latestReasons = Array.isArray(reason?.reasons)
    ? reason.reasons.filter((value): value is string => typeof value === "string")
    : [];

  return {
    world,
    profile: {
      id: profile.id,
      tier: profile.tier,
      status: profile.status,
      currentSeason: profile.currentSeason,
      settledSeasons: profile.settledSeasons,
      legacyTotal: profile.legacyTotal,
      careerNumber: profile.careerNumber,
      developmentPoints: profile.developmentPoints,
      skills,
    },
    development: {
      enabled: formula.development != null,
      points: profile.developmentPoints,
      skills: CAREER_SKILLS.map((skill) => ({
        skill,
        rank: skills[skill],
        maxRank: formula.development?.maxRank ?? skills[skill],
        nextCost: formula.development
          ? careerSkillUpgradeCost(skills[skill])
          : null,
      })),
      latestAward: latestDevelopment
        ? {
          seasonNumber: latestDevelopment.seasonNumber,
          points: latestDevelopment.points,
          reasons: latestReasons,
        }
        : null,
    },
    movement: {
      evidence: movementEvidence,
      average: movementEvidence.length
        ? movementEvidence.reduce((sum, value) => sum + value, 0) / movementEvidence.length
        : null,
      promotionThreshold: profile.tier === "PRO"
        ? null
        : tierThresholds?.promoteThreshold
          ?? formula.movement.rollingPromoteThreshold,
      promotionFloor: profile.tier === "PRO"
        ? null
        : tierThresholds?.promotionFloor
          ?? formula.movement.rollingPromotionFloor,
      relegationThreshold: profile.tier === "LOCAL"
        ? null
        : tierThresholds?.relegateThreshold
          ?? formula.movement.rollingRelegateThreshold,
    },
    retiredCareers: retiredProfiles.map((retired) => {
      const tierRank = { LOCAL: 0, CHALLENGER: 1, PRO: 2 } as const;
      const highestTier = [
        retired.tier,
        ...retired.histories.flatMap((history) => [history.tier, history.nextTier]),
      ].reduce((highest, candidate) =>
        tierRank[candidate] > tierRank[highest] ? candidate : highest, "LOCAL");
      return {
        profileId: retired.id,
        careerNumber: retired.careerNumber,
        settledSeasons: retired.settledSeasons,
        legacyTotal: retired.legacyTotal,
        highestTier,
        retiredAt: retired.retiredAt?.toISOString() ?? null,
      };
    }),
    seasonProgress: {
      completed: schedule.filter((entry) => entry.completed).length,
      total: schedule.length,
    },
    championship,
    cohort: cohort
      ? { id: cohort.id, seasonNumber: cohort.seasonNumber, tier: cohort.tier, state: cohort.state }
      : null,
    schedule,
    latestRating,
    latestSettledSeason: latestHistory
      ? {
        cohortId: latestHistory.cohortId,
        seasonNumber: latestHistory.seasonNumber,
        tier: latestHistory.tier,
        nextTier: latestHistory.nextTier,
        rank: latestHistory.rank,
        fieldSize: latestHistory.activeFieldSize,
        seasonPoints: latestHistory.seasonPoints,
        movement: latestHistory.movement,
      }
      : null,
  };
}

export interface CareerStateWithRepair {
  readonly state: CareerStateView | null;
  readonly repair: CareerRepairResult;
}

/** True only when the profile owns an entry in this personal Career event. */
export async function careerProfileOwnsEvent(
  db: PrismaClient,
  profileId: string,
  competitionId: string,
): Promise<boolean> {
  return (await db.careerEventEntry.count({
    where: { profileId, competitionId },
  })) === 1;
}

/** True only when the profile is a member of this personal Career season. */
export async function careerProfileOwnsCohort(
  db: PrismaClient,
  profileId: string,
  cohortId: string,
): Promise<boolean> {
  return (await db.careerCohortMember.count({
    where: { profileId, cohortId },
  })) === 1;
}

/**
 * The exact composition a `GET /api/career/state` route performs: assemble the
 * read-only view AND fire the nonblocking repair. No lifecycle mutation happens
 * synchronously here — repair only enqueues an out-of-band tick.
 */
export async function careerStateWithRepair(
  db: PrismaClient,
  userId: string,
  options: { now?: Date; enqueue?: CareerRepairEnqueue } = {},
): Promise<CareerStateWithRepair> {
  const state = await careerStateForUser(db, userId);
  const repair = await triggerCareerRepairIfPending(db, options);
  return { state, repair };
}

/**
 * Read an event's leaderboard, revealed one round at a time.
 *
 * The frontier is the viewer's own completed rounds. Finish round one and the
 * whole field's cumulative round-one scores appear; rounds two to four stay
 * sealed. Bot cumulative scores are summed from the immutable per-round cards
 * written at field lock — nothing here divides, splits, or re-simulates a total.
 */
export async function careerEventLeaderboard(
  db: PrismaClient,
  competitionId: string,
  viewerProfileId?: string | null,
): Promise<CareerEventLeaderboardView | null> {
  const competition = await db.careerCompetition.findUnique({
    where: { id: competitionId },
    include: {
      course: { select: { slug: true, name: true, location: true } },
      lockRevisions: {
        orderBy: { revision: "desc" },
        take: 1,
        include: {
          slots: {
            orderBy: { slotId: "asc" },
            include: {
              profile: { include: { user: { select: { username: true } } } },
              botIdentity: { select: { displayName: true } },
            },
          },
        },
      },
    },
  });
  if (!competition) return null;

  const slotByNumber = new Map(
    (competition.lockRevisions[0]?.slots ?? []).map((slot) => [slot.slotId, slot]),
  );
  const displayName = (slotId: number): string => {
    const slot = slotByNumber.get(slotId);
    return slot?.profile?.user.username
      ?? slot?.botIdentity?.displayName
      ?? (slot?.competitorType === "HUMAN" ? "Player" : `Rival ${slotId}`);
  };
  // The viewer sees opponents only once their own card is in. An anonymous
  // caller (no profile) is treated as not-yet-played, i.e. nothing revealed.
  const viewerEntry = viewerProfileId
    ? await db.careerEventEntry.findFirst({
      where: { competitionId, profileId: viewerProfileId },
      select: {
        completed: true,
        relativeToPar: true,
        roundId: true,
        rounds: {
          orderBy: { roundNumber: "asc" },
          select: {
            roundId: true,
            roundNumber: true,
            completed: true,
            relativeToPar: true,
          },
        },
      },
    })
    : null;

  const base = {
    id: competition.id,
    eventNumber: competition.eventNumber,
    courseSlug: competition.course.slug,
    courseName: competition.course.name,
    courseLocation: competition.course.location,
    state: competition.state,
    unlocksAt: competition.unlocksAt.toISOString(),
    deadlineAt: competition.deadlineAt.toISOString(),
    roundsPerPlayer: competition.roundsPerPlayer,
  };
  const completedRounds = viewerEntry?.rounds.filter((round) => round.completed) ?? [];
  const currentRound = viewerEntry?.rounds.find((round) => !round.completed);
  const legacyCompleted = competition.roundsPerPlayer === 1 && viewerEntry?.completed;
  const roundsCompleted = legacyCompleted ? 1 : completedRounds.length;
  const cumulativeRelativeToPar = legacyCompleted
    ? viewerEntry?.relativeToPar ?? 0
    : completedRounds.reduce((sum, round) => sum + (round.relativeToPar ?? 0), 0);
  const playerProgress = {
    roundsCompleted,
    roundsTotal: competition.roundsPerPlayer,
    nextRound: viewerEntry?.completed
      ? null
      : Math.min(roundsCompleted + 1, competition.roundsPerPlayer),
    cumulativeRelativeToPar,
    currentRoundId: currentRound?.roundId ?? viewerEntry?.roundId ?? null,
  };
  const roundsTotal = competition.roundsPerPlayer;
  const eventComplete = viewerEntry?.completed === true;
  // The frontier is the viewer's own play, never what exists in the database.
  const roundsRevealed = eventComplete ? roundsTotal : roundsCompleted;
  const orderedSlots = [...slotByNumber.values()].sort((left, right) => left.slotId - right.slotId);
  const identityFor = (slot: typeof orderedSlots[number]): string =>
    slot.competitorType === "HUMAN"
      ? `human:${slot.profileId ?? slot.slotId}`
      : `bot:${slot.botIdentityId ?? slot.slotId}`;
  /** Names and seats are public from the moment the field locks; scores are not. */
  const nameOnlyRows = (roundCardsAvailable: boolean): CareerEventLeaderboardView => ({
    competition: base,
    playerProgress,
    settled: false,
    revealed: false,
    roundsRevealed: 0,
    roundCardsAvailable,
    standings: orderedSlots.map((slot) => ({
      slotId: slot.slotId,
      competitorId: identityFor(slot),
      competitorType: slot.competitorType,
      displayName: displayName(slot.slotId),
      completed: false,
      noShow: false,
      roundsCompleted: 0,
      relativeToPar: null,
      rank: null,
      points: null,
      isMe: slot.profileId != null && slot.profileId === viewerProfileId,
    })),
  });

  if (roundsRevealed === 0) return nameOnlyRows(true);

  if (roundsRevealed >= roundsTotal) {
    // The event is complete for the viewer: show the immutable final if it has
    // been published, otherwise the same ordering computed from locked results.
    const final = await db.careerEventFinal.findFirst({
      where: { competitionId },
      orderBy: { createdAt: "desc" },
      select: { standings: true },
    });
    if (final) {
      const finalStandings = (final.standings as unknown as CareerEventStanding[]) ?? [];
      return {
        competition: base,
        playerProgress,
        settled: true,
        revealed: true,
        roundsRevealed: roundsTotal,
        roundCardsAvailable: true,
        standings: [...finalStandings]
          .sort((left, right) =>
            (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
            || left.slotId - right.slotId)
          .map((standing) => ({
            slotId: standing.slotId,
            competitorId: standing.competitorId,
            competitorType: standing.competitorType,
            displayName: displayName(standing.slotId),
            completed: standing.completed,
            noShow: standing.noShow,
            roundsCompleted: standing.completed ? roundsTotal : 0,
            relativeToPar: standing.relativeToPar,
            rank: standing.rank,
            points: standing.points,
            isMe: standing.profileId != null && standing.profileId === viewerProfileId,
          })),
      };
    }
    const results = await db.careerResult.findMany({
      where: { competitionId },
      select: { slotId: true, competitorType: true, relativeToPar: true, completed: true },
    });
    const scoreBySlot = new Map(results.map((result) => [
      result.slotId,
      result.completed ? result.relativeToPar : null,
    ]));
    return {
      competition: base,
      playerProgress,
      settled: false,
      revealed: true,
      roundsRevealed: roundsTotal,
      roundCardsAvailable: true,
      standings: rankCumulativeStandings(
        orderedSlots.map((slot) => ({
          slotId: slot.slotId,
          competitorId: identityFor(slot),
          competitorType: slot.competitorType,
          displayName: displayName(slot.slotId),
          isMe: slot.profileId != null && slot.profileId === viewerProfileId,
          relativeToPar: scoreBySlot.get(slot.slotId) ?? null,
        })),
        roundsTotal,
      ),
    };
  }

  // Partway through: sum each bot's stored cards through the revealed round.
  const botCumulative = await careerBotCumulativeBySlot(db, competitionId, roundsRevealed);
  if (!botCumulative) return nameOnlyRows(false);
  const viewerSlotId = orderedSlots
    .find((slot) => slot.profileId != null && slot.profileId === viewerProfileId)?.slotId;
  return {
    competition: base,
    playerProgress,
    settled: false,
    revealed: true,
    roundsRevealed,
    roundCardsAvailable: true,
    standings: rankCumulativeStandings(
      orderedSlots.map((slot) => ({
        slotId: slot.slotId,
        competitorId: identityFor(slot),
        competitorType: slot.competitorType,
        displayName: displayName(slot.slotId),
        isMe: slot.slotId === viewerSlotId,
        relativeToPar: slot.slotId === viewerSlotId
          ? cumulativeRelativeToPar
          : botCumulative.get(slot.slotId) ?? null,
      })),
      roundsRevealed,
    ),
  };
}

/** Read the season standings recorded for a cohort (present once settled). */
export async function careerSeasonStandings(
  db: PrismaClient,
  cohortId: string,
): Promise<CareerSeasonStandingView[]> {
  const cohort = await db.careerCohort.findUnique({
    where: { id: cohortId },
    include: {
      competitions: {
        where: { kind: "EVENT" },
        orderBy: { eventNumber: "asc" },
        include: {
          finals: { orderBy: { createdAt: "desc" }, take: 1 },
          lockRevisions: {
            orderBy: { revision: "desc" },
            take: 1,
            include: {
              slots: {
                include: {
                  profile: { include: { user: { select: { username: true } } } },
                  botIdentity: { select: { displayName: true } },
                },
              },
            },
          },
        },
      },
      members: { select: { profileId: true } },
    },
  });
  if (!cohort || cohort.state !== "SETTLED" || cohort.competitions.length !== 4) return [];

  const humanHistory = await db.careerSeasonHistory.findFirst({
    where: { cohortId },
    orderBy: { createdAt: "asc" },
  });
  const displayNames = new Map<string, {
    displayName: string;
    profileId: string | null;
  }>();
  for (const slot of cohort.competitions[0]?.lockRevisions[0]?.slots ?? []) {
    const competitorId = slot.competitorType === "HUMAN"
      ? `human:${slot.profileId}`
      : `bot:${slot.botIdentityId}`;
    displayNames.set(competitorId, {
      displayName: slot.profile?.user.username
        ?? slot.botIdentity?.displayName
        ?? (slot.competitorType === "HUMAN" ? "Player" : `Rival ${slot.slotId}`),
      profileId: slot.profileId,
    });
  }

  const eventsByCompetitor = new Map<string, SeasonEventResult[]>();
  for (const competition of cohort.competitions) {
    const eventIndex = (competition.eventNumber ?? 1) - 1;
    const final = competition.finals[0];
    if (!final || !Array.isArray(final.standings)) return [];
    for (const standing of final.standings as unknown as CareerEventStanding[]) {
      const events = eventsByCompetitor.get(standing.competitorId) ?? [];
      events.push({
        eventIndex,
        competitorId: standing.competitorId,
        completed: standing.completed,
        relativeToPar: standing.relativeToPar,
        rank: standing.rank,
        points: standing.points,
      });
      eventsByCompetitor.set(standing.competitorId, events);
    }
  }

  const standings = rankSeason([...eventsByCompetitor].map(([competitorId, events]) => ({
    competitorId,
    events,
    fallbackDraw: hashSeed(`career:season-fallback:${cohort.id}:${competitorId}`),
  })));
  return standings.map((standing, index) => {
    const identity = displayNames.get(standing.competitorId);
    const isHuman = identity?.profileId != null;
    return {
      competitorId: standing.competitorId,
      profileId: identity?.profileId ?? null,
      displayName: identity?.displayName ?? "Rival",
      tier: cohort.tier,
      nextTier: isHuman ? humanHistory?.nextTier ?? cohort.tier : cohort.tier,
      active: standing.active,
      rank: standing.active ? index + 1 : null,
      seasonPoints: standing.seasonPoints,
      movement: isHuman ? humanHistory?.movement ?? "HOLD" : "RIVAL",
    };
  });
}

/**
 * The season table as the player should see it at any moment.
 *
 * All twenty competitors are listed from the instant the field locks, including
 * before a single card is played. Event results appear only as the viewer
 * completes each event, and an event counts for every competitor or for none —
 * so an unrevealed event is absent from the maths rather than scored as zero.
 * Once the season is settled the immutable final standings are used verbatim.
 */
export async function careerSeasonTable(
  db: PrismaClient,
  cohortId: string,
  viewerProfileId: string,
): Promise<CareerSeasonTableView | null> {
  const cohort = await db.careerCohort.findUnique({
    where: { id: cohortId },
    include: {
      competitions: {
        where: { kind: "EVENT" },
        orderBy: { eventNumber: "asc" },
        include: {
          course: { select: { name: true } },
          finals: { orderBy: { createdAt: "desc" }, take: 1 },
          results: {
            select: { slotId: true, competitorType: true, relativeToPar: true, completed: true },
          },
          lockRevisions: {
            orderBy: { revision: "desc" },
            take: 1,
            include: {
              slots: {
                orderBy: { slotId: "asc" },
                include: {
                  profile: { include: { user: { select: { username: true } } } },
                  botIdentity: { select: { displayName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!cohort) return null;

  const entries = await db.careerEventEntry.findMany({
    where: { profileId: viewerProfileId, competition: { cohortId } },
    select: { competitionId: true, completed: true },
  });
  const completedByViewer = new Set(
    entries.filter((entry) => entry.completed).map((entry) => entry.competitionId),
  );

  const events = cohort.competitions.map((competition, index) => ({
    competitionId: competition.id,
    eventIndex: (competition.eventNumber ?? index + 1) - 1,
    eventNumber: competition.eventNumber ?? index + 1,
    courseName: competition.course.name,
    revealed: completedByViewer.has(competition.id),
  }));
  const eventsRevealed = events.filter((event) => event.revealed).length;

  // Identities come from the locked field, so every rival is named from the
  // start — only their scores wait on the viewer.
  const identities = new Map<string, { displayName: string; profileId: string | null }>();
  for (const competition of cohort.competitions) {
    for (const slot of competition.lockRevisions[0]?.slots ?? []) {
      const competitorId = slot.competitorType === "HUMAN"
        ? `human:${slot.profileId}`
        : `bot:${slot.botIdentityId}`;
      if (identities.has(competitorId)) continue;
      identities.set(competitorId, {
        displayName: slot.profile?.user.username
          ?? slot.botIdentity?.displayName
          ?? (slot.competitorType === "HUMAN" ? "Player" : `Rival ${slot.slotId}`),
        profileId: slot.profileId,
      });
    }
  }

  // Per-event standings for revealed events only: the published final when it
  // exists, else the identical calculation over the locked results.
  const revealedResults = new Map<string, SeasonEventResult[]>();
  for (const competition of cohort.competitions) {
    if (!completedByViewer.has(competition.id)) continue;
    const eventIndex = (competition.eventNumber ?? 1) - 1;
    const final = competition.finals[0];
    const standings: readonly CareerEventStanding[] = final && Array.isArray(final.standings)
      ? final.standings as unknown as CareerEventStanding[]
      : calculateCareerEventStandings(
        (competition.lockRevisions[0]?.slots ?? []).map((slot) => {
          const result = competition.results.find((candidate) => candidate.slotId === slot.slotId);
          return {
            slotId: slot.slotId,
            competitorType: slot.competitorType,
            profileId: slot.profileId,
            botIdentityId: slot.botIdentityId,
            relativeToPar: result?.relativeToPar ?? null,
            completed: result?.completed ?? false,
          };
        }),
      );
    for (const standing of standings) {
      const list = revealedResults.get(standing.competitorId) ?? [];
      list.push({
        eventIndex,
        competitorId: standing.competitorId,
        completed: standing.completed,
        relativeToPar: standing.relativeToPar,
        rank: standing.rank,
        points: standing.points,
      });
      revealedResults.set(standing.competitorId, list);
    }
  }

  const settledStandings = cohort.state === "SETTLED"
    ? await careerSeasonStandings(db, cohortId)
    : [];
  const settled = settledStandings.length > 0;
  const settledByCompetitor = new Map(settledStandings.map((row) => [row.competitorId, row]));

  const summaries = [...identities.keys()].map((competitorId) => ({
    competitorId,
    summary: summarizeSeason({
      competitorId,
      events: revealedResults.get(competitorId) ?? [],
      fallbackDraw: hashSeed(`career:season-fallback:${cohortId}:${competitorId}`),
    }),
  }));
  const ordered = settled
    // Settled seasons are immutable: keep the published order exactly.
    ? settledStandings
      .map((row) => summaries.find((entry) => entry.competitorId === row.competitorId))
      .filter((entry): entry is typeof summaries[number] => entry != null)
    : [...summaries].sort((left, right) => {
      const performance = compareSeasonPerformance(left.summary, right.summary);
      if (performance !== 0) return performance;
      if (left.summary.fallbackDraw !== right.summary.fallbackDraw) {
        return left.summary.fallbackDraw - right.summary.fallbackDraw;
      }
      return left.competitorId.localeCompare(right.competitorId);
    });

  const standings: CareerSeasonTableRow[] = ordered.map((entry, index) => {
    const identity = identities.get(entry.competitorId)!;
    const settledRow = settledByCompetitor.get(entry.competitorId);
    const counting = new Set(entry.summary.countingEventIndexes);
    const byIndex = new Map(
      (revealedResults.get(entry.competitorId) ?? []).map((result) => [result.eventIndex, result]),
    );
    return {
      competitorId: entry.competitorId,
      profileId: identity.profileId,
      displayName: identity.displayName,
      isMe: identity.profileId === viewerProfileId,
      tier: settledRow?.tier ?? cohort.tier,
      nextTier: settledRow?.nextTier ?? cohort.tier,
      // Before anything is revealed there is no competitive result, so there is
      // no rank to show — an invented "1st of 20" would be meaningless.
      rank: settled
        ? settledRow?.rank ?? null
        : eventsRevealed > 0 ? index + 1 : null,
      seasonPoints: settledRow?.seasonPoints ?? entry.summary.seasonPoints,
      eventsCompleted: entry.summary.completedEvents,
      movement: settledRow?.movement ?? (identity.profileId ? "HOLD" : "RIVAL"),
      events: events.map((event) => {
        const result = byIndex.get(event.eventIndex);
        return {
          eventIndex: event.eventIndex,
          eventNumber: event.eventNumber,
          revealed: event.revealed,
          relativeToPar: result?.relativeToPar ?? null,
          rank: result?.rank ?? null,
          points: result?.points ?? null,
          counting: result != null && counting.has(event.eventIndex),
        };
      }),
    };
  });

  return {
    cohortId,
    seasonNumber: cohort.seasonNumber,
    tier: cohort.tier,
    state: cohort.state,
    settled,
    eventsTotal: events.length,
    eventsRevealed,
    countingEvents: 3,
    events,
    standings,
  };
}

/** Read a Championship's field + results by world + cycle (latest if omitted). */
export async function careerChampionshipView(
  db: PrismaClient,
  worldId: string,
  cycleNumber?: number,
  viewerProfileId?: string,
): Promise<CareerChampionshipView | null> {
  const championship = await db.careerChampionship.findFirst({
    where: cycleNumber != null ? { worldId, cycleNumber } : { worldId },
    orderBy: { cycleNumber: "desc" },
    include: {
      competitions: {
        where: { kind: "CHAMPIONSHIP" },
        take: 1,
        include: { course: { select: { slug: true, name: true, location: true } } },
      },
      slots: {
        orderBy: { slotNumber: "asc" },
        include: {
          profile: { include: { user: { select: { username: true } } } },
          botIdentity: { select: { displayName: true } },
        },
      },
      results: { orderBy: { slotNumber: "asc" } },
    },
  });
  if (!championship) return null;
  const resultBySlot = new Map(championship.results.map((result) => [result.slotNumber, result]));
  const competition = championship.competitions[0] ?? null;
  return {
    id: championship.id,
    cycleNumber: championship.cycleNumber,
    state: championship.state,
    competition: competition
      ? {
        id: competition.id,
        courseSlug: competition.course.slug,
        courseName: competition.course.name,
        courseLocation: competition.course.location,
        state: competition.state,
        unlocksAt: competition.unlocksAt.toISOString(),
        deadlineAt: competition.deadlineAt.toISOString(),
      }
      : null,
    qualified: championship.slots.some((slot) => slot.profileId === viewerProfileId),
    slots: championship.slots.map((slot) => {
      const result = resultBySlot.get(slot.slotNumber);
      return {
        slotNumber: slot.slotNumber,
        competitorType: slot.competitorType,
        profileId: slot.profileId,
        botIdentityId: slot.botIdentityId,
        displayName: slot.profile?.user.username
          ?? slot.botIdentity?.displayName
          ?? (slot.competitorType === "HUMAN" ? "Player" : `Elite Rival ${slot.slotNumber}`),
        source: slot.source,
        sourceTrace: slot.sourceTrace,
        relativeToPar: result?.relativeToPar ?? null,
        completed: result?.completed ?? false,
        noShow: false,
        rank: result?.rank ?? null,
        isWinner: result?.isWinner ?? false,
        roundId: result?.roundId ?? null,
        isMe: slot.profileId === viewerProfileId,
      };
    }),
  };
}
