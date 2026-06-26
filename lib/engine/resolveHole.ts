/**
 * The hole simulation engine — server-authoritative.
 *
 * resolveHole() is a pure function: given a decision, the hole, the course
 * conditions, and an RNG, it returns a single outcome. Run it on the server
 * with a seeded RNG (see holeSeed) so results are reproducible and tamper-proof.
 */

import {
  BASE_WEIGHTS,
  DIFFICULTY_SCALING as S,
  DIFFICULTY_WEIGHTS as W,
  OUTCOME_META,
  SCORE_DELTA,
  type Decision,
  type Outcome,
} from "./probabilities";
import { mulberry32, holeSeed, type RNG } from "./rng";

export interface HoleSpec {
  number: number; // 1..18
  par: number;
  strokeIndex: number; // 1 = hardest, 18 = easiest
  // Note: yardage is display-only (see CourseHole) and intentionally NOT part
  // of the difficulty model — don't add it here without recalibrating.
}

export interface Conditions {
  difficulty: number; // 1..10 course rating
  wind: number; // mph
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Combine hole + course + wind into a single 0..1 difficulty scalar. */
export function holeDifficulty(hole: HoleSpec, c: Conditions): number {
  const holeD = 1 - (hole.strokeIndex - 1) / 17; // SI 1 -> 1.0
  const courseD = (c.difficulty - 5) / 5; // ~ -0.8 .. +0.8
  const windD = (c.wind - 10) / 40;
  const par3 = hole.par === 3 ? W.par3Bonus : 0;
  return clamp(W.hole * holeD + W.course * courseD + W.wind * windD + par3, 0, 1);
}

/** Difficulty-adjusted outcome weights for a decision on a given hole. */
export function buildWeights(
  decision: Decision,
  d: number
): Record<Outcome, number> {
  const w = { ...BASE_WEIGHTS[decision] };
  const aggressive = decision === "aggressive" ? 1 : 0;

  w.eagle *= 1 - (S.eagleDecay + S.aggressiveEagleDecay * aggressive) * d;
  w.birdie *= 1 - (S.birdieDecay + S.aggressiveBirdieDecay * aggressive) * d;
  w.par *= 1 - S.parDecay * d;
  w.bogey *= 1 + S.bogeyGrowth * d;
  w.double *= 1 + (S.doubleGrowth + S.aggressiveDoubleGrowth * aggressive) * d;
  w.triple =
    (w.triple + S.tripleBase) *
    (1 + (S.tripleGrowth + S.aggressiveTripleGrowth * aggressive) * d);

  return w;
}

function weightedPick(w: Record<Outcome, number>, rng: RNG): Outcome {
  const total = (Object.values(w) as number[]).reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const key of Object.keys(w) as Outcome[]) {
    r -= w[key];
    if (r <= 0) return key;
  }
  return "par";
}

export interface HoleResult {
  outcome: Outcome;
  label: string;
  emoji: string;
  scoreDelta: number; // relative to par
  strokes: number; // actual strokes on the hole
}

/** Resolve a single hole. Pass a seeded RNG on the server. */
export function resolveHole(
  decision: Decision,
  hole: HoleSpec,
  conditions: Conditions,
  rng: RNG
): HoleResult {
  const d = holeDifficulty(hole, conditions);
  const outcome = weightedPick(buildWeights(decision, d), rng);
  const delta = SCORE_DELTA[outcome];
  return {
    outcome,
    label: OUTCOME_META[outcome].label,
    emoji: OUTCOME_META[outcome].emoji,
    scoreDelta: delta,
    strokes: hole.par + delta,
  };
}

/** Convenience wrapper used by the API: deterministic per (round, hole). */
export function resolveHoleForRound(
  roundId: string,
  decision: Decision,
  hole: HoleSpec,
  conditions: Conditions
): HoleResult {
  const rng = mulberry32(holeSeed(roundId, hole.number));
  return resolveHole(decision, hole, conditions, rng);
}

/** Live odds shown on the choice buttons (no RNG — just the distribution). */
export function previewOdds(
  decision: Decision,
  hole: HoleSpec,
  conditions: Conditions
): { underPct: number; overPct: number } {
  const d = holeDifficulty(hole, conditions);
  const w = buildWeights(decision, d);
  const total = (Object.values(w) as number[]).reduce((a, b) => a + b, 0);
  const under = w.eagle + w.birdie;
  const over = w.bogey + w.double + w.triple;
  return {
    underPct: Math.round((under / total) * 100),
    overPct: Math.round((over / total) * 100),
  };
}
