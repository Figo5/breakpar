/**
 * Post-hole ODDS REVEAL — the "your decision mattered" teaching layer.
 *
 * The live game deliberately hides exact odds (see holeRead.ts) so play stays
 * about READING cues, not solving EV. But a recurring player complaint is that
 * outcomes "feel like RNG regardless of the decision." They're not — the engine
 * has a real skill gap — the odds are just invisible in the moment.
 *
 * This module surfaces, AFTER a hole is decided, the tee-shot odds the player
 * actually faced for the choice they made vs. the safe alternative. It reuses
 * the SAME exported weight tables the engine resolves from (teeWeights), so the
 * reveal can never drift from the real probabilities. It's display-only: it
 * never draws RNG, never touches scoring/calibration.
 *
 * Design guardrail: this is a POST-decision reveal (learning), not a live
 * pre-decision readout (which would turn the game into solved arithmetic).
 */

import { canReachPar5InTwo, teeWeights, type Lie } from "@/lib/engine/shots";
import type { Decision } from "@/lib/engine/probabilities";
import type { HoleSpec, Conditions } from "@/lib/engine/resolveHole";
import {
  puttWeights,
  greenWeights,
  scrambleWeights,
  PUTT_DECISION_LABEL,
  SHORT_DECISION_LABEL,
  type PuttResult,
  type GreenResult,
  type ScrambleResult,
  type GreenSource,
  type PuttBucket,
  type GreenSpeed,
} from "@/lib/engine/putting";
import {
  approachScoringEventRate,
  scrambleScoringEventRate,
} from "@/lib/engine/scoringEvents";
import { applyEventById } from "@/lib/engine/events";
import {
  STANDARD_V2_RULESET,
  type GameplayRulesetVersion,
} from "@/lib/engine/rulesets";

export interface OddsRow {
  decision: Decision;
  label: string;
  /** Normalized lie percentages (sum to 100), rounded to whole numbers. */
  pct: Record<Lie, number>;
  /** "Good" outcome share = dialed + fairway (found the short grass). */
  goodPct: number;
  /** Best-position share. Kept separate so "short grass" does not hide reward. */
  idealPct: number;
  /** "Trouble" share = trouble lie (the blow-up seed). */
  troublePct: number;
}

const DECISION_LABEL: Record<Decision, string> = {
  safe: "Safe",
  normal: "Normal",
  aggressive: "Aggressive",
};

/** Normalize a raw weight map to whole-number percentages summing to 100. */
function toPct(w: Record<Lie, number>): Record<Lie, number> {
  const lies: Lie[] = ["dialed", "fairway", "rough", "trouble"];
  const total = lies.reduce((a, k) => a + w[k], 0) || 1;
  const raw = lies.map((k) => ({ k, v: (w[k] / total) * 100 }));
  // Round to integers, then fix the rounding drift on the largest bucket so the
  // displayed numbers always sum to exactly 100.
  const rounded = raw.map((r) => ({ k: r.k, v: Math.round(r.v) }));
  const drift = 100 - rounded.reduce((a, r) => a + r.v, 0);
  if (drift !== 0) {
    const biggest = rounded.reduce((a, b) => (b.v > a.v ? b : a));
    biggest.v += drift;
  }
  const out = {} as Record<Lie, number>;
  for (const r of rounded) out[r.k] = r.v;
  return out;
}

function rowFor(decision: Decision, hole: HoleSpec, c: Conditions, eventId?: string | null): OddsRow {
  const weights = teeWeights(decision, hole, c);
  applyEventById(eventId, "tee", weights);
  const pct = toPct(weights);
  return {
    decision,
    label: DECISION_LABEL[decision],
    pct,
    goodPct: pct.dialed + pct.fairway,
    idealPct: pct.dialed,
    troublePct: pct.trouble,
  };
}

