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
import { applyPenaltyStrokes, outcomeFromScoreDelta, type Decision, type Outcome } from "./probabilities";
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
import {
  teeNote,
  approachNote,
  puttNote,
  scrambleNote,
  layupNote,
  layupApproachNote,
  failedReachNote,
  hazardPenaltyNote,
} from "./notes";
import {
  isIslandHole,
  rollHazardPenalty,
  type HazardPenalty,
  type HoleHazardContext,
  type NarrativeContext,
} from "./hazards";
import {
  rollApproachScoringEvent,
  rollScrambleScoringEvent,
  type ScoringEvent,
} from "./scoringEvents";

/** Hard cap on decisions per hole — keeps a round fast. */
export const MAX_DECISIONS = 3;

export type Lie = "dialed" | "fairway" | "rough" | "trouble";

export const LIE_META: Record<Lie, { label: string; note: string; tone: "good" | "even" | "bad" }> = {
  dialed: { label: "Dialed in", note: "Perfect position — attack.", tone: "good" },
  fairway: { label: "In the fairway", note: "Clean look at the green.", tone: "good" },
  rough: { label: "In the rough", note: "Awkward — pick your spot.", tone: "even" },
  trouble: { label: "In trouble", note: "Scrambling — punch out or gamble?", tone: "bad" },
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

/**
 * A par 5 only gets the reached-in-two scoring offset when an aggressive second
 * shot is played from a lie that can credibly reach the green. Rough/trouble
 * aggression remains a gamble, but it cannot magically erase a stroke.
 */
export function canReachPar5InTwo(par: number, lie: Lie | undefined, decision: Decision): boolean {
  return par === 5 && decision === "aggressive" && (lie === "dialed" || lie === "fairway");
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
  penalty?: HazardPenalty;
  scoringEvent?: ScoringEvent;
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
  penaltyStrokes?: number;
}

export interface ChainOpts {
  shotSeed: (shotIndex: number) => number;
  eventSeed: (shotIndex: number) => number;
  greens?: GreenSpeed;
  recent?: Outcome[]; // prior holes' outcomes (for momentum)
  narration?: boolean; // default true; calibration turns it off for speed
  holeYards?: number; // display-only; when set, yards-to-target + tee distance are derived
  holeContext?: HoleHazardContext;
  hazardSeed?: (shotIndex: number) => number;
  hazardPenalties?: boolean; // defaults true; false isolates narration in invariant tests
  scoringEventSeed?: (shotIndex: number) => number;
  scoringEvents?: boolean; // defaults true; false provides a calibration/invariant baseline
  forceScoringEvent?: (stage: "approach" | "scramble", shotIndex: number) => boolean; // tests/simulator only
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
  const island = isIslandHole(hole.par, opts.holeContext);
  const narrativeContext: NarrativeContext = {
    hazard: opts.holeContext?.hazard,
    island,
  };
  const shots: ShotRecord[] = [];
  let penaltyStrokes = 0;

  const noteRng = (i: number, salt: number) => mulberry32((opts.shotSeed(i) ^ salt) >>> 0);
  const penaltySeed = (i: number) => opts.hazardSeed?.(i) ?? ((opts.eventSeed(i) ^ 0x48415a) >>> 0);
  const scoreEventSeed = (i: number) => opts.scoringEventSeed?.(i) ?? ((opts.eventSeed(i) ^ 0x53434f) >>> 0);

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
    const penalty = opts.hazardPenalties === false
      ? null
      : rollHazardPenalty("tee", lie === "trouble", dec, opts.holeContext, island, penaltySeed(0));
    penaltyStrokes += penalty?.strokes ?? 0;
    if (holeYards) drive = driveYards(holeYards, lie, noteRng(0, YARD_SALT));
    shots.push({
      index: 0, stage: "tee", decision: dec, lie, yards: drive ?? undefined,
      penalty: penalty ?? undefined, event: ev?.instance ?? null,
      note: narrate
        ? penalty
          ? hazardPenaltyNote(penalty, noteRng(0, 0x777), narrativeContext)
          : teeNote(lie, noteRng(0, 0x777), narrativeContext)
        : "",
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
      approachYards, ballT: ballProgress("approach", null, drive, holeYards), penaltyStrokes,
    };
  const aDec = decisions[aIdx];
  const source: GreenSource = isPar3 ? "tee" : (lie as Lie);
  const gw = greenWeights(source, aDec, hole, c);
  const aEv = rollEvent("approach", opts.eventSeed(aIdx), { recent, firstShotOfHole: isPar3 });
  if (aEv) applyEvent(aEv.def, "approach", gw as Record<string, number>);
  const green = pick(gw, mulberry32(opts.shotSeed(aIdx)));
  const reachedInTwo = canReachPar5InTwo(hole.par, lie, aDec);
  // A par 5 that cannot credibly reach gets a visible wedge third. This covers
  // both a chosen layup and an aggressive attempt from rough/trouble.
  const isPar5Layup = hole.par === 5 && !reachedInTwo;
  const failedReach = isPar5Layup && aDec === "aggressive";
  const scoringEvent = opts.scoringEvents === false ? null : rollApproachScoringEvent(
    hole.par,
    source,
    aDec,
    reachedInTwo,
    isPar5Layup,
    scoreEventSeed(aIdx),
    opts.forceScoringEvent?.("approach", aIdx) ?? false,
  );
  if (scoringEvent) {
    if (isPar5Layup) {
      shots.push({
        index: aIdx, stage: "approach", decision: aDec, event: aEv?.instance ?? null,
        note: narrate ? (failedReach ? failedReachNote(noteRng(aIdx, 0x777)) : layupApproachNote(noteRng(aIdx, 0x777))) : "",
      });
      shots.push({
        index: -1, stage: "layup", decision: null, scoringEvent,
        yards: holeYards && approachYards ? wedgeYards(approachYards, noteRng(aIdx, YARD_SALT)) : undefined,
        event: null, note: narrate ? scoringEvent.narration : "",
      });
    } else {
      shots.push({
        index: aIdx, stage: "approach", decision: aDec, scoringEvent,
        event: aEv?.instance ?? null, note: narrate ? scoringEvent.narration : "",
      });
    }
    const scored = outcomeFromScoreDelta(scoringEvent.strokesTaken + penaltyStrokes - hole.par);
    return finalize(hole, shots, aIdx + 1, lie, undefined, scored.outcome, scored.scoreDelta, penaltyStrokes);
  }
  const approachPenalty = opts.hazardPenalties === false
    ? null
    : rollHazardPenalty("approach", green === "scramble", aDec, opts.holeContext, island, penaltySeed(aIdx));
  penaltyStrokes += approachPenalty?.strokes ?? 0;
  shots.push({
    index: aIdx, stage: "approach", decision: aDec, green: isPar5Layup ? undefined : green,
    penalty: !isPar5Layup && approachPenalty ? approachPenalty : undefined,
    event: aEv?.instance ?? null,
    note: narrate
      ? isPar5Layup
        ? failedReach
          ? failedReachNote(noteRng(aIdx, 0x777))
          : layupApproachNote(noteRng(aIdx, 0x777))
        : approachPenalty
          ? hazardPenaltyNote(approachPenalty, noteRng(aIdx, 0x777), narrativeContext)
          : approachNote(green, isPar3, noteRng(aIdx, 0x777), reachedInTwo ? "eagle" : "birdie", narrativeContext)
      : "",
  });
  // VISIBLE LAYUP THIRD: a narration-only wedge record so a laid-up par 5 plainly
  // takes three to the green (two-putt = par now reads correctly). NOT a decision
  // and makes NO outcome pick — scoring/calibration are byte-identical to before.
  if (isPar5Layup) {
    shots.push({
      index: -1, stage: "layup", decision: null, green,
      yards: holeYards && approachYards ? wedgeYards(approachYards, noteRng(aIdx, YARD_SALT)) : undefined,
      penalty: approachPenalty ?? undefined,
      event: null,
      note: narrate
        ? approachPenalty
          ? hazardPenaltyNote(approachPenalty, noteRng(aIdx, 0x515), narrativeContext)
          : layupNote(green, noteRng(aIdx, 0x515))
        : "",
    });
  }

  const fIdx = aIdx + 1;

  // ---- KICK-IN: auto-resolve, no extra decision ----
  if (green === "kickin") {
    const scored = applyPenaltyStrokes(composeOutcome(reachedInTwo, { kind: "putt", result: "oneputt" }), penaltyStrokes);
    shots.push({
      index: -1, stage: "putt", decision: null, puttResult: "oneputt",
      distanceFt: distanceFor("tap", mulberry32(opts.shotSeed(fIdx))), event: null,
      note: narrate ? puttNote("oneputt", "tap", undefined, noteRng(fIdx, 0x999), undefined, scored.outcome) : "",
    });
    return finalize(hole, shots, aIdx + 1, lie, green, scored.outcome, scored.scoreDelta, penaltyStrokes);
  }

  // ---- SCRAMBLE: off the green, short-game decision ----
  if (green === "scramble") {
    if (decisions.length <= fIdx)
      return { complete: false, used: fIdx, shots, next: "scramble", lie, green, ballT: ballProgress("scramble", green, drive, holeYards), penaltyStrokes };
    const fDec = decisions[fIdx];
    const scoringEvent = opts.scoringEvents === false ? null : rollScrambleScoringEvent(
      hole.par,
      fDec,
      opts.holeContext?.hazard,
      reachedInTwo,
      scoreEventSeed(fIdx),
      opts.forceScoringEvent?.("scramble", fIdx) ?? false,
    );
    if (scoringEvent) {
      const scored = outcomeFromScoreDelta(scoringEvent.strokesTaken + penaltyStrokes - hole.par);
      shots.push({
        index: fIdx, stage: "scramble", decision: fDec, scoringEvent,
        event: null, note: narrate ? scoringEvent.narration : "",
      });
      return finalize(hole, shots, fIdx + 1, lie, green, scored.outcome, scored.scoreDelta, penaltyStrokes);
    }
    const sw = scrambleWeights(fDec, hole, c);
    const sEv = rollEvent("scramble", opts.eventSeed(fIdx), { recent });
    if (sEv) applyEvent(sEv.def, "scramble", sw as Record<string, number>);
    const sres = pick(sw, mulberry32(opts.shotSeed(fIdx)));
    const scored = applyPenaltyStrokes(composeOutcome(reachedInTwo, { kind: "scramble", result: sres }), penaltyStrokes);
    shots.push({
      index: fIdx, stage: "scramble", decision: fDec, scrambleResult: sres, event: sEv?.instance ?? null,
      note: narrate ? scrambleNote(sres, noteRng(fIdx, 0x777), fDec, scored.outcome, narrativeContext) : "",
    });
    return finalize(hole, shots, fIdx + 1, lie, green, scored.outcome, scored.scoreDelta, penaltyStrokes);
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
        puttFor: applyPenaltyStrokes(composeOutcome(reachedInTwo, { kind: "putt", result: "oneputt" }), penaltyStrokes).outcome,
      },
      ballT: ballProgress("putt", green, drive, holeYards), penaltyStrokes,
    };

  const fDec = decisions[fIdx];
  const pw = puttWeights(bucket, fDec, greens, distanceFt);
  const pEv = rollEvent("putt", opts.eventSeed(fIdx), { recent });
  if (pEv) applyEvent(pEv.def, "putt", pw as Record<string, number>);
  const pres = pick(pw, ctxRng); // continues the stream after distance + break
  const scored = applyPenaltyStrokes(composeOutcome(reachedInTwo, { kind: "putt", result: pres }), penaltyStrokes);
  shots.push({
    index: fIdx, stage: "putt", decision: fDec, puttResult: pres, distanceFt, event: pEv?.instance ?? null,
    note: narrate ? puttNote(pres, bucket, distanceFt, noteRng(fIdx, 0x999), fDec, scored.outcome) : "",
  });
  return finalize(hole, shots, fIdx + 1, lie, green, scored.outcome, scored.scoreDelta, penaltyStrokes);
}

function finalize(
  hole: HoleSpec,
  shots: ShotRecord[],
  used: number,
  lie: Lie | undefined,
  green: GreenResult | undefined,
  outcome: Outcome,
  scoreDelta: number,
  penaltyStrokes: number,
): ChainResult {
  return { complete: true, used, shots, lie, green, outcome, scoreDelta, strokes: hole.par + scoreDelta, penaltyStrokes };
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
