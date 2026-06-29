/**
 * The hole simulation engine — server-authoritative.
 *
 * resolveHole() is a pure function: given a decision, the hole, the course
 * conditions, and an RNG, it returns a single outcome. Run it on the server
 * with a seeded RNG (see holeSeed) so results are reproducible and tamper-proof.
 */

import { DIFFICULTY_WEIGHTS as W } from "./probabilities";

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