/**
 * The tee-shot odds the player faced, for the decision they made plus the two
 * alternatives — so the reveal shows how the choice moved the numbers.
 * `chosen` is highlighted by the caller. Par 3s have no tee decision (the first
 * decision is the tee shot at the green), so callers should only invoke this
 * for par 4/5 tee decisions; returns all three decisions' odds either way.
 */
export function teeOddsReveal(
  hole: HoleSpec,
  c: Conditions,
  eventId?: string | null,
): { safe: OddsRow; normal: OddsRow; aggressive: OddsRow } {
  return {
    safe: rowFor("safe", hole, c, eventId),
    normal: rowFor("normal", hole, c, eventId),
    aggressive: rowFor("aggressive", hole, c, eventId),
  };
}

/**
 * A one-line, plain-English takeaway comparing the chosen decision to Safe —
 * the "your call mattered" sentence. Frames variance honestly: a good lie isn't
 * a good score guarantee, and a safe play lowers risk without eliminating it.
 */
export function teeOddsTakeaway(
  chosen: Decision,
  hole: HoleSpec,
  c: Conditions,
  eventId?: string | null,
): string {
  const rows = teeOddsReveal(hole, c, eventId);
  const mine = rows[chosen];
  if (chosen === "safe") {
    return `Safe minimized trouble (${mine.troublePct}%) and favored a routine fairway, but produced fewer ideal attacking positions (${mine.idealPct}%). It protects the card rather than maximizing birdie chances.`;
  }
  const safe = rows.safe;
  const troubleDelta = mine.troublePct - safe.troublePct;
  const riskPhrase = troubleDelta > 0
    ? `more trouble risk (${mine.troublePct}% vs ${safe.troublePct}% safe)`
    : `the same trouble risk as safe (${mine.troublePct}%)`;
  return `Going ${DECISION_LABEL[chosen].toLowerCase()} raised the ideal-position chance to ${mine.idealPct}% (vs ${safe.idealPct}% safe) with ${riskPhrase}. More scoring upside, less protection.`;
}

// ===========================================================================
// PUTTING ODDS REVEAL — the most-requested extension (Will, /admin Jul 7).
// Players "really don't know the best options" on putts. Surface P(one/two/
// three-putt) per decision, same post-hole reveal pattern as the tee shot,
// reusing the engine's exported puttWeights so it can never drift from the real
// probabilities. Display-only.
// ===========================================================================

export interface PuttOddsRow {
  decision: Decision;
  label: string; // "Lag" | "Roll it" | "Charge"
  onePct: number;
  twoPct: number;
  threePct: number;
}

/** Normalize a putt weight map to whole-number percentages summing to 100. */
function puttToPct(w: Record<PuttResult, number>): { one: number; two: number; three: number } {
  const keys: PuttResult[] = ["oneputt", "twoputt", "threeputt"];
  const total = keys.reduce((a, k) => a + w[k], 0) || 1;
  const rounded = keys.map((k) => ({ k, v: Math.round((w[k] / total) * 100) }));
  const drift = 100 - rounded.reduce((a, r) => a + r.v, 0);
  if (drift !== 0) {
    const biggest = rounded.reduce((a, b) => (b.v > a.v ? b : a));
    biggest.v += drift;
  }
  const m = {} as Record<PuttResult, number>;
  for (const r of rounded) m[r.k] = r.v;
  return { one: m.oneputt, two: m.twoputt, three: m.threeputt };
}

function puttRowFor(
  decision: Decision,
  bucket: Exclude<PuttBucket, "tap">,
  speed: GreenSpeed,
  distanceFt: number,
  breakDir: "L" | "R" | "straight",
  slope: "uphill" | "downhill" | "flat",
  eventId?: string | null,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): PuttOddsRow {
  const weights = puttWeights(
    bucket,
    decision,
    speed,
    distanceFt,
    breakDir,
    slope,
    rulesetVersion,
  );
  applyEventById(eventId, "putt", weights);
  const p = puttToPct(weights);
  return { decision, label: PUTT_DECISION_LABEL[decision], onePct: p.one, twoPct: p.two, threePct: p.three };
}

