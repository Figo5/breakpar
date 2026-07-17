/**
 * Weekly Tournaments — core model + self-activating lifecycle.
 *
 * Design: one tournament per week, one course, 4 rounds, unlimited entry,
 * cumulative to-par, a mid-week cut (top 30% but at least 20 advance). Everyone
 * plays the SAME course from a per-round shared seed, so scores are comparable.
 * Accounts only.
 *
 * SELF-ACTIVATION: the tournament's phase is DERIVED from the clock (now vs.
 * startsAt / cutAt / endsAt), not from a scheduled deploy or cron. The code that
 * reads a tournament recomputes the phase and lazily refreshes the cached
 * `status` column + runs the one-time cut when the deadline has passed. So the
 * tournament goes live Monday, cuts Thursday, and settles Sunday on its own —
 * the same way the daily course rolls over by clock, never by a deploy.
 *
 * TESTABILITY: every phase/schedule/cut function takes an explicit `now` (or the
 * inputs) so the time-based transitions can be unit-tested without waiting for
 * real days. A PREVIEW override (env / account) lets the builder play the full
 * flow on the live site before the public start.
 */

import { nextMonday, easternMidnight, dateKey } from "@/lib/daily";

// --- config ----------------------------------------------------------------

/**
 * TOURNAMENT COURSE SELECTION
 * ---------------------------
 * Default: a deterministic ROTATION through a curated pool of "regular tour
 * stops", indexed by the tournament's week number — so each week is a different
 * course and the cycle is predictable (no random repeats).
 *
 * Override: `TOURNAMENT_COURSE_OVERRIDES` hand-picks a course for a specific
 * week ("major weeks"). An override always wins over the rotation, and the
 * rotation simply continues around it.
 *
 * The CROWN JEWELS (Augusta, St Andrews, Pinehurst, Royal Birkdale) are
 * deliberately kept OUT of the regular pool so they only ever appear when you
 * assign them to a major week — that's what makes them feel like an event.
 */

/** Regular weekly rotation. Deterministic order; loops when exhausted.
 * NOTE: pebble-beach is intentionally NOT here — it was the launch tournament
 * (week 1) and shouldn't come back around for a while. It's still available as
 * a hand-picked override whenever you want it. */
export const TOURNAMENT_COURSE_POOL: string[] = [
  "bethpage-black",
  "chambers-bay",
  "torrey-pines-south",
  "quail-hollow",
  "whistling-straits",
  "bandon-dunes",
  "kiawah-ocean",
  "oakmont",
  "arcadia-bluffs",
  "harbour-town",
  "royal-portrush-dunluce",
  "pacific-dunes",
  // Winged Foot is reserved by the W29 override below. Keeping an override in
  // the regular pool would make it appear twice within a full rotation cycle.
  "tpc-sawgrass",
  "shinnecock-hills",
  "cypress-point",
  "pine-valley",
  "cabot-links",
  "merion-east",
  "erin-hills",
  "aronimink",
  "doral-blue-monster",
  "paynes-valley",
  "the-country-club",
  "lacc-north",
  "national-golf-links",
  "muirfield",
  "royal-melbourne",
  "royal-dornoch",
  "carnoustie",
  "royal-troon",
  "whispering-pines",
  "camargo",
  "prairie-dunes",
  "seminole",
  "riviera",
  "muirfield-village",
  "tpc-potomac",
];

/**
 * Hand-picked courses for specific weeks (majors / special events). Key is the
 * ISO week key from `weekKeyFor` (e.g. "2026-W29"); value is a course slug.
 * An entry here overrides the rotation for that week.
 *
 * Reserved crown jewels — use these here, not in the pool:
 *   augusta-national · st-andrews-old · pinehurst-no2 · royal-birkdale
 *
 * Example:
 *   "2026-W29": "augusta-national",   // The Masters week
 *   "2026-W33": "st-andrews-old",     // The Open week
 */
export const TOURNAMENT_COURSE_OVERRIDES: Record<string, string> = {
  // Week 2 of tournaments — hand-picked. (Rotation would have given Chambers Bay;
  // pinned to Winged Foot West. Rotation resumes normally from W30.)
  "2026-W29": "winged-foot-west",
};

/** Fallback if a configured slug is ever missing from the roster. */
export const TOURNAMENT_FALLBACK_SLUG = "pebble-beach";

/**
 * The course slug for a given tournament week. Override wins; otherwise rotate
 * through the pool by the week's ordinal so consecutive weeks differ and the
 * sequence is stable/predictable. Pure — easy to unit test.
 */
