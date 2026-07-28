/**
 * Career Mode — the Legacy ledger, read-only and account-scoped.
 *
 * `CareerLegacyLedger` is the source of truth. Nothing here recalculates a
 * historical award from today's formulas: a row published years of play ago is
 * displayed exactly as it was written, which is the whole point of an immutable
 * ledger. An optional profile selector can open one of the caller's archived
 * Careers, but the user ID is always part of the query so another account's
 * ledger can never be read.
 *
 * Legacy is permanent and never decreases. This module does not enforce that by
 * hiding anything: if a negative row ever existed it is displayed honestly and
 * reported through `invariantViolations` so a test or diagnostic can catch it.
 */
import type { CareerTier, PrismaClient } from "@prisma/client";

import { CAREER_SEASONS_PER_CYCLE } from "./constants";

/** Display-only prestige ladder. Frozen in docs/career-player-paced-design.md §13. */
export const CAREER_LEGACY_MILESTONES = [
  { title: "Club Regular", threshold: 250 },
  { title: "Tour Veteran", threshold: 1_000 },
  { title: "Established Pro", threshold: 2_500 },
  { title: "Tour Legend", threshold: 5_000 },
  { title: "Hall of Fame", threshold: 10_000 },
  { title: "Immortal", threshold: 25_000 },
] as const;

export const CAREER_LEGACY_STARTING_TITLE = "Rookie";

export interface CareerLegacyTitle {
  readonly title: string;
  readonly earnedAt: number;
  readonly nextTitle: string | null;
  readonly nextThreshold: number | null;
  readonly pointsToNext: number | null;
  /** 0..1 progress from the current title's threshold to the next one. */
  readonly progress: number;
}

export function careerLegacyTitle(total: number): CareerLegacyTitle {
  const points = Math.max(0, total);
  let earnedAt = 0;
  let title = CAREER_LEGACY_STARTING_TITLE;
  for (const milestone of CAREER_LEGACY_MILESTONES) {
    if (points >= milestone.threshold) {
      title = milestone.title;
      earnedAt = milestone.threshold;
    }
  }
  const next = CAREER_LEGACY_MILESTONES.find((milestone) => points < milestone.threshold);
  if (!next) {
    return {
      title,
      earnedAt,
      nextTitle: null,
      nextThreshold: null,
      pointsToNext: null,
      progress: 1,
    };
  }
  const span = next.threshold - earnedAt;
  return {
    title,
    earnedAt,
    nextTitle: next.title,
    nextThreshold: next.threshold,
    pointsToNext: next.threshold - points,
    progress: span <= 0 ? 1 : Math.min(1, Math.max(0, (points - earnedAt) / span)),
  };
}

/**
 * The single mapping from a stored award type to player-facing words. A future
 * award type that is not listed here still renders — it degrades to a readable
 * generic label rather than leaking a camelCase key or breaking the page.
 */
const AWARD_COPY: Record<string, { label: string; reason: string }> = {
  eventCompletion: {
    label: "Event completed",
    reason: "Finished every round of a Career event.",
  },
  eventTopFive: {
    label: "Top-five finish",
    reason: "Finished inside the top five of a Career event.",
  },
  eventWin: {
    label: "Event win",
    reason: "Won a Career event outright.",
  },
  activeSeasonCompletion: {
    label: "Season completed",
    reason: "Played a full Career season.",
  },
  promotion: {
    label: "Promotion",
    reason: "Earned a move up to the next tour.",
  },
  proSurvival: {
    label: "Pro Tour retained",
    reason: "Held a Pro Tour card through a completed season.",
  },
  seasonChampionship: {
    label: "Season championship",
    reason: "Finished the season top of the standings.",
  },
  championshipQualification: {
    label: "Championship qualification",
    reason: "Qualified for a Championship by completing a four-season cycle.",
  },
  championshipWin: {
    label: "Championship win",
    reason: "Won a Career Championship.",
  },
};

