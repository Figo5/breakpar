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

export type TrophyTier = "common" | "rare" | "elite" | "legendary" | "special";
export type TrophyCategory = "special" | "breaking-par" | "scoring" | "dedication" | "conquer" | "competition";

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
  totalBirdies: number; // lifetime birdies-or-better across all rounds
  totalEagles: number; // lifetime eagles-or-better across all rounds
  maxEaglesInRound: number; // most eagles-or-better in a single round
  maxConsecutiveSubPar: number; // longest run of consecutive sub-par rounds (chronological)
  hasHoleInOne: boolean; // ever holed a tee shot (a 1-stroke hole)
}

/** A catalogue trophy. `measure` is pure; `comingSoon` trophies have none. */
export interface Trophy {
  id: string;
  label: string;
  category: TrophyCategory;
  tier: TrophyTier;
  criteria: string; // shown on the locked/goal tile
  comingSoon?: boolean;
  // Special = manually AWARDED (role/event badge), never derived from play. It
  // has no measure(); "earned" comes solely from a TrophyAward row. Kept
  // visually + categorically distinct so it never reads as a played achievement.
  special?: boolean;
  // Counter = an ever-climbing career tally (birdies/eagles). Earned the moment
  // the count reaches 1, but the tile shows the live number instead of a
  // progress bar — there's no cap. `unit` is the small caption under the number.
  counter?: boolean;
  unit?: string;
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
  special: boolean;
  counter: boolean; // ever-climbing tally: show `current` as a live number, no bar
  unit?: string; // caption under a counter's number ("birdies made")
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

export const CATEGORY_META: Record<TrophyCategory, { label: string }> = {
  special: { label: "Special" },
  "breaking-par": { label: "Breaking Par" },
  scoring: { label: "Scoring Feats" },
  dedication: { label: "Dedication" },
  conquer: { label: "Conquer" },
  competition: { label: "Competition" },
};

export const CATEGORY_ORDER: TrophyCategory[] = [
  "special", // role/event badges lead the case
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
  special: { label: "Special", rank: 4 }, // not a rarity — an awarded role badge
};

/** The catalogue. Predicates only read TrophyStats — all derived, no I/O. */
export const TROPHIES: Trophy[] = [
  // ✦ Special — manually awarded role/event badges (see award-special.ts). No
  // measure(): earned solely via a TrophyAward row, never through play.
  { id: "creator", label: "Creator", category: "special", tier: "special", special: true,
    criteria: "Break Par's creator" },
  { id: "tournament-champion", label: "Tournament Champion", category: "special", tier: "special", special: true,
    criteria: "Won a weekly tournament" },

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
  { id: "round-15", label: "−15 Round", category: "breaking-par", tier: "legendary",
    criteria: "Finish a round 15-under par", measure: (s) => ({ current: s.bestUnderPar, target: 15 }) },
  { id: "subpar-streak-3", label: "On a Heater", category: "breaking-par", tier: "elite",
    criteria: "Break par in 3 rounds in a row", measure: (s) => ({ current: s.maxConsecutiveSubPar, target: 3 }) },

  // ⛳ Scoring Feats
  { id: "first-birdie", label: "First Birdie", category: "scoring", tier: "common",
    criteria: "Make a birdie", measure: (s) => ({ current: s.hasBirdie ? 1 : 0, target: 1 }) },
  { id: "first-eagle", label: "First Eagle", category: "scoring", tier: "rare",
    criteria: "Make an eagle", measure: (s) => ({ current: s.hasEagle ? 1 : 0, target: 1 }) },
  { id: "hole-in-one", label: "Hole in One", category: "scoring", tier: "legendary",
    criteria: "Ace a hole (a tee shot holed for 1)", measure: (s) => ({ current: s.hasHoleInOne ? 1 : 0, target: 1 }) },
  { id: "bogey-free", label: "Bogey-Free Round", category: "scoring", tier: "rare",
    criteria: "Play all 18 holes at par or better", measure: (s) => ({ current: s.bestHolesAtOrUnderPar, target: 18 }) },
  { id: "birdies-3", label: "3 Birdies in a Round", category: "scoring", tier: "common",
    criteria: "Make 3+ birdies in one round", measure: (s) => ({ current: s.maxBirdiesInRound, target: 3 }) },
  { id: "birdies-5", label: "5 Birdies in a Round", category: "scoring", tier: "elite",
    criteria: "Make 5+ birdies in one round", measure: (s) => ({ current: s.maxBirdiesInRound, target: 5 }) },
  { id: "birdies-7", label: "7 Birdies in a Round", category: "scoring", tier: "legendary",
    criteria: "Make 7+ birdies in one round", measure: (s) => ({ current: s.maxBirdiesInRound, target: 7 }) },
  { id: "eagle-double-round", label: "Two Eagles, One Round", category: "scoring", tier: "elite",
    criteria: "Make 2 eagles in a single round", measure: (s) => ({ current: s.maxEaglesInRound, target: 2 }) },
  // Counters: one badge each, earned on the first, then the number climbs forever.
  { id: "birdies-counter", label: "Birdies", category: "scoring", tier: "rare", counter: true, unit: "birdies made",
    criteria: "Make a birdie", measure: (s) => ({ current: s.totalBirdies, target: 1 }) },
  { id: "eagles-counter", label: "Eagles", category: "scoring", tier: "elite", counter: true, unit: "eagles made",
    criteria: "Make an eagle", measure: (s) => ({ current: s.totalEagles, target: 1 }) },

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
  { id: "rounds-250", label: "250 Rounds", category: "dedication", tier: "elite",
    criteria: "Play 250 rounds", measure: (s) => ({ current: s.roundsPlayed, target: 250 }) },
  { id: "rounds-500", label: "500 Rounds", category: "dedication", tier: "legendary",
    criteria: "Play 500 rounds", measure: (s) => ({ current: s.roundsPlayed, target: 500 }) },
  { id: "played-all", label: "Toured Them All", category: "dedication", tier: "rare",
    criteria: "Play every course at least once", measure: (s) => ({ current: s.playedCourses, target: s.coursesTotal }) },

  // 🏆 Conquer (break par on N courses)
  { id: "conquer-5", label: "Break Par on 5 Courses", category: "conquer", tier: "rare",
    criteria: "Break par on 5 different courses", measure: (s) => ({ current: s.subParCourses, target: 5 }) },
  { id: "conquer-10", label: "Break Par on 10 Courses", category: "conquer", tier: "elite",
    criteria: "Break par on 10 different courses", measure: (s) => ({ current: s.subParCourses, target: 10 }) },
  { id: "conquer-15", label: "Break Par on 15 Courses", category: "conquer", tier: "elite",
    criteria: "Break par on 15 different courses", measure: (s) => ({ current: s.subParCourses, target: 15 }) },
  { id: "conquer-25", label: "Break Par on 25 Courses", category: "conquer", tier: "legendary",
    criteria: "Break par on 25 different courses", measure: (s) => ({ current: s.subParCourses, target: 25 }) },
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
    const base = {
      id: t.id, label: t.label, category: t.category, tier: t.tier, criteria: t.criteria,
      counter: !!t.counter, unit: t.unit,
    };
    // Special: never auto-earned here. earned is set later from award rows in
    // buildTrophyBoard; the derived pass leaves it false with no progress.
    if (t.special) {
      return { ...base, comingSoon: false, special: true, earned: false, current: 0, target: 1, progressPct: 0 };
    }
    if (t.comingSoon || !t.measure) {
      return { ...base, comingSoon: true, special: false, earned: false, current: 0, target: 1, progressPct: 0 };
    }
    const { current, target } = t.measure(stats);
    const earned = target > 0 && current >= target;
    return {
      ...base, comingSoon: false, special: false, earned, current, target,
      progressPct: earned ? 100 : clampPct((current / target) * 100),
    };
  });
}

