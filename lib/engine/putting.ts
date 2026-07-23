/**
 * The GREEN + PUTTING + SHORT-GAME layer — the "make putting real" stage.
 *
 * The old model resolved a hole in two clicks (tee -> outcome). Now the
 * approach lands you in a POSITION on (or around) the green, and a third,
 * distinct decision — a putt or a scramble — composes into the final Outcome.
 *
 *   approach  ->  GreenResult  ->  Putt / Short-game  ->  Outcome
 *
 * Design rules (match probabilities.ts philosophy):
 *   - All tuning numbers live HERE, centralized and difficulty-aware.
 *   - We never replace scoring: stage results COMPOSE into the existing
 *     Outcome enum so the scorecard / share grid / leaderboard are untouched.
 *   - "Variance is the enemy of skill expression" — putting adds texture
 *     (clutch one-putts, the occasional three-jack) without slot-machine noise.
 *
 * Stroke model (composeOutcome): we track a relative-to-par delta, not raw
 * strokes. Reaching the green region is "regulation" (delta 0) for par 3/4 and
 * for a par-5 layup; a par-5 played aggressively at the green is "reached in
 * two" (offset -1), which is the only path to an eagle.
 */

import { holeDifficulty, type HoleSpec, type Conditions } from "./resolveHole";
import type { Decision, Outcome } from "./probabilities";
import type { RNG } from "./rng";
import type { Lie } from "./shots";

/** Where the approach left you. The on-green three (kickin/makeable/lag) lead
 * to a putt; scramble means you missed and must get up & down. */
export type GreenResult = "kickin" | "makeable" | "lag" | "scramble";

/** Result of a putt from the green. */
export type PuttResult = "oneputt" | "twoputt" | "threeputt";

/** Result of a short-game shot from off the green. */
export type ScrambleResult = "updown" | "twochip" | "blowup" | "disaster";

/** The approach can come from a tee-shot lie, or be the par-3 tee shot itself. */
export type GreenSource = Lie | "tee";

/** Putt distance buckets, derived from the GreenResult. */
export type PuttBucket = "tap" | "short" | "long";

export type GreenSpeed = "Slow" | "Medium" | "Firm" | "Fast";

export const GREEN_META: Record<
  GreenResult,
  { label: string; note: string; tone: "good" | "even" | "bad"; bucket: PuttBucket }
> = {
  kickin: { label: "Kick-in", note: "Stuffed it — gimme range.", tone: "good", bucket: "tap" },
  makeable: { label: "Birdie look", note: "On the dance floor with a real chance.", tone: "good", bucket: "short" },
  lag: { label: "Long putt", note: "On in reg, but a long way home.", tone: "even", bucket: "long" },
  scramble: { label: "Missed the green", note: "Short-game test — get it up and down.", tone: "bad", bucket: "tap" },
};

export const PUTT_META: Record<PuttResult, { label: string }> = {
  oneputt: { label: "One-putt" },
  twoputt: { label: "Two-putt" },
  threeputt: { label: "Three-putt" },
};

// Labels describe the SHOT (strokes taken), never the score-vs-par — a score
// word here would mislabel a par-5 reached in two (twochip = par, not bogey),
// the same blind spot as the narration. "Chip & two-putt" stays true on any par.
export const SCRAMBLE_META: Record<ScrambleResult, { label: string }> = {
  updown: { label: "Up & down" },
  twochip: { label: "Chip & two-putt" },
  blowup: { label: "Blow-up" },
  disaster: { label: "Disaster" },
};

const GREEN_RESULTS: GreenResult[] = ["kickin", "makeable", "lag", "scramble"];
const PUTT_RESULTS: PuttResult[] = ["oneputt", "twoputt", "threeputt"];
const SCRAMBLE_RESULTS: ScrambleResult[] = ["updown", "twochip", "blowup", "disaster"];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// 1. APPROACH -> GreenResult
// ---------------------------------------------------------------------------

/**
 * Neutral (difficulty 0) GreenResult odds, keyed by where you're hitting FROM
 * and how aggressively you play the approach. "tee" is the par-3 tee shot,
 * which finally lets par 3s play unlike par 4s.
 */