/** Split a camelCase award key into readable words, e.g. "someFutureAward". */
function humanizeAwardType(awardType: string): string {
  const words = awardType
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  if (!words) return "Legacy award";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function careerLegacyAwardCopy(awardType: string): { label: string; reason: string } {
  return AWARD_COPY[awardType] ?? {
    label: humanizeAwardType(awardType),
    reason: "Earned through Career play.",
  };
}

export interface CareerLegacyEntry {
  readonly id: string;
  readonly awardType: string;
  readonly label: string;
  readonly reason: string;
  readonly points: number;
  readonly runningTotal: number;
  readonly sourceType: string;
  readonly sourceId: string;
  /** Where it was earned, when it can be resolved — e.g. "Season 3 · Event 2". */
  readonly context: string | null;
  /** Immutable season ownership derived from the source relation, never dates. */
  readonly seasonNumber: number | null;
  readonly tier: CareerTier | null;
  readonly earnedAt: string;
}

export type CareerLegacyIndicator = "promotion" | "championship" | "trophy";

export interface CareerLegacyCategory {
  readonly awardType: string;
  readonly label: string;
  readonly reason: string;
  readonly count: number;
  readonly points: number;
}

export interface CareerLegacySeason {
  readonly seasonNumber: number;
  readonly tier: CareerTier;
  readonly points: number;
  readonly entryCount: number;
  readonly indicators: readonly CareerLegacyIndicator[];
  readonly categories: readonly CareerLegacyCategory[];
}

export interface CareerLegacyTrophySource {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly seasonNumber: number | null;
  readonly tier: CareerTier | null;
}

export interface CareerLegacyView {
  readonly profileId: string;
  /** The projection stored on the profile and shown on the dashboard. */
  readonly legacyTotal: number;
  /** The sum of every ledger row. Equal to `legacyTotal` when consistent. */
  readonly ledgerTotal: number;
  readonly reconciles: boolean;
  /** Sum of the season summaries. Equal to the ledger when every source resolves. */
  readonly groupedTotal: number;
  readonly groupingReconciles: boolean;
  readonly title: CareerLegacyTitle;
  /** Primary presentation: one summary per immutable Career season. */
  readonly seasons: readonly CareerLegacySeason[];
  /** Retained for reconciliation/backward compatibility, not the primary UI. */
  readonly entries: readonly CareerLegacyEntry[];
  /**
   * Non-empty only when stored data breaks a locked Career rule — today, a
   * negative award, which cannot happen by design. Surfaced, never hidden.
   */
  readonly invariantViolations: readonly string[];
}

const LEGACY_INDICATOR_ORDER: readonly CareerLegacyIndicator[] = [
  "promotion",
  "championship",
  "trophy",
];

const LEGACY_CATEGORY_ORDER = [
  "eventCompletion",
  "eventTopFive",
  "eventWin",
  "activeSeasonCompletion",
  "promotion",
  "proSurvival",
  "seasonChampionship",
  "championshipQualification",
  "championshipWin",
] as const;

/**
 * Fold immutable ledger rows into season summaries. Every entry is counted
 * exactly once. Source-to-season resolution happens before this pure step, so
 * rows that cannot be assigned are deliberately excluded rather than blended
 * into an ambiguous "Career" bucket.
 */
export function groupCareerLegacyBySeason(
  entries: readonly CareerLegacyEntry[],
  trophies: readonly CareerLegacyTrophySource[] = [],
): CareerLegacySeason[] {
  interface MutableSeason {
    seasonNumber: number;
    tier: CareerTier;
    points: number;
    entryCount: number;
    indicators: Set<CareerLegacyIndicator>;
    categories: Map<string, CareerLegacyCategory>;
  }

  const seasons = new Map<number, MutableSeason>();
  const ensureSeason = (
    seasonNumber: number,
    tier: CareerTier,
  ): MutableSeason => {
    const existing = seasons.get(seasonNumber);
    if (existing) return existing;
    const created: MutableSeason = {
      seasonNumber,
      tier,
      points: 0,
      entryCount: 0,
      indicators: new Set(),
      categories: new Map(),
    };
    seasons.set(seasonNumber, created);
    return created;
  };

  for (const entry of entries) {
    if (entry.seasonNumber == null || entry.tier == null) continue;
    const season = ensureSeason(entry.seasonNumber, entry.tier);
    season.points += entry.points;
    season.entryCount++;
    const category = season.categories.get(entry.awardType);
    season.categories.set(entry.awardType, {
      awardType: entry.awardType,
      label: entry.label,
      reason: entry.reason,
      count: (category?.count ?? 0) + 1,
      points: (category?.points ?? 0) + entry.points,
    });
    if (entry.awardType === "promotion") season.indicators.add("promotion");
    if (
      entry.sourceType === "championship"
      || entry.awardType === "championshipQualification"
      || entry.awardType === "championshipWin"
    ) {
      season.indicators.add("championship");
    }
  }

  for (const trophy of trophies) {
    if (trophy.seasonNumber == null || trophy.tier == null) continue;
    ensureSeason(trophy.seasonNumber, trophy.tier).indicators.add("trophy");
  }

  const orderOf = (awardType: string): number => {
    const index = LEGACY_CATEGORY_ORDER.indexOf(
      awardType as typeof LEGACY_CATEGORY_ORDER[number],
    );
    return index < 0 ? LEGACY_CATEGORY_ORDER.length : index;
  };

  return [...seasons.values()]
    .sort((left, right) => right.seasonNumber - left.seasonNumber)
    .map((season) => ({
      seasonNumber: season.seasonNumber,
      tier: season.tier,
      points: season.points,
      entryCount: season.entryCount,
      indicators: LEGACY_INDICATOR_ORDER.filter((indicator) =>
        season.indicators.has(indicator)),
      categories: [...season.categories.values()].sort(
        (left, right) =>
          orderOf(left.awardType) - orderOf(right.awardType)
          || left.label.localeCompare(right.label),
      ),
    }));
}

/**
 * Assemble the caller's own Legacy ledger. Returns null when the caller has no
 * Career profile. Performs no writes of any kind.
 */
export async function careerLegacyForUser(
  db: PrismaClient,
  userId: string,
  profileId?: string | null,
): Promise<CareerLegacyView | null> {
  const profile = await db.careerProfile.findFirst({
    where: profileId
      ? { id: profileId, userId }
      : { userId, status: "ACTIVE" },
    orderBy: [{ careerNumber: "desc" }, { id: "desc" }],
    select: { id: true, legacyTotal: true },
  });
  if (!profile) return null;

  const rows = await db.careerLegacyLedger.findMany({
    where: { profileId: profile.id },
    // Deterministic: createdAt can tie inside one settlement transaction, so the
    // id breaks the tie and the same ledger always reads back in the same order.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      awardType: true,
      points: true,
      sourceType: true,
      sourceId: true,
      createdAt: true,
    },
  });

  const trophyRows = await db.careerTrophy.findMany({
    where: { profileId: profile.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      sourceType: true,
      sourceId: true,
    },
  });
  const context = await resolveLegacyContexts(db, profile.id, [
    ...rows,
    ...trophyRows,
  ]);
  let runningTotal = 0;
  const entries = rows.map((row) => {
    runningTotal += row.points;
    const copy = careerLegacyAwardCopy(row.awardType);
    const resolved = context.get(`${row.sourceType}:${row.sourceId}`);
    return {
      id: row.id,
      awardType: row.awardType,
      label: copy.label,
      reason: copy.reason,
      points: row.points,
      runningTotal,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      context: resolved?.label ?? null,
      seasonNumber: resolved?.seasonNumber ?? null,
      tier: resolved?.tier ?? null,
      earnedAt: row.createdAt.toISOString(),
    };
  });

  const invariantViolations = rows
    .filter((row) => row.points < 0)
    .map((row) => `Legacy row ${row.id} (${row.awardType}) stores ${row.points} points; Legacy never decreases.`);
  for (const entry of entries) {
    if (entry.seasonNumber == null || entry.tier == null) {
      invariantViolations.push(
        `Legacy row ${entry.id} (${entry.awardType}) cannot be assigned to one Career season.`,
      );
    }
  }

  const trophySources: CareerLegacyTrophySource[] = trophyRows.map((trophy) => {
    const resolved = context.get(`${trophy.sourceType}:${trophy.sourceId}`);
    return {
      sourceType: trophy.sourceType,
      sourceId: trophy.sourceId,
      seasonNumber: resolved?.seasonNumber ?? null,
      tier: resolved?.tier ?? null,
    };
  });
  const seasons = groupCareerLegacyBySeason(entries, trophySources);
  const groupedTotal = seasons.reduce((sum, season) => sum + season.points, 0);

  return {
    profileId: profile.id,
    legacyTotal: profile.legacyTotal,
    ledgerTotal: runningTotal,
    reconciles: runningTotal === profile.legacyTotal,
    groupedTotal,
    groupingReconciles: groupedTotal === runningTotal,
    title: careerLegacyTitle(profile.legacyTotal),
    seasons,
    entries,
    invariantViolations,
  };
}

