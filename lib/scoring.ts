/**
 * Pure scoring + streak helpers. No I/O — easy to unit test.
 */

import { OUTCOME_META, type Outcome } from "@/lib/engine/probabilities";

export const relativeToPar = (strokes: number, par: number) => strokes - par;

export const relativeLabel = (rel: number) =>
  rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`;

/** You "break par" by shooting strictly under the course's par. */
export const brokePar = (strokes: number, par: number) => strokes < par;

/**
 * A day-streak is only "alive" if the last played day is today or yesterday;
 * otherwise the run of consecutive days is already broken (Wordle behavior).
 * Pure so it can be unit-tested without a DB.
 */
export const isStreakAlive = (
  lastPlayedKey: string | null | undefined,
  todayKey: string,
  yesterdayKey: string
) => lastPlayedKey === todayKey || lastPlayedKey === yesterdayKey;

export interface RoundTally {
  birdiesOrBetter: number;
  pars: number;
  bogeysOrWorse: number;
}

export function tally(outcomes: Outcome[]): RoundTally {
  const t: RoundTally = { birdiesOrBetter: 0, pars: 0, bogeysOrWorse: 0 };
  for (const o of outcomes) {
    const tone = OUTCOME_META[o].tone;
    if (tone === "good") t.birdiesOrBetter++;
    else if (tone === "even") t.pars++;
    else t.bogeysOrWorse++;
  }
  return t;
}

/** Wordle-style share grid: front nine on one line, back nine on the next. */
export function shareGrid(outcomes: Outcome[]): string {
  const sq = (o: Outcome) => OUTCOME_META[o].square;
  const front = outcomes.slice(0, 9).map(sq).join("");
  const back = outcomes.slice(9, 18).map(sq).join("");
  return `${front}\n${back}`;
}

/**
 * Heuristic percentile used as a fallback before the day's field is large
 * enough for a meaningful empirical percentile (see percentileFromRank).
 */
export function estimatePercentile(strokes: number, par: number): number {
  const over = strokes - par;
  return Math.max(1, Math.min(96, Math.round(4 + over * 3.4)));
}

/** Minimum completed rounds before we trust the empirical percentile. */
export const PERCENTILE_MIN_SAMPLE = 20;

/**
 * "Top X%" from a real rank within the day's field. rank is 1-based (1 = best),
 * total is the number of completed rounds. Clamped to 1..99 so we never show
 * "Top 0%" or a demoralising "Top 100%".
 */
export function percentileFromRank(rank: number, total: number): number {
  if (total <= 0) return 50;
  return Math.max(1, Math.min(99, Math.round((rank / total) * 100)));
}

export interface StreakState {
  daysPlayed: number;
  currentStreak: number; // consecutive days played
  maxStreak: number; // longest day-streak ever
  underParStreak: number; // consecutive days under par
  bestScore: number; // best (lowest) relative-to-par score, comparable across courses
}

export function updateStreak(
  prev: StreakState | null,
  relativeToPar: number,
  playedConsecutively: boolean
): StreakState {
  const base: StreakState =
    prev ?? { daysPlayed: 0, currentStreak: 0, maxStreak: 0, underParStreak: 0, bestScore: 999 };
  const currentStreak = playedConsecutively ? base.currentStreak + 1 : 1;
  return {
    daysPlayed: base.daysPlayed + 1,
    currentStreak,
    maxStreak: Math.max(base.maxStreak, currentStreak),
    underParStreak: relativeToPar < 0 ? base.underParStreak + 1 : 0,
    bestScore: Math.min(base.bestScore, relativeToPar),
  };
}