const GREEN_BASE: Record<GreenSource, Record<Decision, Partial<Record<GreenResult, number>>>> = {
  dialed: {
    safe: { kickin: 20, makeable: 46, lag: 29, scramble: 5 },
    normal: { kickin: 32, makeable: 44, lag: 18, scramble: 6 },
    aggressive: { kickin: 46, makeable: 35, lag: 10, scramble: 9 },
  },
  fairway: {
    safe: { kickin: 8, makeable: 34, lag: 44, scramble: 14 },
    normal: { kickin: 14, makeable: 40, lag: 32, scramble: 14 },
    aggressive: { kickin: 25, makeable: 38, lag: 17, scramble: 20 },
  },
  rough: {
    safe: { kickin: 3, makeable: 16, lag: 45, scramble: 36 },
    normal: { kickin: 5, makeable: 23, lag: 38, scramble: 34 },
    aggressive: { kickin: 11, makeable: 27, lag: 22, scramble: 40 },
  },
  trouble: {
    safe: { kickin: 1, makeable: 5, lag: 23, scramble: 71 },
    normal: { kickin: 1, makeable: 9, lag: 24, scramble: 66 },
    aggressive: { kickin: 4, makeable: 14, lag: 20, scramble: 62 },
  },
  // Par-3 tee shot. Aggressive flies at the pin: more kick-ins AND more misses.
  tee: {
    safe: { kickin: 6, makeable: 28, lag: 47, scramble: 19 },
    normal: { kickin: 11, makeable: 35, lag: 33, scramble: 21 },
    aggressive: { kickin: 21, makeable: 34, lag: 15, scramble: 30 },
  },
};

const fillGreen = (w: Partial<Record<GreenResult, number>>): Record<GreenResult, number> => {
  const out = {} as Record<GreenResult, number>;
  for (const g of GREEN_RESULTS) out[g] = w[g] ?? 0;
  return out;
};

/** How difficulty bends the GreenResult odds toward missing the green. */
export const GREEN_DIFFICULTY = {
  kickinDecay: 0.6,
  makeableDecay: 0.35,
  lagGrowth: 0.3,
  scrambleGrowth: 0.7,
  aggressiveScrambleGrowth: 1.2,
};

/**
 * Par-5 "wedge third" lean. A laid-up / normally-played par 5 wedges its third
 * shot into the green, so it sets up a better birdie look than a par-4 mid-iron.
 * Applied ONLY to the non-aggressive par-5 path in greenWeights() — the go-for-it
 * (aggressive) approach is the separate reached-in-two -> eagle route and is
 * untouched. Multipliers bias toward birdie looks (more kickin/makeable, less
 * lag, slightly fewer missed greens). Tune here; pick() normalizes proportions.
 */
export const PAR5_LAYUP_LEAN = {
  kickin: 1.5,
  makeable: 1.25,
  lag: 0.55,
  scramble: 0.9,
};

/**
 * A go-for-green second on a par 5 is a much longer shot than a standard par-4
 * approach. Before this adjustment it inherited identical proximity and made
 * 13% of smart-player par 5s eagles. Keep the reward, but trade tap-ins for
 * long putts and greenside misses so reaching in two is not an automatic score.
 */
export const PAR5_GO_FOR_GREEN_LEAN = {
  kickin: 0.25,
  makeable: 0.62,
  lag: 1.5,
  scramble: 1.4,
};

/** Difficulty-adjusted GreenResult odds for an approach decision. */
export function greenWeights(
  source: GreenSource,
  decision: Decision,
  hole: HoleSpec,
  c: Conditions
): Record<GreenResult, number> {
  const d = holeDifficulty(hole, c);
  const aggressive = decision === "aggressive" ? 1 : 0;
  const w = fillGreen(GREEN_BASE[source][decision]);
  const G = GREEN_DIFFICULTY;
  w.kickin *= 1 - G.kickinDecay * d;
  w.makeable *= 1 - G.makeableDecay * d;
  w.lag *= 1 + G.lagGrowth * d;
  w.scramble *= 1 + (G.scrambleGrowth + G.aggressiveScrambleGrowth * aggressive) * d;
  // Par-5 wedge-third lean: laid-up / normally-played par 5s set up better
  // birdie looks than a par-4 approach. Non-aggressive par-5 path only; the
  // aggressive go-for-it (reached-in-two -> eagle) route is left untouched.
  if (hole.par === 5 && decision !== "aggressive") {
    const L = PAR5_LAYUP_LEAN;
    w.kickin *= L.kickin;
    w.makeable *= L.makeable;
    w.lag *= L.lag;
    w.scramble *= L.scramble;
  } else if (hole.par === 5 && decision === "aggressive" && (source === "dialed" || source === "fairway")) {
    const L = PAR5_GO_FOR_GREEN_LEAN;
    w.kickin *= L.kickin;
    w.makeable *= L.makeable;
    w.lag *= L.lag;
    w.scramble *= L.scramble;
  }
  return w;
}