/** The putt odds the player faced for all three putt decisions (Lag / Roll it /
 * Charge), at the bucket + green speed of the putt they had. */
export function puttOddsReveal(
  bucket: Exclude<PuttBucket, "tap">,
  speed: GreenSpeed,
  distanceFt: number,
  breakDir: "L" | "R" | "straight" = "straight",
  slope: "uphill" | "downhill" | "flat" = "flat",
  eventId?: string | null,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): { safe: PuttOddsRow; normal: PuttOddsRow; aggressive: PuttOddsRow } {
  return {
    safe: puttRowFor("safe", bucket, speed, distanceFt, breakDir, slope, eventId, rulesetVersion),
    normal: puttRowFor("normal", bucket, speed, distanceFt, breakDir, slope, eventId, rulesetVersion),
    aggressive: puttRowFor("aggressive", bucket, speed, distanceFt, breakDir, slope, eventId, rulesetVersion),
  };
}

/** Plain-English putt takeaway: how the chosen roll traded make-rate for
 * three-jack risk vs. lagging. Honest about variance. */
export function puttOddsTakeaway(
  chosen: Decision,
  bucket: Exclude<PuttBucket, "tap">,
  speed: GreenSpeed,
  distanceFt: number,
  breakDir: "L" | "R" | "straight" = "straight",
  slope: "uphill" | "downhill" | "flat" = "flat",
  eventId?: string | null,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): string {
  const rows = puttOddsReveal(
    bucket,
    speed,
    distanceFt,
    breakDir,
    slope,
    eventId,
    rulesetVersion,
  );
  const mine = rows[chosen];
  const lag = rows.safe;
  const dist = `${distanceFt}-foot`;
  if (chosen === "safe") {
    return `Lagging a ${dist} putt gave you the lowest three-putt risk (${mine.threePct}%) — you cozy it close and tap in. Fewer one-putts (${mine.onePct}%), but you protect against the three-jack.`;
  }
  return `${PUTT_DECISION_LABEL[chosen]} raised your one-putt chance to ${mine.onePct}% (vs ${lag.onePct}% lagging) but pushed three-putt risk to ${mine.threePct}% (vs ${lag.threePct}% lagging). More reward, more risk — the roll landed inside those odds.`;
}

// ===========================================================================
// APPROACH ODDS REVEAL — where the approach leaves you (kick-in / birdie look /
// long putt / missed green), per decision. Reuses greenWeights.
// ===========================================================================

export interface ApproachOddsRow {
  decision: Decision;
  label: string;
  kickinPct: number;
  makeablePct: number;
  lagPct: number;
  scramblePct: number;
  greenPct: number; // kickin + makeable + lag = hit the green
  holeOutPct: number;
}

function greenToPct(w: Record<GreenResult, number>): Record<GreenResult, number> {
  const keys: GreenResult[] = ["kickin", "makeable", "lag", "scramble"];
  const total = keys.reduce((a, k) => a + w[k], 0) || 1;
  const rounded = keys.map((k) => ({ k, v: Math.round((w[k] / total) * 100) }));
  const drift = 100 - rounded.reduce((a, r) => a + r.v, 0);
  if (drift !== 0) {
    const biggest = rounded.reduce((a, b) => (b.v > a.v ? b : a));
    biggest.v += drift;
  }
  const out = {} as Record<GreenResult, number>;
  for (const r of rounded) out[r.k] = r.v;
  return out;
}

