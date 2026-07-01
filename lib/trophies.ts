/**
 * Trophies — Stage B1: DERIVED from existing Round / HoleResult / Streak data.
 *
 * No table, so nothing can drift: a trophy is earned iff its predicate holds
 * over the player's completed rounds right now. Mirrors lib/hallOfFame.ts — the
 * pure helpers (`summarizeRounds`, `evaluateTrophies`) take plain rows/stats so
 * they're trivially unit-testable; only `getTrophies` touches the DB. Because
 * guest history lives on a durable User row that sign-in adopts, a guest's
 * trophies carry over on sign-up for free.
 *
 * Break-par thresholds are RELATIVE TO PAR (a round's to-par), so they're fair
 * across par 70/71/72 courses. "Birdies" counts birdies-or-better (an eagle is
 * better than a birdie), matching lib/scoring tally().
 *
 * Unlock timestamps + the "just earned it" moment are Stage B2 (needs a
 * migration) — NOT here. B1 is derive + display only.
 */

// Pure + client-safe: NO prisma / next/headers imports here, so this module can
// be pulled into a client component (HallTabs) for its types + metadata. The DB
// fetch (getTrophies) lives in lib/trophies.server.ts.

export type TrophyTier = "common" | "rare" | "elite" | "legendary";
export type TrophyCategory = "breaking-par" | "scoring" | "dedication" | "conquer" | "competition";

/** Aggregates every trophy predicate reads. Fully derived, cheap. */
export interface TrophyStats {
  roundsPlayed: number;
  brokePar: boolean; // any completed round under par
  bestUnderPar: number; // strokes under par of the best round (>=0; 0 if never under)
  subParCourses: number; // distinct courses with a sub-par round
  playedCourses: number; // distinct courses played
  coursesTotal: number;
  hasBirdie: boolean; // a birdie-or-better hole exists
  hasEagle: boolean;
  maxStreak: number; // longest day-streak ever reached (survives a miss)
  maxBirdiesInRound: number; // most birdies-or-better in a single round
  bestHolesAtOrUnderPar: number; // most holes at-or-under par in one round (18 = bogey-free)
}

/** A catalogue trophy. `measure` is pure; `comingSoon` trophies have none. */
export interface Trophy {
  id: string;
  label: string;
  category: TrophyCategory;
  tier: TrophyTier;
  criteria: string; // shown on the locked/goal tile
  comingSoon?: boolean;
  measure?: (s: TrophyStats) => { current: number; target: number };
}

/** Flattened, SERIALIZABLE result for one trophy (safe to cross to the client). */
export interface TrophyState {
  id: string;
  label: string;
  category: TrophyCategory;
  tier: TrophyTier;
  criteria: string;
  comingSoon: boolean;
  earned: boolean;
  current: number;
  target: number;
  progressPct: number; // 0..100
  unlockedAt?: string | null; // ISO when known (genuine unlock); null/undefined = date unknown
}

export interface TrophyBoard {
  signedIn: boolean;
  earnedCount: number;
  totalCount: number; // active (non-coming-soon) trophies
  tierTally: Record<TrophyTier, number>; // earned counts by tier
  states: TrophyState[];
  featured: string[]; // the owner's pinned trophy ids (ordered), for the picker
}

export const CATEGORY_META: Record<TrophyCategory, { label: string; emoji: string }> = {
  "breaking-par": { label: "Breaking Par", emoji: "🏌️" },
  scoring: { label: "Scoring Feats", emoji: "⛳" },
  dedication: { label: "Dedication", emoji: "🔥" },
  conquer: { label: "Conquer", emoji: "🏆" },
  competition: { label: "Competition", emoji: "🥇" },
};

export const CATEGORY_ORDER: TrophyCategory[] = [
  "breaking-par",
  "scoring",
  "dedication",
  "conquer",
  "competition",
];

export const TIER_META: Record<TrophyTier, { label: string; rank: number }> = {
  common: { label: "Common", rank: 0 },
  rare: { label: "Rare", rank: 1 },
  elite: { label: "Elite", rank: 2 },
  legendary: { label: "Legendary", rank: 3 },
};