// ---------------------------------------------------------------------------
// 2. PUTTING -> PuttResult  (on the green: makeable / lag; kickin auto-resolves)
// ---------------------------------------------------------------------------

/** Putt decisions map onto the shared Decision vocab (Lag/Roll it/Charge) so
 * the API stays uniform — but they're NEVER charged to the aggressive budget
 * (see shots.ts: only tee/approach decisions count). */
export const PUTT_DECISION_LABEL: Record<Decision, string> = {
  safe: "Lag",
  normal: "Roll it",
  aggressive: "Charge",
};

/**
 * Neutral putt odds by distance bucket and decision. Charge raises BOTH the
 * make rate and the three-putt rate; Lag protects against the three-jack.
 */
const PUTT_BASE: Record<Exclude<PuttBucket, "tap">, Record<Decision, Partial<Record<PuttResult, number>>>> = {
  short: {
    safe: { oneputt: 16, twoputt: 82, threeputt: 2 },
    normal: { oneputt: 27, twoputt: 70, threeputt: 3 },
    aggressive: { oneputt: 37, twoputt: 55, threeputt: 8 },
  },
  long: {
    // Lag/Roll three-putt weights tightened so conservative actually protects
    // against the three-jack: Lag ~11.6% course-weighted (~13% Fast, which
    // should still punish), Roll eased a touch (16->13) to keep the Lag<Roll<
    // Charge ordering smooth. safe=9 keeps calibration off the band ceiling.
    // Charge unchanged — that's the risk you opt into.
    safe: { oneputt: 4, twoputt: 83, threeputt: 9 },
    normal: { oneputt: 7, twoputt: 77, threeputt: 13 },
    aggressive: { oneputt: 12, twoputt: 60, threeputt: 28 },
  },
};

/**
 * Green-speed modifier. Faster greens raise the make rate a touch AND the
 * three-jack rate more — that's the readable variance, kept modest so it never
 * swamps the decision.
 */
export const GREEN_SPEED_MOD: Record<GreenSpeed, { make: number; three: number }> = {
  Slow: { make: 0.85, three: 0.8 },
  Medium: { make: 1.0, three: 1.0 },
  Firm: { make: 1.1, three: 1.2 },
  Fast: { make: 1.2, three: 1.45 },
};

const fillPutt = (w: Partial<Record<PuttResult, number>>): Record<PuttResult, number> => {
  const out = {} as Record<PuttResult, number>;
  for (const p of PUTT_RESULTS) out[p] = w[p] ?? 0;
  return out;
};

const PUTT_DISTANCE_MODEL = {
  short: { min: 6, max: 18, midpoint: 12, makeSlope: 0.07, threeSlope: 0.04 },
  long: { min: 25, max: 45, midpoint: 35, makeSlope: 0.045, threeSlope: 0.035 },
} as const;

/** Exact-distance adjustment around each bucket's midpoint. Because generated
 * distances are uniform and these curves are linear around the midpoint, the
 * average raw make/three-putt weights stay at the calibrated bucket baseline. */
export function puttDistanceModifiers(
  bucket: Exclude<PuttBucket, "tap">,
  distanceFt: number
): { make: number; three: number } {
  const model = PUTT_DISTANCE_MODEL[bucket];
  const ft = Math.max(model.min, Math.min(model.max, distanceFt));
  const delta = ft - model.midpoint;
  return {
    make: 1 - delta * model.makeSlope,
    three: 1 + delta * model.threeSlope,
  };
}

/** Putt odds for an exact distance + decision, modulated by green speed. */
export function puttWeights(
  bucket: Exclude<PuttBucket, "tap">,
  decision: Decision,
  speed: GreenSpeed,
  distanceFt: number
): Record<PuttResult, number> {
  const w = fillPutt(PUTT_BASE[bucket][decision]);
  const speedMod = GREEN_SPEED_MOD[speed];
  const distanceMod = puttDistanceModifiers(bucket, distanceFt);
  w.oneputt *= speedMod.make * distanceMod.make;
  w.threeputt *= speedMod.three * distanceMod.three;
  return w;
}