export function tournamentCourseSlugFor(weekKey: string): string {
  const override = TOURNAMENT_COURSE_OVERRIDES[weekKey];
  if (override) return override;
  if (TOURNAMENT_COURSE_POOL.length === 0) return TOURNAMENT_FALLBACK_SLUG;
  // weekKey is "YYYY-Www" — build a monotonic ordinal from year + week so the
  // rotation advances by one each week and carries across a year boundary.
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekKey);
  if (!m) return TOURNAMENT_FALLBACK_SLUG;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const ordinal = year * 53 + week; // 53 = max ISO weeks; strictly increasing
  const idx = ((ordinal % TOURNAMENT_COURSE_POOL.length) + TOURNAMENT_COURSE_POOL.length) % TOURNAMENT_COURSE_POOL.length;
  return TOURNAMENT_COURSE_POOL[idx];
}

/** Cut rule: top X% advance, but never fewer than MIN. */
export const CUT_PERCENT = 30;
export const CUT_MIN = 20;

/** Rounds per tournament. Rounds 1-2 are the "cut window"; 3-4 the "final". */
export const TOURNAMENT_ROUNDS = 4;
export const PRE_CUT_ROUNDS = 2; // rounds counted toward the cut

export type TournamentPhase =
  | "upcoming" // before startsAt — teaser/countdown
  | "round1_2" // Mon 00:00 ET .. cutAt — rounds 1 & 2 open
  | "cut" // cutAt .. round3_4 opens (brief; cut is computed here)
  | "round3_4" // after the cut .. endsAt — rounds 3 & 4 open for those who advanced
  | "complete"; // after endsAt — final settled

// --- schedule (pure, testable) ---------------------------------------------

export interface TournamentSchedule {
  weekKey: string; // e.g. "2026-W28"
  startsAt: Date; // Mon 00:00 ET
  cutAt: Date; // Thu 24:00 ET == Fri 00:00 ET (end of Thursday)
  endsAt: Date; // Sun 24:00 ET == next Mon 00:00 ET (end of Sunday)
}

/**
 * ISO-week key ("YYYY-Www") for the Monday that starts the tournament week.
 * Uses the civil Eastern date of the Monday. Simple + stable for one-per-week.
 */
