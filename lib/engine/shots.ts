/**
 * Variable-length hole simulation — the decision-tree depth layer.
 *
 * A hole is now played as a CHAIN of server-authoritative stages, whose length
 * varies by par and by how it unfolds:
 *
 *   Par 4 / 5:  Tee -> Lie -> Approach -> GreenResult -> Putt/Scramble -> Outcome
 *   Par 3:      (tee = Approach) -> GreenResult -> Putt/Scramble -> Outcome
 *
 * Variable length is the whole point: a kick-in AUTO-RESOLVES (one fewer click),
 * a missed green ADDS a short-game decision. The rhythm stops being identical
 * every hole, and par 3s finally play unlike par 4s.
 *
 * Still deterministic: every stage and every event derives from a per-shot seed
 * (server: secret+round+hole+shot), so re-submitting the decision list
 * reproduces the identical chain, events, and narration — the anti-reroll core.
 *
 * Decisions are capped at MAX_DECISIONS (3) so a round stays ~1-3 min. Putt and
 * short-game decisions reuse the safe/normal/aggressive vocab but are NEVER
 * charged to the aggressive budget — only tee/approach decisions are (see
 * countTeeApproachAggressive). That keeps the budget a tee-to-green resource.
 */

import { holeDifficulty, type HoleSpec, type Conditions } from "./resolveHole";
import { SCORE_DELTA, type Decision, type Outcome } from "./probabilities";
import { mulberry32, type RNG } from "./rng";
import {
  greenWeights,
  puttWeights,
  scrambleWeights,
  composeOutcome,
  GREEN_META,
  type GreenResult,
  type GreenSource,
  type GreenSpeed,
  type PuttBucket,
  type PuttResult,
  type ScrambleResult,
} from "./putting";
import { rollEvent, applyEvent, type EventInstance } from "./events";
import { teeNote, approachNote, puttNote, scrambleNote, layupNote, layupApproachNote } from "./notes";

/** Hard cap on decisions per hole — keeps a round fast. */
export const MAX_DECISIONS = 3;

export type Lie = "dialed" | "fairway" | "rough" | "trouble";

export const LIE_META: Record<Lie, { label: string; emoji: string; note: string; tone: "good" | "even" | "bad" }> = {
  dialed: { label: "Dialed in", emoji: "🎯", note: "Perfect position — attack.", tone: "good" },
  fairway: { label: "In the fairway", emoji: "⛳", note: "Clean look at the green.", tone: "good" },
  rough: { label: "In the rough", emoji: "🌿", note: "Awkward — pick your spot.", tone: "even" },
  trouble: { label: "In trouble", emoji: "🌋", note: "Scrambling — punch out or gamble?", tone: "bad" },
};

const LIES: Lie[] = ["dialed", "fairway", "rough", "trouble"];

