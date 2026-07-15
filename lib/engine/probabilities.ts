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
  { label: string; square: string; tone: "good" | "even" | "bad" }
> = {
  eagle: { label: "Eagle", square: "🟦", tone: "good" },
  birdie: { label: "Birdie", square: "🟩", tone: "good" },
  par: { label: "Par", square: "⬜", tone: "even" },
  bogey: { label: "Bogey", square: "🟨", tone: "bad" },
  double: { label: "Double Bogey", square: "🟧", tone: "bad" },
  triple: { label: "Triple+", square: "🟥", tone: "bad" },
};

/** How hole / course / conditions combine into a 0..1 difficulty scalar. */
export const DIFFICULTY_WEIGHTS = {
  hole: 0.46, // per-hole stroke index (1 = hardest)
  course: 0.3, // course difficulty rating
  wind: 0.13, // wind speed
  par3Bonus: 0.04, // par 3s play a touch harder for aggression
};
