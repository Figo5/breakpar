/**
 * Multi-shot hole simulation — the decision-tree depth layer.
 *
 * Each hole is now played as TWO sequential, server-authoritative shots:
 *   1. Tee shot  -> resolves to a LIE (dialed / fairway / rough / trouble)
 *   2. Scoring shot -> the player SEES the lie, then chooses again, resolving
 *      to a final outcome (eagle..triple).
 *
 * That second decision is the whole point: after a wild drive into trouble you
 * choose to punch out (salvage bogey) or go for the hero recovery (birdie or
 * blow-up). Risk management with information — real skill, not one dice roll.
 *
 * Still deterministic: each shot is seeded by (server secret, round, hole, shot)
 * so it can't be re-rolled, and the server replays the decision list to resolve.
 */

import { holeDifficulty, type HoleSpec, type Conditions } from "./resolveHole";
import { SCORE_DELTA, type Decision, type Outcome } from "./probabilities";
import { mulberry32, type RNG } from "./rng";

export const SHOTS_PER_HOLE = 2;

export type Lie = "dialed" | "fairway" | "rough" | "trouble";

export const LIE_META: Record<Lie, { label: string; emoji: string; note: string; tone: "good" | "even" | "bad" }> = {
  dialed: { label: "Dialed in", emoji: "🎯", note: "Perfect position — attack.", tone: "good" },
  fairway: { label: "In the fairway", emoji: "⛳", note: "Clean look at the green.", tone: "good" },
  rough: { label: "In the rough", emoji: "🌿", note: "Awkward — pick your spot.", tone: "even" },
  trouble: { label: "In trouble", emoji: "🌋", note: "Scrambling — punch out or gamble?", tone: "bad" },
};

const LIES: Lie[] = ["dialed", "fairway", "rough", "trouble"];
const OUTCOMES: Outcome[] = ["eagle", "birdie", "par", "bogey", "double", "triple"];

/** Tee-shot lie distribution on a neutral hole (difficulty 0). */
const TEE_BASE: Record<Decision, Record<Lie, number>> = {
  safe: { dialed: 8, fairway: 64, rough: 25, trouble: 3 },
  normal: { dialed: 22, fairway: 50, rough: 23, trouble: 5 },
  aggressive: { dialed: 44, fairway: 31, rough: 16, trouble: 9 },
};

/** Scoring-shot outcome distribution given the lie, on a neutral hole. */
const SCORE_BASE: Record<Lie, Record<Decision, Partial<Record<Outcome, number>>>> = {
  dialed: {
    safe: { birdie: 35, par: 60, bogey: 5 },
    normal: { eagle: 5, birdie: 57, par: 35, bogey: 3 },
    aggressive: { eagle: 15, birdie: 58, par: 21, bogey: 4, double: 2 },
  },
  fairway: {
    safe: { birdie: 9, par: 77, bogey: 13, double: 1 },
    normal: { birdie: 25, par: 59, bogey: 14, double: 2 },
    aggressive: { eagle: 3, birdie: 43, par: 37, bogey: 12, double: 4, triple: 1 },
  },
  rough: {
    safe: { par: 54, bogey: 43, double: 3 },
    normal: { birdie: 11, par: 51, bogey: 33, double: 5 },
    aggressive: { birdie: 24, par: 33, bogey: 30, double: 10, triple: 3 },
  },
  trouble: {
    safe: { par: 17, bogey: 63, double: 18, triple: 2 },
    normal: { par: 11, bogey: 49, double: 32, triple: 8 },
    aggressive: { birdie: 9, par: 18, bogey: 29, double: 30, triple: 14 },
  },
};

const fill = (w: Partial<Record<Outcome, number>>): Record<Outcome, number> => {
  const out = {} as Record<Outcome, number>;
  for (const o of OUTCOMES) out[o] = w[o] ?? 0;
  return out;
};

/** Difficulty-adjusted lie odds for a tee decision. */
export function teeWeights(decision: Decision, hole: HoleSpec, c: Conditions): Record<Lie, number> {
  const d = holeDifficulty(hole, c);
  const aggressive = decision === "aggressive" ? 1 : 0;
  const w = { ...TEE_BASE[decision] };
  w.dialed *= 1 - 0.55 * d;
  w.fairway *= 1 - 0.12 * d;
  w.rough *= 1 + 0.45 * d;
  w.trouble *= 1 + (0.8 + 1.6 * aggressive) * d;
  return w;
}

/** Difficulty-adjusted outcome odds for a scoring decision from a given lie. */
export function scoreWeights(
  lie: Lie,
  decision: Decision,
  hole: HoleSpec,
  c: Conditions
): Record<Outcome, number> {
  const d = holeDifficulty(hole, c);
  const aggressive = decision === "aggressive" ? 1 : 0;
  const w = fill(SCORE_BASE[lie][decision]);
  w.eagle *= 1 - 0.6 * d;
  w.birdie *= 1 - 0.4 * d;
  w.par *= 1 - 0.05 * d;
  w.bogey *= 1 + (0.4 + 0.7 * aggressive) * d;
  w.double *= 1 + (0.8 + 1.4 * aggressive) * d;
  w.triple = (w.triple + 0.1) * (1 + (1.0 + 2.0 * aggressive) * d);
  return w;
}

function pick<T extends string>(w: Record<T, number>, rng: RNG): T {
  const keys = Object.keys(w) as T[];
  const total = keys.reduce((a, k) => a + w[k], 0);
  let r = rng() * total;
  for (const k of keys) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

export type ShotStep =
  | { complete: false; shot: number; lie: Lie }
  | { complete: true; lie: Lie; outcome: Outcome; scoreDelta: number; strokes: number };

/**
 * Resolve a hole from its decision list. `seedFor(shotIndex)` supplies the
 * per-shot RNG seed (server: secret+round+hole+shot; tests: any). Returns the
 * intermediate lie after the tee shot, or the final outcome once both shots
 * are in. Pure + deterministic.
 */
export function resolveHoleShots(
  decisions: Decision[],
  hole: HoleSpec,
  c: Conditions,
  seedFor: (shotIndex: number) => number
): ShotStep {
  const lie = pick(teeWeights(decisions[0], hole, c), mulberry32(seedFor(0)));
  if (decisions.length < SHOTS_PER_HOLE) return { complete: false, shot: 1, lie };

  const outcome = pick(scoreWeights(lie, decisions[1], hole, c), mulberry32(seedFor(1)));
  const scoreDelta = SCORE_DELTA[outcome];
  return { complete: true, lie, outcome, scoreDelta, strokes: hole.par + scoreDelta };
}

/** Label for the shot the player is about to hit. */
export function shotPrompt(par: number, shotIndex: number): string {
  if (shotIndex === 0) return "Tee shot — how do you play it?";
  return par === 3 ? "Putt — how do you read it?" : "Approach — how do you play it?";
}

export { LIES };
