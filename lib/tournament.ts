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

/** The launch course for the first tournament. */
export const TOURNAMENT_COURSE_SLUG = "pebble-beach";

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
 * The schedule for the tournament week that STARTS on the Monday at or after
 * `now`. startsAt = that Monday 00:00 ET; cutAt = Friday 00:00 ET (end of
 * Thursday play); endsAt = the following Monday 00:00 ET (end of Sunday play).
 *
 * `nextMonday` returns the NEXT Monday strictly after now (a full week out if
 * today is Monday). For the FIRST tournament we want the upcoming Monday, which
 * before that Monday is exactly nextMonday(now).
 */
export function scheduleForUpcoming(now = new Date()): TournamentSchedule {
  const startsAt = nextMonday(now);
  return scheduleFromStart(startsAt);
}

/** Build the full schedule from a known start Monday (00:00 ET). */
export function scheduleFromStart(startsAt: Date): TournamentSchedule {
  // Civil Eastern date of the start Monday, then add days via easternMidnight
  // (which normalizes out-of-range day-of-month and stays DST-safe).
  const key = dateKey(startsAt);
  const [y, m, d] = key.split("-").map(Number);
  const cutAt = easternMidnight({ y, m, d: d + 4 }); // Fri 00:00 ET (end of Thu)
  const endsAt = easternMidnight({ y, m, d: d + 7 }); // next Mon 00:00 ET (end of Sun)
  return { weekKey: weekKeyFor(startsAt), startsAt, cutAt, endsAt };
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