function approachRowFor(
  decision: Decision,
  source: GreenSource,
  hole: HoleSpec,
  c: Conditions,
  yardsToTarget?: number,
  eventId?: string | null,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): ApproachOddsRow {
  const reachedInTwo = source !== "tee"
    && canReachPar5InTwo(hole.par, source, decision, yardsToTarget, rulesetVersion);
  const layupWedge = hole.par === 5 && !reachedInTwo;
  const scoringYards = layupWedge ? 95 : yardsToTarget;
  const weights = greenWeights(
    source,
    decision,
    hole,
    c,
    scoringYards,
    reachedInTwo,
    rulesetVersion,
  );
  applyEventById(eventId, "approach", weights);
  const p = greenToPct(weights);
  return {
    decision,
    label: DECISION_LABEL[decision],
    kickinPct: p.kickin,
    makeablePct: p.makeable,
    lagPct: p.lag,
    scramblePct: p.scramble,
    greenPct: p.kickin + p.makeable + p.lag,
    holeOutPct: approachScoringEventRate(hole.par, source, decision, reachedInTwo, layupWedge) * 100,
  };
}

/** Approach odds for all three decisions, from the lie the player was in
 * ("tee" for a par 3, else the tee-shot lie). */
export function approachOddsReveal(
  source: GreenSource,
  hole: HoleSpec,
  c: Conditions,
  yardsToTarget?: number,
  eventId?: string | null,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): { safe: ApproachOddsRow; normal: ApproachOddsRow; aggressive: ApproachOddsRow } {
  return {
    safe: approachRowFor("safe", source, hole, c, yardsToTarget, eventId, rulesetVersion),
    normal: approachRowFor("normal", source, hole, c, yardsToTarget, eventId, rulesetVersion),
    aggressive: approachRowFor("aggressive", source, hole, c, yardsToTarget, eventId, rulesetVersion),
  };
}

/** The second, server-resolved part of an aggressive short-par-4 tee shot:
 * whether the drive holds the green or leaves a greenside recovery. */
export function drivablePar4OddsReveal(
  hole: HoleSpec,
  c: Conditions,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): ApproachOddsRow {
  const weights = greenWeights(
    "tee",
    "aggressive",
    hole,
    c,
    hole.yardage,
    true,
    rulesetVersion,
  );
  const p = greenToPct(weights);
  return {
    decision: "aggressive",
    label: "Drive green",
    kickinPct: p.kickin,
    makeablePct: p.makeable,
    lagPct: p.lag,
    scramblePct: p.scramble,
    greenPct: p.kickin + p.makeable + p.lag,
    // A tee-shot hole-out is intentionally not part of this first version.
    holeOutPct: 0,
  };
}

export function approachOddsTakeaway(
  chosen: Decision,
  source: GreenSource,
  hole: HoleSpec,
  c: Conditions,
  yardsToTarget?: number,
  eventId?: string | null,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): string {
  const rows = approachOddsReveal(
    source,
    hole,
    c,
    yardsToTarget,
    eventId,
    rulesetVersion,
  );
  const mine = rows[chosen];
  const safe = rows.safe;
  const reachedInTwo = source !== "tee"
    && canReachPar5InTwo(hole.par, source, chosen, yardsToTarget, rulesetVersion);
  if (hole.par === 5 && !reachedInTwo) {
    const play = chosen === "safe" ? "The safe play" : "The normal play";
    if (chosen === "aggressive") {
      return `You tried to go for it, but the ${source} lie forced a third-shot wedge. That route had a ${mine.greenPct}% chance to hit the green and no reached-in-two scoring offset.`;
    }
    return `${play} laid up, then attacked with the automatic wedge. That third shot had a ${mine.greenPct}% chance to hit the green and a ${mine.holeOutPct.toFixed(2)}% hole-out chance.`;
  }
  if (hole.par === 5) {
    return `Going for the green in two raised the hole-out chance to ${mine.holeOutPct.toFixed(2)}% but pushed missed-green risk to ${mine.scramblePct}%. More reward, more risk.`;
  }
  if (chosen === "safe") {
    return `Playing it safe gave you a ${mine.greenPct}% chance to hit the green, a ${mine.holeOutPct.toFixed(2)}% hole-out chance, and the lowest miss risk (${mine.scramblePct}%).`;
  }
  return `Going ${DECISION_LABEL[chosen].toLowerCase()} raised the hole-out chance to ${mine.holeOutPct.toFixed(2)}% (vs ${safe.holeOutPct.toFixed(2)}% safe) but pushed missed-green risk to ${mine.scramblePct}% (vs ${safe.scramblePct}% safe).`;
}

