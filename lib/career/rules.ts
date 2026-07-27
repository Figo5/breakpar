/**
 * Pure Career Mode meta-game rules.
 *
 * Simulator-only in this phase: no database, clock, API, or UI dependencies.
 * These functions are the executable form of Design Doc v5's mechanical
 * baseline and are intentionally reusable by a later production design.
 */

export type CareerTier = "local" | "challenger" | "pro";

export const CAREER_TIERS: CareerTier[] = ["local", "challenger", "pro"];
export const BASELINE_MOVEMENT_RATE = 0.2;
export const ACTIVE_EVENT_MIN = 3;

export const BASELINE_TIER_MULTIPLIER: Record<CareerTier, number> = {
  local: 1,
  challenger: 1.5,
  pro: 2.25,
};

export const LEGACY_AWARD_KEYS = [
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

export type LegacyAwardKey = typeof LEGACY_AWARD_KEYS[number];
export type LegacyAwardCounts = Record<LegacyAwardKey, number>;
export type LegacyPointSchedule = Record<LegacyAwardKey, number>;

export function blankLegacyAwardCounts(): LegacyAwardCounts {
  return {
    eventCompletion: 0,
    eventTopFive: 0,
    eventWin: 0,
    activeSeasonCompletion: 0,
    promotion: 0,
    proSurvival: 0,
    seasonChampionship: 0,
    championshipQualification: 0,
    championshipWin: 0,
  };
}

/** Legacy awards stack and are permanent. Negative inputs cannot remove points. */
export function legacyPointBreakdown(
  awards: LegacyAwardCounts,
  schedule: LegacyPointSchedule,
): Record<LegacyAwardKey, number> {
  return Object.fromEntries(
    LEGACY_AWARD_KEYS.map((key) => [
      key,
      Math.max(0, awards[key]) * Math.max(0, schedule[key]),
    ]),
  ) as Record<LegacyAwardKey, number>;
}

export function legacyPoints(
  awards: LegacyAwardCounts,
  schedule: LegacyPointSchedule,
): number {
  return Object.values(legacyPointBreakdown(awards, schedule))
    .reduce((total, value) => total + value, 0);
}

export interface EventCompetitor {
  competitorId: string;
  relativeToPar: number | null;
}

export interface EventStanding {
  competitorId: string;
  completed: boolean;
  relativeToPar: number | null;
  rank: number | null;
  points: number;
}

export function pointsForPosition(position: number, fieldSize: number): number {
  if (fieldSize <= 1) return position === 1 ? 100 : 0;
  return 100 * (fieldSize - position) / (fieldSize - 1);
}

/** Rank one event. Tied occupied positions receive their unrounded average. */
export function rankEvent(entries: EventCompetitor[]): EventStanding[] {
  const fieldSize = entries.length;
  const completed = entries
    .filter((entry): entry is EventCompetitor & { relativeToPar: number } => entry.relativeToPar != null)
    .sort((a, b) =>
      a.relativeToPar !== b.relativeToPar
        ? a.relativeToPar - b.relativeToPar
        : a.competitorId.localeCompare(b.competitorId)
    );

  const ranked = new Map<string, EventStanding>();
  let index = 0;
  while (index < completed.length) {
    let end = index + 1;
    while (end < completed.length && completed[end].relativeToPar === completed[index].relativeToPar) end++;
    const occupiedPoints = Array.from(
      { length: end - index },
      (_, offset) => pointsForPosition(index + offset + 1, fieldSize)
    );
    const points = occupiedPoints.reduce((sum, value) => sum + value, 0) / occupiedPoints.length;
    const rank = index + 1;
    for (let tied = index; tied < end; tied++) {
      const entry = completed[tied];
      ranked.set(entry.competitorId, {
        competitorId: entry.competitorId,
        completed: true,
        relativeToPar: entry.relativeToPar,
        rank,
        points,
      });
    }
    index = end;
  }

  return entries.map((entry) =>
    ranked.get(entry.competitorId) ?? {
      competitorId: entry.competitorId,
      completed: false,
      relativeToPar: null,
      rank: null,
      points: 0,
    }
  );
}

export interface SeasonEventResult extends EventStanding {
  eventIndex: number;
}

export interface SeasonCompetitor {
  competitorId: string;
  events: SeasonEventResult[];
  fallbackDraw: number;
}

export interface SeasonStanding {
  competitorId: string;
  active: boolean;
  completedEvents: number;
  seasonPoints: number;
  bestFinishes: [number, number, number];
  countingRelativeToPar: number;
  bestCountingRelativeToPar: number;
  fallbackDraw: number;
  countingEventIndexes: number[];
}

function countingEvents(events: SeasonEventResult[]): SeasonEventResult[] {
  return [...events]
    .sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;
      const ar = a.rank ?? Number.POSITIVE_INFINITY;
      const br = b.rank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      const as = a.relativeToPar ?? Number.POSITIVE_INFINITY;
      const bs = b.relativeToPar ?? Number.POSITIVE_INFINITY;
      if (as !== bs) return as - bs;
      return a.eventIndex - b.eventIndex;
    })
    .slice(0, 3);
}