/** A completed round reduced to just what the predicates need. */
export interface RoundLite {
  relativeToPar: number;
  courseKey: string; // any stable per-course id (courseId or slug)
  // `par` is optional: only the hole-in-one predicate needs it (an ace is a
  // 1-stroke hole, i.e. par + scoreChange === 1). Callers that don't populate it
  // simply never award the ace — everything else is par-independent.
  holes: { outcome: string; scoreChange: number; par?: number }[];
  playedAt?: number; // epoch ms; only needed to order the consecutive-sub-par run
}

/** Pure: fold completed rounds (+ maxStreak) into TrophyStats. */
export function summarizeRounds(rows: RoundLite[], coursesTotal: number, maxStreak: number): TrophyStats {
  let bestUnderPar = 0;
  let maxBirdiesInRound = 0;
  let bestHolesAtOrUnderPar = 0;
  let hasBirdie = false;
  let hasEagle = false;
  let totalBirdies = 0;
  let totalEagles = 0;
  let maxEaglesInRound = 0;
  let hasHoleInOne = false;
  const played = new Set<string>();
  const subPar = new Set<string>();

  // The consecutive-sub-par run must be walked in play order. Sort a copy by
  // playedAt when the caller supplied it (server passes epoch ms); when it's
  // absent (unit tests / callers that don't care) the input order is preserved.
  const ordered = [...rows].sort((a, b) => (a.playedAt ?? 0) - (b.playedAt ?? 0));
  let subParRun = 0;
  let maxConsecutiveSubPar = 0;

  for (const r of ordered) {
    played.add(r.courseKey);
    const under = r.relativeToPar < 0;
    if (under) subPar.add(r.courseKey);
    bestUnderPar = Math.max(bestUnderPar, -r.relativeToPar);

    subParRun = under ? subParRun + 1 : 0;
    maxConsecutiveSubPar = Math.max(maxConsecutiveSubPar, subParRun);

    let birdies = 0;
    let eagles = 0;
    let atOrUnder = 0;
    for (const h of r.holes) {
      const good = h.outcome === "birdie" || h.outcome === "eagle" || h.outcome === "albatross";
      const eagleish = h.outcome === "eagle" || h.outcome === "albatross";
      if (good) birdies++;
      if (eagleish) eagles++;
      if (eagleish) hasEagle = true;
      if (good) hasBirdie = true;
      if (h.scoreChange <= 0) atOrUnder++;
      // A hole-in-one is a 1-stroke hole: par + scoreChange === 1. Needs par,
      // which only the server-fed rows carry (see RoundLite.holes.par).
      if (h.par != null && h.par + h.scoreChange === 1) hasHoleInOne = true;
    }
    totalBirdies += birdies;
    totalEagles += eagles;
    maxBirdiesInRound = Math.max(maxBirdiesInRound, birdies);
    maxEaglesInRound = Math.max(maxEaglesInRound, eagles);
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
    totalBirdies,
    totalEagles,
    maxEaglesInRound,
    hasHoleInOne,
    maxConsecutiveSubPar,
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

export const FEATURED_MAX = 5;

/**
 * Pure: validate a featured-trophies request. Dedupes (preserving order) and
 * requires every id to be a currently-earned trophy within the cap. Used by
 * PATCH /api/profile/featured so the server never trusts the client to send
 * only legit picks.
 */
export function validateFeatured(
  ids: string[],
  earned: Set<string>,
  max = FEATURED_MAX
): { ok: true; ids: string[] } | { ok: false; error: "too-many" | "not-earned" } {
  const deduped = [...new Set(ids)];
  if (deduped.length > max) return { ok: false, error: "too-many" };
  if (deduped.some((id) => !earned.has(id))) return { ok: false, error: "not-earned" };
  return { ok: true, ids: deduped };
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
  const states = evaluateTrophies(stats).map((s) => {
    // Special trophies are earned ONLY by having an award row (manually granted).
    if (s.special) {
      const awarded = awardDates?.has(s.id) ?? false;
      return { ...s, earned: awarded, unlockedAt: awarded ? awardDates!.get(s.id) ?? null : undefined };
    }
    return s.earned && awardDates?.has(s.id) ? { ...s, unlockedAt: awardDates.get(s.id) ?? null } : s;
  });
  // "X of Y earned" + rarity tally cover only PLAYABLE trophies — special/manual
  // badges can't be earned by play, so they're excluded to keep stats honest.
  const active = states.filter((s) => !s.comingSoon && !s.special);
  const tierTally: Record<TrophyTier, number> = { common: 0, rare: 0, elite: 0, legendary: 0, special: 0 };
  for (const s of active) if (s.earned) tierTally[s.tier]++;
  return {
    signedIn,
    earnedCount: active.filter((s) => s.earned).length,
    totalCount: active.length,
    tierTally,
    states,
    featured,
  };
}