/** Tee-shot lie distribution on a neutral hole (difficulty 0). */
const TEE_BASE: Record<Decision, Record<Lie, number>> = {
  safe: { dialed: 8, fairway: 64, rough: 25, trouble: 3 },
  normal: { dialed: 22, fairway: 50, rough: 23, trouble: 5 },
  aggressive: { dialed: 44, fairway: 31, rough: 16, trouble: 9 },
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

// --- budget accounting (only tee/approach decisions count) -----------------

/** Number of tee+approach decisions for a hole (par 3 has no separate tee). */
export function approachDecisionCount(par: number): number {
  return par === 3 ? 1 : 2;
}

/** Count aggressive plays that count against the budget within a stored chain
 * ("safe,aggressive,normal"). Putt/short-game decisions (the trailing ones) are
 * excluded — the budget is a tee-to-green resource only. */
export function countTeeApproachAggressive(decisionCsv: string, par: number): number {
  const ds = decisionCsv.split(",").filter(Boolean);
  return ds.slice(0, approachDecisionCount(par)).filter((d) => d === "aggressive").length;
}

// --- putt geometry (distance + break), deterministic ----------------------

function distanceFor(bucket: PuttBucket, rng: RNG): number {
  if (bucket === "tap") return 1 + Math.floor(rng() * 3); // 1–3 ft
  if (bucket === "short") return 6 + Math.floor(rng() * 13); // 6–18 ft
  return 25 + Math.floor(rng() * 21); // 25–45 ft
}

export type BreakDir = "L" | "R" | "straight";
export type Slope = "uphill" | "downhill" | "flat";

function readBreak(rng: RNG): { breakDir: BreakDir; slope: Slope } {
  const breakDir = (["L", "R", "straight"] as const)[Math.floor(rng() * 3)];
  const slope = (["uphill", "downhill", "flat"] as const)[Math.floor(rng() * 3)];
  return { breakDir, slope };
}

// --- display-only yardage (DOES NOT touch the outcome stream) --------------
//
// Believable yards-to-target + tee distance, derived from hole yardage + the
// lie via an INDEPENDENT salted RNG (same proven pattern as the narration
// notes). It never draws from the pick() streams that resolve outcomes, and is
// only computed when opts.holeYards is supplied (the play route passes it;
// calibration does NOT, so break-par stays byte-identical). The numbers are
// consistent by construction: drive + remaining === holeYards.

const YARD_SALT = 0x5944; // independent stream salt ("YD")

/** Fraction of the hole a drive covers, by lie. Display-only. */
const DRIVE_FRACTION: Record<Lie, number> = { dialed: 0.66, fairway: 0.62, rough: 0.58, trouble: 0.5 };

/** Rough tee-shot distance (yards), rounded to 5, bounded so the remaining
 * approach stays sane. Pure; takes a salted RNG. */
export function driveYards(holeYards: number, lie: Lie, rng: RNG): number {
  const jitter = (rng() - 0.5) * 0.06; // +/-3%
  const f = Math.max(0.4, Math.min(0.72, DRIVE_FRACTION[lie] + jitter));
  return Math.round((holeYards * f) / 5) * 5;
}

/** A short par-5 lay-up wedge's yards to the pin (80-110), clamped below the
 * remaining distance. Display-only. */
export function wedgeYards(remaining: number, rng: RNG): number {
  const y = 80 + Math.floor(rng() * 31); // 80-110
  return Math.max(40, Math.min(remaining - 5, y));
}

/** Ball position along the hole, 0 (tee) -> 1 (cup), for the HoleArt marker.
 * Pure + display-only: derived from the stage, the green result, and how far
 * the drive went. The putting stage has its own view, so 1.0 there. */
export function ballProgress(
  stage: Exclude<ChainStage, "done">,
  green: GreenResult | null,
  drive: number | null,
  holeYards: number | null
): number {
  if (stage === "tee") return 0.05;
  if (stage === "approach") {
    if (drive && holeYards) return Math.max(0.1, Math.min(0.8, drive / holeYards));
    return 0.05; // par 3 (no drive yet) — still on the tee
  }
  if (stage === "scramble") return 0.9; // just off the green
  return 1; // on the green / done
}

// --- the chain ------------------------------------------------------------

export type ChainStage = "tee" | "approach" | "layup" | "putt" | "scramble" | "done";

export interface ShotRecord {
  index: number; // decision index this shot consumed (-1 for an auto kick-in)
  stage: Exclude<ChainStage, "done">;
  decision: Decision | null;
  lie?: Lie;
  green?: GreenResult;
  puttResult?: PuttResult;
  scrambleResult?: ScrambleResult;
  distanceFt?: number;
  yards?: number; // display-only: tee = drive distance; layup wedge = yards to pin
  event: EventInstance | null;
  note: string;
}

export interface PuttContext {
  bucket: Exclude<PuttBucket, "tap">;
  distanceFt: number;
  breakDir: BreakDir;
  slope: Slope;
  speed: GreenSpeed;
  // Display-only: what this putt is FOR if holed now (eagle on a par-5 reached
  // in two, birdie on a par 3/4 or laid-up par 5, etc). Derived from the same
  // composeOutcome the scorer uses, so the label can't drift from the score.
  // Not read by scoring/pick()/calibration.
  puttFor: Outcome;
}

export interface ChainResult {
  complete: boolean;
  used: number; // decisions consumed
  shots: ShotRecord[];
  lie?: Lie; // current position context (tee lie, par 4/5)
  green?: GreenResult;
  // when not complete:
  next?: Exclude<ChainStage, "done">;
  putt?: PuttContext; // present when next === "putt"
  approachYards?: number; // display-only: yards to the pin facing the approach
  ballT?: number; // display-only: ball position along the hole, 0 (tee) -> 1 (cup)
  // when complete:
  outcome?: Outcome;
  scoreDelta?: number;
  strokes?: number;
}

export interface ChainOpts {
  shotSeed: (shotIndex: number) => number;
  eventSeed: (shotIndex: number) => number;
  greens?: GreenSpeed;
  recent?: Outcome[]; // prior holes' outcomes (for momentum)
  narration?: boolean; // default true; calibration turns it off for speed
  holeYards?: number; // display-only; when set, yards-to-target + tee distance are derived
}

/**
 * Resolve a hole from its decision list. Replays deterministically and returns
 * either the next stage the player must decide (with reads), or the final
 * outcome once the chain completes. Pure.
 */
export function resolveHoleChain(
  decisions: Decision[],
  hole: HoleSpec,
  c: Conditions,
  opts: ChainOpts
): ChainResult {
  const isPar3 = hole.par === 3;
  const greens = opts.greens ?? "Medium";
  const recent = opts.recent ?? [];
  const narrate = opts.narration !== false;
  const shots: ShotRecord[] = [];

  const noteRng = (i: number, salt: number) => mulberry32((opts.shotSeed(i) ^ salt) >>> 0);

  // Display-only yardage (independent of the outcome RNG; see helpers above).
  const holeYards = opts.holeYards ?? null;
  let drive: number | null = null;

  let lie: Lie | undefined;

  // ---- TEE (par 4/5 only) ----
  let aIdx = 0;
  if (!isPar3) {
    if (decisions.length < 1)
      return { complete: false, used: 0, shots, next: "tee", ballT: ballProgress("tee", null, null, holeYards) };
    const dec = decisions[0];
    const w = teeWeights(dec, hole, c);
    const ev = rollEvent("tee", opts.eventSeed(0), { recent, firstShotOfHole: true });
    if (ev) applyEvent(ev.def, "tee", w as Record<string, number>);
    lie = pick(w, mulberry32(opts.shotSeed(0)));
    if (holeYards) drive = driveYards(holeYards, lie, noteRng(0, YARD_SALT));
    shots.push({
      index: 0, stage: "tee", decision: dec, lie, yards: drive ?? undefined, event: ev?.instance ?? null,
      note: narrate ? teeNote(lie, noteRng(0, 0x777)) : "",
    });
    aIdx = 1;
  }

  // Yards to the pin facing the approach: total minus the drive (par 4/5), or
  // the full hole for a par 3 (tee shot IS the approach). Consistent: the drive
  // and this remaining always sum to holeYards.
  const approachYards = holeYards ? (isPar3 ? holeYards : Math.max(40, holeYards - (drive ?? 0))) : undefined;

  // ---- APPROACH (all pars; par 3's tee shot IS the approach) ----
  if (decisions.length <= aIdx)
    return {
      complete: false, used: aIdx, shots, next: "approach", lie,
      approachYards, ballT: ballProgress("approach", null, drive, holeYards),
    };
  const aDec = decisions[aIdx];
  const source: GreenSource = isPar3 ? "tee" : (lie as Lie);
  const gw = greenWeights(source, aDec, hole, c);
  const aEv = rollEvent("approach", opts.eventSeed(aIdx), { recent, firstShotOfHole: isPar3 });
  if (aEv) applyEvent(aEv.def, "approach", gw as Record<string, number>);
  const green = pick(gw, mulberry32(opts.shotSeed(aIdx)));
  const reachedInTwo = hole.par === 5 && aDec === "aggressive";
  // Non-aggressive par 5 = lay up: the approach is the lay-up, narrated as such.
  const isPar5Layup = hole.par === 5 && !reachedInTwo;
  shots.push({
    index: aIdx, stage: "approach", decision: aDec, green: isPar5Layup ? undefined : green, event: aEv?.instance ?? null,
    note: narrate ? (isPar5Layup ? layupApproachNote(noteRng(aIdx, 0x777)) : approachNote(green, isPar3, noteRng(aIdx, 0x777))) : "",
  });
  // VISIBLE LAYUP THIRD: a narration-only wedge record so a laid-up par 5 plainly
  // takes three to the green (two-putt = par now reads correctly). NOT a decision
  // and makes NO outcome pick — scoring/calibration are byte-identical to before.
  if (isPar5Layup) {
    shots.push({
      index: -1, stage: "layup", decision: null, green,
      yards: holeYards && approachYards ? wedgeYards(approachYards, noteRng(aIdx, YARD_SALT)) : undefined,
      event: null,
      note: narrate ? layupNote(green, noteRng(aIdx, 0x515)) : "",
    });
  }

  const fIdx = aIdx + 1;

  // ---- KICK-IN: auto-resolve, no extra decision ----
  if (green === "kickin") {
    const outcome = composeOutcome(reachedInTwo, { kind: "putt", result: "oneputt" });
    shots.push({
      index: -1, stage: "putt", decision: null, puttResult: "oneputt",
      distanceFt: distanceFor("tap", mulberry32(opts.shotSeed(fIdx))), event: null,
      note: narrate ? puttNote("oneputt", "tap", undefined, noteRng(fIdx, 0x999)) : "",
    });
    return finalize(hole, shots, aIdx + 1, lie, green, outcome);
  }

  // ---- SCRAMBLE: off the green, short-game decision ----
  if (green === "scramble") {
    if (decisions.length <= fIdx)
      return { complete: false, used: fIdx, shots, next: "scramble", lie, green, ballT: ballProgress("scramble", green, drive, holeYards) };
    const fDec = decisions[fIdx];
    const sw = scrambleWeights(fDec, hole, c);
    const sEv = rollEvent("scramble", opts.eventSeed(fIdx), { recent });
    if (sEv) applyEvent(sEv.def, "scramble", sw as Record<string, number>);
    const sres = pick(sw, mulberry32(opts.shotSeed(fIdx)));
    const outcome = composeOutcome(reachedInTwo, { kind: "scramble", result: sres });
    shots.push({
      index: fIdx, stage: "scramble", decision: fDec, scrambleResult: sres, event: sEv?.instance ?? null,
      note: narrate ? scrambleNote(sres, noteRng(fIdx, 0x777), fDec) : "",
    });
    return finalize(hole, shots, fIdx + 1, lie, green, outcome);
  }

  // ---- PUTT: on the green (makeable / lag) ----
  const bucket = GREEN_META[green].bucket as Exclude<PuttBucket, "tap">;
  // Fixed rng order (distance -> break -> result) so the preview descriptor and
  // the resolution agree on geometry regardless of whether a decision is in yet.
  const ctxRng = mulberry32(opts.shotSeed(fIdx));
  const distanceFt = distanceFor(bucket, ctxRng);
  const { breakDir, slope } = readBreak(ctxRng);

  if (decisions.length <= fIdx)
    return {
      complete: false, used: fIdx, shots, next: "putt", lie, green,
      putt: {
        bucket, distanceFt, breakDir, slope, speed: greens,
        // Display label source: outcome of holing this putt now (a one-putt).
        puttFor: composeOutcome(reachedInTwo, { kind: "putt", result: "oneputt" }),
      },
      ballT: ballProgress("putt", green, drive, holeYards),
    };

  const fDec = decisions[fIdx];
  const pw = puttWeights(bucket, fDec, greens);
  const pEv = rollEvent("putt", opts.eventSeed(fIdx), { recent });
  if (pEv) applyEvent(pEv.def, "putt", pw as Record<string, number>);
  const pres = pick(pw, ctxRng); // continues the stream after distance + break
  const outcome = composeOutcome(reachedInTwo, { kind: "putt", result: pres });
  shots.push({
    index: fIdx, stage: "putt", decision: fDec, puttResult: pres, distanceFt, event: pEv?.instance ?? null,
    note: narrate ? puttNote(pres, bucket, distanceFt, noteRng(fIdx, 0x999), fDec) : "",
  });
  return finalize(hole, shots, fIdx + 1, lie, green, outcome);
}

function finalize(
  hole: HoleSpec,
  shots: ShotRecord[],
  used: number,
  lie: Lie | undefined,
  green: GreenResult,
  outcome: Outcome
): ChainResult {
  const scoreDelta = SCORE_DELTA[outcome];
  return { complete: true, used, shots, lie, green, outcome, scoreDelta, strokes: hole.par + scoreDelta };
}

/** Label for the stage the player is about to decide. */
export function stagePrompt(stage: Exclude<ChainStage, "done">, par: number): string {
  switch (stage) {
    case "tee":
      return "Tee shot — how do you play it?";
    case "approach":
      return par === 3 ? "Tee shot — attack the pin?" : "Approach — how do you play it?";
    case "putt":
      return "Putt — how do you read it?";
    case "scramble":
      return "Short game — get it up and down";
    case "layup":
      return "Lay up — wedge to the green"; // auto beat; never a decision prompt
  }
}

export { LIES };
// Re-export the shared Decision type so callers of the chain can import it from
// here alongside the chain types (type-only; no runtime/calibration impact).
export type { Decision };