export function summarizeSeason(entry: SeasonCompetitor): SeasonStanding {
  const counting = countingEvents(entry.events);
  const completedEvents = entry.events.filter((event) => event.completed).length;
  const finishes = counting
    .map((event) => event.rank ?? Number.POSITIVE_INFINITY)
    .sort((a, b) => a - b);
  while (finishes.length < 3) finishes.push(Number.POSITIVE_INFINITY);
  const scores = counting.map((event) => event.relativeToPar ?? 0);
  return {
    competitorId: entry.competitorId,
    active: completedEvents >= ACTIVE_EVENT_MIN,
    completedEvents,
    seasonPoints: counting.reduce((sum, event) => sum + event.points, 0),
    bestFinishes: [finishes[0], finishes[1], finishes[2]],
    countingRelativeToPar: scores.reduce((sum, score) => sum + score, 0),
    bestCountingRelativeToPar: scores.length ? Math.min(...scores) : 0,
    fallbackDraw: entry.fallbackDraw,
    countingEventIndexes: counting.map((event) => event.eventIndex),
  };
}

/** The six performance criteria used before the display-only seeded draw. */
export function compareSeasonPerformance(a: SeasonStanding, b: SeasonStanding): number {
  if (a.seasonPoints !== b.seasonPoints) return b.seasonPoints - a.seasonPoints;
  for (let index = 0; index < 3; index++) {
    if (a.bestFinishes[index] !== b.bestFinishes[index]) return a.bestFinishes[index] - b.bestFinishes[index];
  }
  if (a.countingRelativeToPar !== b.countingRelativeToPar) {
    return a.countingRelativeToPar - b.countingRelativeToPar;
  }
  return a.bestCountingRelativeToPar - b.bestCountingRelativeToPar;
}

export function rankSeason(entries: SeasonCompetitor[]): SeasonStanding[] {
  return entries
    .map(summarizeSeason)
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const performance = compareSeasonPerformance(a, b);
      if (performance !== 0) return performance;
      if (a.fallbackDraw !== b.fallbackDraw) return a.fallbackDraw - b.fallbackDraw;
      return a.competitorId.localeCompare(b.competitorId);
    });
}

export function sameMovementPerformance(a: SeasonStanding, b: SeasonStanding): boolean {
  return compareSeasonPerformance(a, b) === 0;
}

export type MovementAction = "promote" | "hold" | "relegate" | "inactive";

export interface MovementResult {
  actions: Map<string, MovementAction>;
  activeCount: number;
  baseSlots: number;
  promoted: number;
  relegated: number;
  promotionTieExpansion: number;
  relegationTieExpansion: number;
}

/** Symmetric movement among active competitors, extending exact boundary ties. */
export function movementForSeason(
  standings: SeasonStanding[],
  tier: CareerTier,
  movementRate = BASELINE_MOVEMENT_RATE
): MovementResult {
  const actions = new Map<string, MovementAction>();
  for (const standing of standings) actions.set(standing.competitorId, standing.active ? "hold" : "inactive");
  const active = standings.filter((standing) => standing.active);
  if (active.length === 0) {
    return {
      actions,
      activeCount: 0,
      baseSlots: 0,
      promoted: 0,
      relegated: 0,
      promotionTieExpansion: 0,
      relegationTieExpansion: 0,
    };
  }

  const baseSlots = Math.max(1, Math.floor(active.length * movementRate));
  let promoted = 0;
  let relegated = 0;

  if (tier !== "pro") {
    const boundary = active[Math.min(baseSlots, active.length) - 1];
    for (const standing of active) {
      if (promoted < baseSlots || sameMovementPerformance(standing, boundary)) {
        actions.set(standing.competitorId, "promote");
        promoted++;
      } else {
        break;
      }
    }
  }

  if (tier !== "local") {
    const boundaryIndex = Math.max(0, active.length - baseSlots);
    const boundary = active[boundaryIndex];
    for (let index = active.length - 1; index >= 0; index--) {
      const standing = active[index];
      if (relegated < baseSlots || sameMovementPerformance(standing, boundary)) {
        // Promotion and relegation cannot overlap in a sensible field. If a
        // tiny/tie-expanded field does overlap, promotion wins.
        if (actions.get(standing.competitorId) !== "promote") {
          actions.set(standing.competitorId, "relegate");
          relegated++;
        }
      } else {
        break;
      }
    }
  }

  return {
    actions,
    activeCount: active.length,
    baseSlots,
    promoted,
    relegated,
    promotionTieExpansion: Math.max(0, promoted - (tier === "pro" ? 0 : baseSlots)),
    relegationTieExpansion: Math.max(0, relegated - (tier === "local" ? 0 : baseSlots)),
  };
}