/** The catalogue. Predicates only read TrophyStats — all derived, no I/O. */
export const TROPHIES: Trophy[] = [
  // 🏌️ Breaking Par
  { id: "broke-par", label: "Broke Par", category: "breaking-par", tier: "common",
    criteria: "Shoot under par in any round", measure: (s) => ({ current: s.brokePar ? 1 : 0, target: 1 }) },
  { id: "round-3", label: "−3 Round", category: "breaking-par", tier: "common",
    criteria: "Finish a round 3-under par", measure: (s) => ({ current: s.bestUnderPar, target: 3 }) },
  { id: "round-5", label: "−5 Round", category: "breaking-par", tier: "rare",
    criteria: "Finish a round 5-under par", measure: (s) => ({ current: s.bestUnderPar, target: 5 }) },
  { id: "round-8", label: "−8 Round", category: "breaking-par", tier: "elite",
    criteria: "Finish a round 8-under par", measure: (s) => ({ current: s.bestUnderPar, target: 8 }) },
  { id: "round-12", label: "−12 Round", category: "breaking-par", tier: "legendary",
    criteria: "Finish a round 12-under par", measure: (s) => ({ current: s.bestUnderPar, target: 12 }) },

  // ⛳ Scoring Feats
  { id: "first-birdie", label: "First Birdie", category: "scoring", tier: "common",
    criteria: "Make a birdie", measure: (s) => ({ current: s.hasBirdie ? 1 : 0, target: 1 }) },
  { id: "first-eagle", label: "First Eagle", category: "scoring", tier: "rare",
    criteria: "Make an eagle", measure: (s) => ({ current: s.hasEagle ? 1 : 0, target: 1 }) },
  { id: "bogey-free", label: "Bogey-Free Round", category: "scoring", tier: "rare",
    criteria: "Play all 18 holes at par or better", measure: (s) => ({ current: s.bestHolesAtOrUnderPar, target: 18 }) },
  { id: "birdies-3", label: "3 Birdies in a Round", category: "scoring", tier: "common",
    criteria: "Make 3+ birdies in one round", measure: (s) => ({ current: s.maxBirdiesInRound, target: 3 }) },
  { id: "birdies-5", label: "5 Birdies in a Round", category: "scoring", tier: "elite",
    criteria: "Make 5+ birdies in one round", measure: (s) => ({ current: s.maxBirdiesInRound, target: 5 }) },

  // 🔥 Dedication
  { id: "streak-7", label: "Week Streak", category: "dedication", tier: "rare",
    criteria: "Play 7 days in a row", measure: (s) => ({ current: s.maxStreak, target: 7 }) },
  { id: "streak-30", label: "Month Streak", category: "dedication", tier: "elite",
    criteria: "Play 30 days in a row", measure: (s) => ({ current: s.maxStreak, target: 30 }) },
  { id: "streak-100", label: "Century Streak", category: "dedication", tier: "legendary",
    criteria: "Play 100 days in a row", measure: (s) => ({ current: s.maxStreak, target: 100 }) },
  { id: "rounds-10", label: "10 Rounds", category: "dedication", tier: "common",
    criteria: "Play 10 rounds", measure: (s) => ({ current: s.roundsPlayed, target: 10 }) },
  { id: "rounds-50", label: "50 Rounds", category: "dedication", tier: "rare",
    criteria: "Play 50 rounds", measure: (s) => ({ current: s.roundsPlayed, target: 50 }) },
  { id: "rounds-100", label: "100 Rounds", category: "dedication", tier: "elite",
    criteria: "Play 100 rounds", measure: (s) => ({ current: s.roundsPlayed, target: 100 }) },
  { id: "played-all", label: "Toured Them All", category: "dedication", tier: "rare",
    criteria: "Play every course at least once", measure: (s) => ({ current: s.playedCourses, target: s.coursesTotal }) },

  // 🏆 Conquer (break par on N courses)
  { id: "conquer-5", label: "Break Par on 5 Courses", category: "conquer", tier: "rare",
    criteria: "Break par on 5 different courses", measure: (s) => ({ current: s.subParCourses, target: 5 }) },
  { id: "conquer-10", label: "Break Par on 10 Courses", category: "conquer", tier: "elite",
    criteria: "Break par on 10 different courses", measure: (s) => ({ current: s.subParCourses, target: 10 }) },
  { id: "conquer-all", label: "Break Par Everywhere", category: "conquer", tier: "legendary",
    criteria: "Break par on every course", measure: (s) => ({ current: s.subParCourses, target: s.coursesTotal }) },

  // 🥇 Competition — coming soon (teased in-app; no triggers wired in B1)
  { id: "comp-cut", label: "Make the Cut", category: "competition", tier: "rare",
    criteria: "Unlocks with tournaments", comingSoon: true },
  { id: "comp-podium", label: "Podium Finish", category: "competition", tier: "elite",
    criteria: "Unlocks with tournaments", comingSoon: true },
  { id: "comp-win", label: "Win a Weekly", category: "competition", tier: "legendary",
    criteria: "Unlocks with tournaments", comingSoon: true },
];