// ---------------------------------------------------------------------------
// 3. SHORT GAME -> ScrambleResult  (off the green)
// ---------------------------------------------------------------------------

export const SHORT_DECISION_LABEL: Record<Decision, string> = {
  safe: "Punch",
  normal: "Chip",
  aggressive: "Flop",
};

/**
 * Neutral short-game odds by decision. Punch is the bogey-protector; Flop
 * chases the save but blows up more often.
 *
 * Punch (safe) is deliberately the LOW-VARIANCE choice, and a genuinely rewarded
 * one — same "safe play should be rewarded" principle we applied to putting (Lag)
 * and approaches. The Jul 2026 score-shape audit found that 23.6% of all
 * scramble finishes became double-or-worse, the dominant source of the game's
 * high-score tail. These bases move routine misses back toward bogey while
 * preserving the choice: Punch has the smallest blow-up share, Chip is balanced,
 * and Flop still makes the most par-saves but carries the most double+ risk.
 */
const SCRAMBLE_BASE: Record<Decision, Partial<Record<ScrambleResult, number>>> = {
  safe: { updown: 34, twochip: 61, blowup: 4, disaster: 1 },
  normal: { updown: 40, twochip: 48, blowup: 10, disaster: 2 },
  aggressive: { updown: 48, twochip: 35, blowup: 14, disaster: 3 },
};

export const SCRAMBLE_DIFFICULTY = {
  updownDecay: 0.45,
  twochipGrowth: 0.2,
  blowupGrowth: 0.7,
  disasterGrowth: 1.0,
  aggressiveBlowupGrowth: 0.8,
};

const fillScramble = (w: Partial<Record<ScrambleResult, number>>): Record<ScrambleResult, number> => {
  const out = {} as Record<ScrambleResult, number>;
  for (const s of SCRAMBLE_RESULTS) out[s] = w[s] ?? 0;
  return out;
};

/** Difficulty-adjusted short-game odds. */
export function scrambleWeights(
  decision: Decision,
  hole: HoleSpec,
  c: Conditions
): Record<ScrambleResult, number> {
  const d = holeDifficulty(hole, c);
  const aggressive = decision === "aggressive" ? 1 : 0;
  const w = fillScramble(SCRAMBLE_BASE[decision]);
  const S = SCRAMBLE_DIFFICULTY;
  w.updown *= 1 - S.updownDecay * d;
  w.twochip *= 1 + S.twochipGrowth * d;
  w.blowup *= 1 + (S.blowupGrowth + S.aggressiveBlowupGrowth * aggressive) * d;
  w.disaster *= 1 + S.disasterGrowth * d;
  return w;
}

// ---------------------------------------------------------------------------
// 4. COMPOSE -> Outcome
// ---------------------------------------------------------------------------

const PUTT_DELTA: Record<PuttResult, number> = { oneputt: -1, twoputt: 0, threeputt: 1 };
const SCRAMBLE_DELTA: Record<ScrambleResult, number> = { updown: 0, twochip: 1, blowup: 2, disaster: 3 };
const DELTA_TO_OUTCOME: Record<number, Outcome> = {
  [-2]: "eagle",
  [-1]: "birdie",
  [0]: "par",
  [1]: "bogey",
  [2]: "double",
  [3]: "triple",
};

/**
 * Compose the stage results into the final Outcome.
 *
 * `reachedInTwo` (par-5 played aggressively at the green) applies a -1 offset:
 * the only route to eagle, and it shifts every result one notch better.
 */
export function composeOutcome(
  reachedInTwo: boolean,
  finish:
    | { kind: "putt"; result: PuttResult }
    | { kind: "scramble"; result: ScrambleResult }
): Outcome {
  const offset = reachedInTwo ? -1 : 0;
  const base = finish.kind === "putt" ? PUTT_DELTA[finish.result] : SCRAMBLE_DELTA[finish.result];
  const delta = clamp(offset + base, -2, 3);
  return DELTA_TO_OUTCOME[delta];
}

export { GREEN_RESULTS, PUTT_RESULTS, SCRAMBLE_RESULTS };