// ===========================================================================
// SHORT-GAME (SCRAMBLE) ODDS REVEAL — up & down / chip & two-putt / blow-up /
// disaster, per decision. Reuses scrambleWeights.
// ===========================================================================

export interface ScrambleOddsRow {
  decision: Decision;
  label: string; // "Punch" | "Chip" | "Flop"
  updownPct: number;
  twochipPct: number;
  blowupPct: number;
  disasterPct: number;
  savePct: number; // updown = saved par (or better)
  holeOutPct: number;
}

function scrambleToPct(w: Record<ScrambleResult, number>): Record<ScrambleResult, number> {
  const keys: ScrambleResult[] = ["updown", "twochip", "blowup", "disaster"];
  const total = keys.reduce((a, k) => a + w[k], 0) || 1;
  const rounded = keys.map((k) => ({ k, v: Math.round((w[k] / total) * 100) }));
  const drift = 100 - rounded.reduce((a, r) => a + r.v, 0);
  if (drift !== 0) {
    const biggest = rounded.reduce((a, b) => (b.v > a.v ? b : a));
    biggest.v += drift;
  }
  const out = {} as Record<ScrambleResult, number>;
  for (const r of rounded) out[r.k] = r.v;
  return out;
}

function scrambleRowFor(
  decision: Decision,
  hole: HoleSpec,
  c: Conditions,
  eventId?: string | null,
  drivablePar4Miss = false,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): ScrambleOddsRow {
  const weights = scrambleWeights(
    decision,
    hole,
    c,
    drivablePar4Miss,
    rulesetVersion,
  );
  applyEventById(eventId, "scramble", weights);
  const p = scrambleToPct(weights);
  return {
    decision,
    label: SHORT_DECISION_LABEL[decision],
    updownPct: p.updown,
    twochipPct: p.twochip,
    blowupPct: p.blowup,
    disasterPct: p.disaster,
    savePct: p.updown,
    holeOutPct: scrambleScoringEventRate(decision) * 100,
  };
}

export function scrambleOddsReveal(
  hole: HoleSpec,
  c: Conditions,
  eventId?: string | null,
  drivablePar4Miss = false,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): { safe: ScrambleOddsRow; normal: ScrambleOddsRow; aggressive: ScrambleOddsRow } {
  return {
    safe: scrambleRowFor("safe", hole, c, eventId, drivablePar4Miss, rulesetVersion),
    normal: scrambleRowFor("normal", hole, c, eventId, drivablePar4Miss, rulesetVersion),
    aggressive: scrambleRowFor("aggressive", hole, c, eventId, drivablePar4Miss, rulesetVersion),
  };
}

export function scrambleOddsTakeaway(
  chosen: Decision,
  hole: HoleSpec,
  c: Conditions,
  eventId?: string | null,
  drivablePar4Miss = false,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
): string {
  const rows = scrambleOddsReveal(
    hole,
    c,
    eventId,
    drivablePar4Miss,
    rulesetVersion,
  );
  const mine = rows[chosen];
  const punch = rows.safe;
  const doublePlus = (r: ScrambleOddsRow) => r.blowupPct + r.disasterPct;
  if (chosen === "safe") {
    const context = drivablePar4Miss ? " after the missed drive" : "";
    return `The punch${context} was the card-protector: ${mine.holeOutPct.toFixed(1)}% hole-out chance, lowest blow-up risk (${doublePlus(mine)}% double or worse), and a ${mine.savePct}% up-and-down.`;
  }
  return `${SHORT_DECISION_LABEL[chosen]} raised the hole-out chance to ${mine.holeOutPct.toFixed(1)}% (vs ${punch.holeOutPct.toFixed(1)}% punch) and the save to ${mine.savePct}%, but raised double-or-worse risk to ${doublePlus(mine)}% (vs ${doublePlus(punch)}% punch).`;
}