export function promoteTier(tier: CareerTier): CareerTier {
  if (tier === "local") return "challenger";
  return "pro";
}

export function relegateTier(tier: CareerTier): CareerTier {
  if (tier === "pro") return "challenger";
  return "local";
}

export interface InactivityResult {
  tier: CareerTier;
  consecutiveInactiveSeasons: number;
}

export function applyInactivity(
  tier: CareerTier,
  priorConsecutiveInactiveSeasons: number,
  active: boolean
): InactivityResult {
  if (active) return { tier, consecutiveInactiveSeasons: 0 };
  const consecutiveInactiveSeasons = priorConsecutiveInactiveSeasons + 1;
  // Inactivity alone never pushes a profile below Challenger. A player already
  // in Local remains there; only Pro can be inactivity-relegated.
  const nextTier = consecutiveInactiveSeasons >= 2 && tier === "pro" ? "challenger" : tier;
  return { tier: nextTier, consecutiveInactiveSeasons };
}

export interface RatingSeason {
  rating: number;
  active: boolean;
}

export function seasonRating(
  activeFieldSize: number,
  finalActiveRank: number,
  tier: CareerTier,
  multipliers: Record<CareerTier, number> = BASELINE_TIER_MULTIPLIER
): number {
  if (activeFieldSize <= 0 || finalActiveRank <= 0 || finalActiveRank > activeFieldSize) return 0;
  const percentile = activeFieldSize === 1
    ? 1
    : (activeFieldSize - finalActiveRank) / (activeFieldSize - 1);
  return 100 * percentile * multipliers[tier];
}

/** Last eight chronological regular seasons, best six ratings. */
export function tourRating(history: RatingSeason[]): number {
  return history
    .slice(-8)
    .map((season) => season.active ? season.rating : 0)
    .sort((a, b) => b - a)
    .slice(0, 6)
    .reduce((sum, rating) => sum + rating, 0);
}

export type ChampionshipSource =
  | "pro-top-six"
  | "pro-event-winner"
  | "pro-passdown"
  | "challenger-top-two"
  | "elite-bot";

export interface ChampionshipQualifier {
  competitorId: string;
  source: ChampionshipSource;
}

/** Build the fixed Championship field, passing duplicate Pro slots downward. */
export function championshipField(
  proStandings: string[],
  proEventWinners: string[],
  challengerStandings: string[],
  eliteBots: string[],
  fieldSize = 20
): ChampionshipQualifier[] {
  const qualifiers: ChampionshipQualifier[] = [];
  const seen = new Set<string>();
  const add = (competitorId: string | undefined, source: ChampionshipSource) => {
    if (!competitorId || seen.has(competitorId) || qualifiers.length >= fieldSize) return false;
    seen.add(competitorId);
    qualifiers.push({ competitorId, source });
    return true;
  };

  for (const competitorId of proStandings.slice(0, 6)) add(competitorId, "pro-top-six");
  let passdownIndex = 6;
  for (const winner of proEventWinners.slice(0, 4)) {
    if (!add(winner, "pro-event-winner")) {
      while (passdownIndex < proStandings.length) {
        const added = add(proStandings[passdownIndex], "pro-passdown");
        passdownIndex++;
        if (added) break;
      }
    }
  }
  for (const competitorId of challengerStandings.slice(0, 2)) add(competitorId, "challenger-top-two");
  for (const competitorId of eliteBots) add(competitorId, "elite-bot");
  return qualifiers;
}