export function weekKeyFor(monday: Date): string {
  // Derive the Eastern civil date string of the Monday, then compute ISO week.
  const key = dateKey(monday); // "YYYY-MM-DD" Eastern civil date
  const [y, m, d] = key.split("-").map(Number);
  // ISO week number via the Thursday of this week (UTC math on the civil parts).
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = (dt.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  dt.setUTCDate(dt.getUTCDate() - day + 3); // move to Thursday
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((dt.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * The schedule for the tournament week currently in view.
 *
 * WEEK SHAPE (changed after the launch event): Monday is a RESULTS/REST day —
 * last week's champion is shown and this week's event teases with a countdown.
 * Play runs Tuesday–Sunday:
 *   startsAt = Tuesday 00:00 ET       (rounds 1-2 open)
 *   cutAt    = Friday 00:00 ET        (end of Thursday — cut computed)
 *   endsAt   = next Monday 00:00 ET   (end of Sunday — settle)
 *
 * "Upcoming" means the Tuesday of the CURRENT calendar week when we're at/after
 * this week's Monday but before its Tuesday (i.e. on results-day Monday we point
 * at TOMORROW, not a week out), and otherwise the Tuesday of next week. We derive
 * the Tuesday directly from the civil date rather than via nextMonday(), because
 * nextMonday() skips a full week when today is itself a Monday — which on a
 * results-day Monday would push the countdown out by a week.
 */
export function scheduleForUpcoming(now = new Date()): TournamentSchedule {
  return scheduleFromStart(upcomingTuesday(now));
}

/**
 * The Tuesday 00:00 ET that starts the upcoming tournament week.
 * - On Monday: today+1 (this week's Tuesday) — results-day points at tomorrow.
 * - Tue..Sun: next week's Tuesday (this week's event is already live/among us).
 */
function upcomingTuesday(now = new Date()): Date {
  const key = dateKey(now); // civil Eastern "YYYY-MM-DD"
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  // Days from today to the target Tuesday (2 = Tuesday's dow).
  // Monday(1) -> +1; Tuesday(2) -> +7 (next week); ... Sunday(0) -> +2.
  let delta = (2 - dow + 7) % 7;
  if (delta === 0) delta = 7; // on a Tuesday, aim at next Tuesday
  return easternMidnight({ y, m, d: d + delta });
}

/** Build the full schedule from a known start Tuesday (00:00 ET). */
export function scheduleFromStart(startsAt: Date): TournamentSchedule {
  // Civil Eastern date of the start Tuesday, then add days via easternMidnight
  // (which normalizes out-of-range day-of-month and stays DST-safe).
  const key = dateKey(startsAt);
  const [y, m, d] = key.split("-").map(Number);
  const cutAt = easternMidnight({ y, m, d: d + 3 }); // Fri 00:00 ET (end of Thu)
  const endsAt = easternMidnight({ y, m, d: d + 6 }); // next Mon 00:00 ET (end of Sun)
  // weekKey is keyed off the MONDAY of the week (start Tuesday minus one day) so
  // "2026-Wnn" overrides continue to line up with the calendar week.
  const mondayKey = easternMidnight({ y, m, d: d - 1 });
  return { weekKey: weekKeyFor(mondayKey), startsAt, cutAt, endsAt };
}

// --- phase derivation (pure, testable) -------------------------------------

/**
 * Derive the live phase from the clock. This is the self-activation core: given
 * the schedule and `now`, what state is the tournament in? No stored status is
 * trusted for correctness — it's recomputed here and only cached for cheap reads.
 */
export function phaseFor(sched: { startsAt: Date; cutAt: Date; endsAt: Date }, now = new Date()): TournamentPhase {
  const t = now.getTime();
  if (t < sched.startsAt.getTime()) return "upcoming";
  if (t < sched.cutAt.getTime()) return "round1_2";
  if (t < sched.endsAt.getTime()) return "round3_4";
  return "complete";
}

/** Which round numbers are playable in a given phase. */
export function playableRounds(phase: TournamentPhase): number[] {
  switch (phase) {
    case "round1_2":
      return [1, 2];
    case "round3_4":
      return [3, 4];
    default:
      return [];
  }
}

/** Is the cut due to be computed? (We're at/after the cut deadline and it hasn't run.) */
export function cutIsDue(
  sched: { cutAt: Date },
  cutComputedAt: Date | null,
  now = new Date()
): boolean {
  return now.getTime() >= sched.cutAt.getTime() && !cutComputedAt;
}

// --- cut computation (pure, testable) --------------------------------------

export interface CutCandidate {
  entryId: string;
  completedPreCutRounds: number; // how many of rounds 1..PRE_CUT_ROUNDS are done
  cumulativeToPar: number; // sum of completed pre-cut rounds' to-par
}

export interface CutOutcome {
  advance: Set<string>; // entryIds that made the cut
  withdraw: Set<string>; // entryIds withdrawn (didn't complete both pre-cut rounds)
}

/**
 * Compute the cut: entries that completed BOTH pre-cut rounds are ranked by
 * cumulative to-par (lower is better); the top `percent`% advance, but never
 * fewer than `min`. Entries missing a pre-cut round are withdrawn (unranked).
 * Ties at the cut line all advance (be generous at the boundary).
 */
export function computeCut(
  candidates: CutCandidate[],
  percent = CUT_PERCENT,
  min = CUT_MIN
): CutOutcome {
  const advance = new Set<string>();
  const withdraw = new Set<string>();

  const qualified: CutCandidate[] = [];
  for (const c of candidates) {
    if (c.completedPreCutRounds >= PRE_CUT_ROUNDS) qualified.push(c);
    else withdraw.add(c.entryId);
  }

  if (qualified.length === 0) return { advance, withdraw };

  qualified.sort((a, b) => a.cumulativeToPar - b.cumulativeToPar);

  // How many advance: max(min, ceil(percent% of the qualified field)), capped
  // at the field size.
  const byPercent = Math.ceil((percent / 100) * qualified.length);
  let cutSize = Math.min(qualified.length, Math.max(min, byPercent));

  // Extend through ties at the boundary score so equal scores share their fate.
  const boundaryScore = qualified[cutSize - 1].cumulativeToPar;
  while (cutSize < qualified.length && qualified[cutSize].cumulativeToPar === boundaryScore) {
    cutSize++;
  }

  for (let i = 0; i < cutSize; i++) advance.add(qualified[i].entryId);
  return { advance, withdraw };
}

// --- seed (shared per round) -----------------------------------------------

/** The shared RNG namespace for a tournament round — every player in the field
 * gets the identical seed for a given round, so the challenge is the same. */
export function tournamentSeedKey(tournamentId: string, roundNo: number): string {
  return `${tournamentId}:${roundNo}`;
}

/**
 * Pure: given sorted-ascending cumulative scores of players through the pre-cut
 * rounds, return the score at the cut position (top percent%, min N, capped at
 * field). Null for an empty field. The "cut line so far".
 */
export function cutlineScore(sortedScores: number[], percent = CUT_PERCENT, min = CUT_MIN): number | null {
  if (sortedScores.length === 0) return null;
  const byPercent = Math.ceil((percent / 100) * sortedScores.length);
  const cutSize = Math.min(sortedScores.length, Math.max(min, byPercent));
  return sortedScores[cutSize - 1]; // score of the last player who makes it
}