const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** Pure: evaluate the whole catalogue against derived stats. */
export function evaluateTrophies(stats: TrophyStats): TrophyState[] {
  return TROPHIES.map((t) => {
    if (t.comingSoon || !t.measure) {
      return {
        id: t.id, label: t.label, category: t.category, tier: t.tier, criteria: t.criteria,
        comingSoon: true, earned: false, current: 0, target: 1, progressPct: 0,
      };
    }
    const { current, target } = t.measure(stats);
    const earned = target > 0 && current >= target;
    return {
      id: t.id, label: t.label, category: t.category, tier: t.tier, criteria: t.criteria,
      comingSoon: false, earned, current, target,
      progressPct: earned ? 100 : clampPct((current / target) * 100),
    };
  });
}

/** A completed round reduced to just what the predicates need. */
export interface RoundLite {
  relativeToPar: number;
  courseKey: string; // any stable per-course id (courseId or slug)
  holes: { outcome: string; scoreChange: number }[];
}

/** Pure: fold completed rounds (+ maxStreak) into TrophyStats. */
export function summarizeRounds(rows: RoundLite[], coursesTotal: number, maxStreak: number): TrophyStats {
  let bestUnderPar = 0;
  let maxBirdiesInRound = 0;
  let bestHolesAtOrUnderPar = 0;
  let hasBirdie = false;
  let hasEagle = false;
  const played = new Set<string>();
  const subPar = new Set<string>();

  for (const r of rows) {
    played.add(r.courseKey);
    if (r.relativeToPar < 0) subPar.add(r.courseKey);
    bestUnderPar = Math.max(bestUnderPar, -r.relativeToPar);

    let birdies = 0;
    let atOrUnder = 0;
    for (const h of r.holes) {
      const good = h.outcome === "birdie" || h.outcome === "eagle";
      if (good) birdies++;
      if (h.outcome === "eagle") hasEagle = true;
      if (good) hasBirdie = true;
      if (h.scoreChange <= 0) atOrUnder++;
    }
    maxBirdiesInRound = Math.max(maxBirdiesInRound, birdies);
    bestHolesAtOrUnderPar = Math.max(bestHolesAtOrUnderPar, atOrUnder);
  }

  return {
    roundsPlayed: rows.length,
    brokePar: subPar.size > 0 || bestUnderPar > 0,
    bestUnderPar,
    subParCourses: subPar.size,
    playedCourses: played.size,
    coursesTotal,
    hasBirdie,
    hasEagle,
    maxStreak,
    maxBirdiesInRound,
    bestHolesAtOrUnderPar,
  };
}

/**
 * Pure: newly-unlocked trophies = earned in `after` but not in `before`. Drives
 * the result-screen celebration; empty when nothing changed (e.g. a replayed
 * finish, or an existing player whose history already had them all).
 */
export function newlyUnlocked(before: TrophyState[], after: TrophyState[]): TrophyState[] {
  const had = new Set(before.filter((s) => s.earned).map((s) => s.id));
  return after.filter((s) => s.earned && !had.has(s.id));
}

/** Pure: build the TrophyBoard from derived stats + auth flag. `awardDates` maps
 * trophyId -> ISO unlock time (or null when backfilled/unknown); dates show only
 * when truthful. */
export function buildTrophyBoard(
  stats: TrophyStats,
  signedIn: boolean,
  awardDates?: Map<string, string | null>,
  featured: string[] = []
): TrophyBoard {
  const states = evaluateTrophies(stats).map((s) =>
    s.earned && awardDates?.has(s.id) ? { ...s, unlockedAt: awardDates.get(s.id) ?? null } : s
  );
  const active = states.filter((s) => !s.comingSoon);
  const tierTally: Record<TrophyTier, number> = { common: 0, rare: 0, elite: 0, legendary: 0 };
  for (const s of states) if (s.earned) tierTally[s.tier]++;
  return {
    signedIn,
    earnedCount: active.filter((s) => s.earned).length,
    totalCount: active.length,
    tierTally,
    states,
    featured,
  };
}
