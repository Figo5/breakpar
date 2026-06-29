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

/** Unplayed-hole marker — keeps the grid full-width if a round is short. */
const BLANK_SQUARE = "\u2B1B"; // ⬛

/**
 * Wordle-style share grid: exactly ONE square per hole, in hole order, front
 * nine then back nine. Indexed against a fixed `holeCount` (default 18) so a
 * round with missing holeResults can never silently shrink or shift the grid —
 * an absent hole renders as a visible blank instead of dropping a square.
 */
export function shareGrid(outcomes: Outcome[], holeCount = 18): string {
  const squares = Array.from({ length: holeCount }, (_, i) =>
    outcomes[i] ? OUTCOME_META[outcomes[i]].square : BLANK_SQUARE
  );
  return `${squares.slice(0, 9).join("")}\n${squares.slice(9).join("")}`;
}

/**
 * Minimum number of finished daily rounds before a percentile is meaningful.
 * Below this, a "Top X%" is statistical noise (one finisher = "Top 1%"?), so we
 * show a provisional rank instead of fabricating a percentage.
 */
export const PERCENTILE_MIN_FIELD = 30;

export type DailyStanding =
  | { kind: "percentile"; topPct: number; rank: number; field: number }
  | { kind: "rank"; rank: number; field: number };

/**
 * Your standing in today's REAL field of finished daily rounds.
 *
 * Lower score is better. `betterCount` = finishers strictly ahead of you;
 * `fieldSize` = total finishers today, including you.
 *
 * Tie convention: players who TIE your score do not count against you, so
 * "Top X%" is the share of the field strictly ahead of you:
 *
 *     topPct = round(betterCount / fieldSize * 100)        (clamped to 1..99)
 *
 * i.e. if you beat-or-tied 95% of the field, betterCount is ~5% of it → Top 5%.
 * A leader (betterCount = 0) clamps to "Top 1%" — never "Top 0%".
 *
 * Until the field reaches PERCENTILE_MIN_FIELD a percentage is meaningless, so
 * we return a provisional `rank` ("3rd of 14 so far today") instead of guessing.
 */
export function dailyStanding(betterCount: number, fieldSize: number): DailyStanding {
  const rank = betterCount + 1; // 1-based; players tied with you share this rank
  if (fieldSize < PERCENTILE_MIN_FIELD) return { kind: "rank", rank, field: fieldSize };
  const topPct = Math.max(1, Math.min(99, Math.round((betterCount / fieldSize) * 100)));
  return { kind: "percentile", topPct, rank, field: fieldSize };
}

/** "1st", "2nd", "3rd", "11th"… for the small-field rank fallback. */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * One-line label for the standing, shared by the result page and the share
 * text so they always show the SAME number. The "so far today" framing is
 * deliberate: early finishers' standings drift as more people play.
 *
 * We only brag with "Top X%" when it's actually flattering (topPct <= 50). A
 * high percentage ("Top 78%") reads as a worse-than-it-is humblebrag, so for
 * the bottom half we fall back to the neutral rank phrasing ("142nd of 240").
 */
export function standingLabel(s: DailyStanding): string {
  if (s.kind === "percentile" && s.topPct <= 50) return `Top ${s.topPct}% so far today`;
  return `${ordinal(s.rank)} of ${s.field} so far today`;
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