/** Resolve "where did this happen" labels for the ledger's source references. */
async function resolveLegacyContexts(
  db: PrismaClient,
  profileId: string,
  rows: readonly { sourceType: string; sourceId: string }[],
): Promise<Map<string, {
  label: string;
  seasonNumber: number;
  tier: CareerTier;
}>> {
  const byType = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = byType.get(row.sourceType) ?? new Set<string>();
    ids.add(row.sourceId);
    byType.set(row.sourceType, ids);
  }
  const context = new Map<string, {
    label: string;
    seasonNumber: number;
    tier: CareerTier;
  }>();

  const eventIds = [...(byType.get("event") ?? [])];
  if (eventIds.length > 0) {
    const events = await db.careerCompetition.findMany({
      where: { id: { in: eventIds } },
      select: {
        id: true,
        eventNumber: true,
        course: { select: { name: true } },
        cohort: { select: { seasonNumber: true, tier: true } },
      },
    });
    for (const event of events) {
      if (!event.cohort) continue;
      const parts = [
        `Season ${event.cohort.seasonNumber}`,
        event.eventNumber ? `Event ${event.eventNumber}` : null,
        event.course.name,
      ].filter(Boolean);
      context.set(`event:${event.id}`, {
        label: parts.join(" · "),
        seasonNumber: event.cohort.seasonNumber,
        tier: event.cohort.tier,
      });
    }
  }

  const seasonIds = [...(byType.get("season") ?? [])];
  if (seasonIds.length > 0) {
    const cohorts = await db.careerCohort.findMany({
      where: { id: { in: seasonIds } },
      select: { id: true, seasonNumber: true, tier: true },
    });
    for (const cohort of cohorts) {
      context.set(`season:${cohort.id}`, {
        label: `Season ${cohort.seasonNumber} · ${cohort.tier.charAt(0)}${cohort.tier.slice(1).toLowerCase()} Tour`,
        seasonNumber: cohort.seasonNumber,
        tier: cohort.tier,
      });
    }
  }

  const championshipIds = [...(byType.get("championship") ?? [])];
  if (championshipIds.length > 0) {
    const championships = await db.careerChampionship.findMany({
      where: { id: { in: championshipIds } },
      select: { id: true, cycleNumber: true },
    });
    const championshipSeasons = [...new Set(championships.map(
      (championship) =>
        championship.cycleNumber * CAREER_SEASONS_PER_CYCLE,
    ))];
    const histories = await db.careerSeasonHistory.findMany({
      where: {
        profileId,
        seasonNumber: { in: championshipSeasons },
      },
      select: { seasonNumber: true, tier: true },
    });
    const tierBySeason = new Map(histories.map((history) => [
      history.seasonNumber,
      history.tier,
    ]));
    for (const championship of championships) {
      const seasonNumber =
        championship.cycleNumber * CAREER_SEASONS_PER_CYCLE;
      const tier = tierBySeason.get(seasonNumber);
      if (!tier) continue;
      context.set(`championship:${championship.id}`, {
        label: `Season ${seasonNumber} · Championship Cycle ${championship.cycleNumber}`,
        seasonNumber,
        tier,
      });
    }
  }

  return context;
}
