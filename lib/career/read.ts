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
import { hashSeed } from "@/lib/engine/rng";
import { rankSeason, type SeasonEventResult } from "./rules";

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
  };
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
  readonly relativeToPar: number | null;
  readonly rank: number | null;
  readonly points: number | null;
}

export interface CareerEventLeaderboardView {
  /**
   * False while the viewer has not completed this event: opponents' scores are
   * withheld. Knowing the number to beat changes aggression decisions, so this
   * is an anti-exploit rule, not a presentation choice.
   */
  readonly revealed: boolean;
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
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!profile) return null;

  const world = await db.careerWorld.findUniqueOrThrow({
    where: { id: profile.worldId },
    select: { id: true, worldKey: true },
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

  const [latestRating, latestHistory] = await Promise.all([
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
  ]);

  // An unplayed Championship never expires, so surface the oldest outstanding
  // one rather than only the newest.
  const championship = await db.careerChampionship.findFirst({
    where: { worldId: profile.worldId, state: { in: ["FORMING", "ACTIVE"] } },
    orderBy: { cycleNumber: "asc" },
    select: { id: true, cycleNumber: true, state: true },
  });

  return {
    world,
    profile: {
      id: profile.id,
      tier: profile.tier,
      status: profile.status,
      currentSeason: profile.currentSeason,
      settledSeasons: profile.settledSeasons,
      legacyTotal: profile.legacyTotal,
    },
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

/** Read an event's leaderboard: the committed final if settled, else live results. */
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
  const revealed = viewerEntry?.completed === true;

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
      revealed,
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
          relativeToPar: standing.relativeToPar,
          rank: standing.rank,
          points: standing.points,
        })),
    };
  }
  // Not settled yet — surface the locked results in leaderboard order.
  const results = await db.careerResult.findMany({
    where: { competitionId },
    orderBy: [{ completed: "desc" }, { relativeToPar: "asc" }, { slotId: "asc" }],
    select: {
      slotId: true,
      competitorType: true,
      relativeToPar: true,
      completed: true,
    },
  });
  // Unsettled: the bot cards already exist, so they must stay hidden until the
  // viewer has played. Their own row is always visible.
  if (!revealed) {
    const mine = viewerProfileId
      ? [...slotByNumber.values()].find((slot) => slot.profileId === viewerProfileId)
      : undefined;
    return {
      competition: base,
      playerProgress,
      settled: false,
      revealed: false,
      standings: mine
        ? [{
          slotId: mine.slotId,
          competitorId: `human:${mine.profileId}`,
          competitorType: "HUMAN" as const,
          displayName: displayName(mine.slotId),
          completed: false,
          noShow: false,
          relativeToPar: null,
          rank: null,
          points: null,
        }]
        : [],
    };
  }

  return {
    competition: base,
    playerProgress,
    settled: false,
    revealed: true,
    standings: results.map((result, index) => {
      const slot = slotByNumber.get(result.slotId);
      const identity = slot?.competitorType === "HUMAN"
        ? `human:${slot.profileId ?? result.slotId}`
        : `bot:${slot?.botIdentityId ?? result.slotId}`;
      return {
        slotId: result.slotId,
        competitorId: identity,
        competitorType: result.competitorType,
        displayName: displayName(result.slotId),
        completed: result.completed,
        noShow: false,
        relativeToPar: result.relativeToPar,
        rank: result.completed ? index + 1 : null,
        points: null,
      };
    }),
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
