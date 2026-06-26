/**
 * Break Par — outcome probabilities & difficulty model.
 *
 * The target is to shoot UNDER the course's par. Calibrated via Monte Carlo
 * (40k rounds/strategy) for a fair-but-rewarding challenge:
 *   - Smart course management breaks par ~30% of the time (median ~+2).
 *   - Reckless "always aggressive" play breaks par a little less often and
 *     blows up far more — so picking your spots is the skill.
 *
 * These numbers are the product's difficulty dial. Change them here and
 * nowhere else; everything downstream reads from this file.
 */

export type Decision = "safe" | "normal" | "aggressive";

export type Outcome =
  | "eagle"
  | "birdie"
  | "par"
  | "bogey"
  | "double"
  | "triple";

/** Stroke change relative to par for each outcome. */
export const SCORE_DELTA: Record<Outcome, number> = {
  eagle: -2,
  birdie: -1,
  par: 0,
  bogey: 1,
  double: 2,
  triple: 3,
};

/** Display metadata used by the UI and the share grid. */
export const OUTCOME_META: Record<
  Outcome,
  { label: string; emoji: string; square: string; tone: "good" | "even" | "bad" }
> = {
  eagle: { label: "Eagle", emoji: "🦅", square: "🟦", tone: "good" },
  birdie: { label: "Birdie", emoji: "🐦", square: "🟩", tone: "good" },
  par: { label: "Par", emoji: "🏌️", square: "⬜", tone: "even" },
  bogey: { label: "Bogey", emoji: "😬", square: "🟨", tone: "bad" },
  double: { label: "Double Bogey", emoji: "💥", square: "🟧", tone: "bad" },
  triple: { label: "Triple+", emoji: "🌋", square: "🟥", tone: "bad" },
};

/** Base outcome weights per decision on a neutral (difficulty = 0) hole. */
export const BASE_WEIGHTS: Record<Decision, Record<Outcome, number>> = {
  safe: { eagle: 0, birdie: 11, par: 64, bogey: 23, double: 1.5, triple: 0.5 },
  normal: { eagle: 2, birdie: 26, par: 49, bogey: 20, double: 2.5, triple: 0.5 },
  aggressive: { eagle: 8, birdie: 40, par: 33, bogey: 13, double: 3, triple: 3 },
};

/** How hole / course / conditions combine into a 0..1 difficulty scalar. */
export const DIFFICULTY_WEIGHTS = {
  hole: 0.46, // per-hole stroke index (1 = hardest)
  course: 0.3, // course difficulty rating
  wind: 0.13, // wind speed
  par3Bonus: 0.04, // par 3s play a touch harder for aggression
};

/**
 * As difficulty rises we shift probability mass from good outcomes to bad.
 * Aggressive carries EXTRA downside scaling so attacking a hard hole is
 * genuinely punished — that gap is what rewards smart play.
 */
export const DIFFICULTY_SCALING = {
  eagleDecay: 0.6,
  birdieDecay: 0.42,
  parDecay: 0.08,
  bogeyGrowth: 0.5,
  doubleGrowth: 0.95,
  tripleGrowth: 1.35,
  tripleBase: 0.35, // floor so triples are always possible on hard holes
  // additional growth applied only when decision === "aggressive":
  aggressiveEagleDecay: 0.1,
  aggressiveBirdieDecay: 0.1,
  aggressiveDoubleGrowth: 2.6,
  aggressiveTripleGrowth: 4.2,
};
