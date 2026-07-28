import { Prisma, type PrismaClient } from "@prisma/client";

import {
  CAREER_SKILL_LABELS,
  careerSkillUpgradeCost,
  isCareerSkill,
  requireCareerSkillRanks,
  type CareerSkill,
  type CareerSkillRanks,
} from "./development";

type UpgradeCareerSkillResult =
  | {
    readonly ok: true;
    readonly replayed: boolean;
    readonly skill: CareerSkill;
    readonly cost: number;
    readonly pointsRemaining: number;
    readonly ranks: CareerSkillRanks;
  }
  | {
    readonly ok: false;
    readonly error:
      | "not-enrolled"
      | "invalid-skill"
      | "rank-conflict"
      | "max-rank"
      | "not-enough-points";
  };

function profileRanks(profile: {
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

function rankFor(
  profile: {
    drivingRank: number;
    approachRank: number;
    shortGameRank: number;
    puttingRank: number;
  },
  skill: CareerSkill,
): number {
  return profileRanks(profile)[skill];
}

/**
 * Spend points on exactly one rank. The expected-rank compare-and-set plus the
 * deterministic ledger identity make retries idempotent and concurrent taps
 * unable to double-spend.
 */
export async function upgradeCareerSkill(
  db: PrismaClient,
  userId: string,
  requestedSkill: unknown,
  expectedRank: number,
): Promise<UpgradeCareerSkillResult> {
  if (!isCareerSkill(requestedSkill)) {
    return { ok: false, error: "invalid-skill" };
  }
  const skill = requestedSkill;
  if (!Number.isSafeInteger(expectedRank)) {
    return { ok: false, error: "rank-conflict" };
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`career:development:${userId}`}, 0)
      )
    `;
    const profile = await tx.careerProfile.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ careerNumber: "desc" }, { id: "desc" }],
    });
    if (!profile) return { ok: false, error: "not-enrolled" } as const;

    const currentRank = rankFor(profile, skill);
    if (currentRank > expectedRank) {
      const replay = await tx.careerDevelopmentLedger.findUnique({
        where: {
          profileId_sourceType_sourceId: {
            profileId: profile.id,
            sourceType: "skill-upgrade",
            sourceId: `${skill}:rank${currentRank}`,
          },
        },
      });
      if (replay?.rankBefore === expectedRank && replay.rankAfter === currentRank) {
        return {
          ok: true,
          replayed: true,
          skill,
          cost: Math.abs(replay.points),
          pointsRemaining: profile.developmentPoints,
          ranks: profileRanks(profile),
        } as const;
      }
      return { ok: false, error: "rank-conflict" } as const;
    }
    if (currentRank !== expectedRank) {
      return { ok: false, error: "rank-conflict" } as const;
    }
    const cost = careerSkillUpgradeCost(currentRank);
    if (cost == null) return { ok: false, error: "max-rank" } as const;
    if (profile.developmentPoints < cost) {
      return { ok: false, error: "not-enough-points" } as const;
    }
    const nextRank = currentRank + 1;

    const common = {
      where: {
        id: profile.id,
        status: "ACTIVE" as const,
        developmentPoints: { gte: cost },
      },
      data: {
        developmentPoints: { decrement: cost },
      },
    };
    let updated;
    if (skill === "driving") {
      updated = await tx.careerProfile.updateMany({
        ...common,
        where: { ...common.where, drivingRank: currentRank },
        data: { ...common.data, drivingRank: { increment: 1 } },
      });
    } else if (skill === "approach") {
      updated = await tx.careerProfile.updateMany({
        ...common,
        where: { ...common.where, approachRank: currentRank },
        data: { ...common.data, approachRank: { increment: 1 } },
      });
    } else if (skill === "shortGame") {
      updated = await tx.careerProfile.updateMany({
        ...common,
        where: { ...common.where, shortGameRank: currentRank },
        data: { ...common.data, shortGameRank: { increment: 1 } },
      });
    } else {
      updated = await tx.careerProfile.updateMany({
        ...common,
        where: { ...common.where, puttingRank: currentRank },
        data: { ...common.data, puttingRank: { increment: 1 } },
      });
    }
    if (updated.count !== 1) {
      throw new Error(`Career ${skill} upgrade compare-and-set failed`);
    }

    await tx.careerDevelopmentLedger.create({
      data: {
        profileId: profile.id,
        sourceType: "skill-upgrade",
        sourceId: `${skill}:rank${nextRank}`,
        skill,
        points: -cost,
        rankBefore: currentRank,
        rankAfter: nextRank,
        reason: {
          label: `${CAREER_SKILL_LABELS[skill]} rank ${nextRank}`,
          expectedRank,
        },
        revisionId: `career-development:${profile.id}:${skill}:rank${nextRank}`,
      },
    });
    const fresh = await tx.careerProfile.findUniqueOrThrow({
      where: { id: profile.id },
    });
    return {
      ok: true,
      replayed: false,
      skill,
      cost,
      pointsRemaining: fresh.developmentPoints,
      ranks: profileRanks(fresh),
    } as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 20_000,
  });
}

export type RetireCareerResult =
  | {
    readonly ok: true;
    readonly replayed: boolean;
    readonly retiredProfileId: string;
    readonly careerNumber: number;
  }
  | {
    readonly ok: false;
    readonly error:
      | "not-enrolled"
      | "career-already-started"
      | "championship-in-progress";
  };

/**
 * Archive an untouched current season. A player cannot use retirement to erase
 * a poor card or reroll a partially played field; they must finish that season
 * first and retire before taking a shot in the next one.
 */
export async function retireCareerJourney(
  db: PrismaClient,
  userId: string,
  expectedProfileId: string,
): Promise<RetireCareerResult> {
  if (!expectedProfileId.trim()) {
    return { ok: false, error: "not-enrolled" };
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`career:retire:${userId}`}, 0))
    `;
    const profile = await tx.careerProfile.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ careerNumber: "desc" }, { id: "desc" }],
    });
    if (profile && profile.id !== expectedProfileId) {
      // A retry can arrive after the first request has already archived the old
      // profile and created the replacement. Replay only the exact retired
      // identity; never interpret the request as permission to retire the new
      // active Career.
      const retired = await tx.careerProfile.findFirst({
        where: { id: expectedProfileId, userId, status: "RETIRED" },
      });
      return retired
        ? {
          ok: true,
          replayed: true,
          retiredProfileId: retired.id,
          careerNumber: retired.careerNumber,
        } as const
        : { ok: false, error: "not-enrolled" } as const;
    }
    if (!profile) {
      const retired = await tx.careerProfile.findFirst({
        where: { id: expectedProfileId, userId, status: "RETIRED" },
      });
      return retired
        ? {
          ok: true,
          replayed: true,
          retiredProfileId: retired.id,
          careerNumber: retired.careerNumber,
        } as const
        : { ok: false, error: "not-enrolled" } as const;
    }
    const cohort = await tx.careerCohort.findUnique({
      where: {
        worldId_seasonNumber_tier: {
          worldId: profile.worldId,
          seasonNumber: profile.currentSeason,
          tier: profile.tier,
        },
      },
      select: { id: true },
    });
    if (!cohort) throw new Error(`Active Career profile ${profile.id} has no current season`);
    const startedEntries = await tx.careerEventEntry.count({
      where: {
        profileId: profile.id,
        competition: { cohortId: cohort.id },
        OR: [
          { roundId: { not: null } },
          { completed: true },
          { rounds: { some: {} } },
        ],
      },
    });
    if (startedEntries > 0) {
      return { ok: false, error: "career-already-started" } as const;
    }

    const activeChampionshipCard = await tx.careerChampionshipResult.count({
      where: {
        profileId: profile.id,
        roundId: { not: null },
        championship: {
          state: { in: ["FORMING", "ACTIVE", "ENDED"] },
        },
      },
    });
    if (activeChampionshipCard > 0) {
      return { ok: false, error: "championship-in-progress" } as const;
    }

    const retiredAt = new Date();
    const retired = await tx.careerProfile.updateMany({
      where: { id: profile.id, status: "ACTIVE" },
      data: { status: "RETIRED", retiredAt },
    });
    if (retired.count !== 1) {
      throw new Error(`Career profile ${profile.id} retirement compare-and-set failed`);
    }
    await tx.careerWorld.update({
      where: { id: profile.worldId },
      data: { state: "RETIRED" },
    });
    return {
      ok: true,
      replayed: false,
      retiredProfileId: profile.id,
      careerNumber: profile.careerNumber,
    } as const;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 20_000,
  });
}
