import type { Decision } from "./probabilities";
import type { GreenSource } from "./putting";
import type { NarrativeHazard } from "./hazards";
import { mulberry32 } from "./rng";

export type ScoringEventKind =
  | "hole-in-one"
  | "approach-hole-out"
  | "albatross"
  | "wedge-hole-out"
  | "chip-in"
  | "bunker-hole-out";

export interface ScoringEvent {
  kind: ScoringEventKind;
  stage: "approach" | "layup" | "scramble";
  label: string;
  narration: string;
  strokesTaken: number;
}

/** Starting rates. These are intentionally rare and centralized for tuning.
 * Values are per eligible shot, before normal shot resolution. */
export const SCORING_EVENT_RATE = {
  par3Tee: { safe: 0.0003, normal: 0.0006, aggressive: 0.001 },
  approach: { safe: 0.0002, normal: 0.0005, aggressive: 0.0012 },
  par5Second: { safe: 0, normal: 0, aggressive: 0.0005 },
  layupWedge: { safe: 0.0012, normal: 0.0018, aggressive: 0 },
  scramble: { safe: 0.015, normal: 0.03, aggressive: 0.05 },
} as const;

const SOURCE_MULTIPLIER: Record<GreenSource, number> = {
  tee: 1,
  dialed: 1.5,
  fairway: 1,
  rough: 0.5,
  trouble: 0.15,
};

export function approachScoringEventRate(
  par: number,
  source: GreenSource,
  decision: Decision,
  reachedInTwo: boolean,
  layupWedge: boolean,
): number {
  if (par === 3) return SCORING_EVENT_RATE.par3Tee[decision];
  if (par === 5 && reachedInTwo) return SCORING_EVENT_RATE.par5Second[decision];
  if (layupWedge) return SCORING_EVENT_RATE.layupWedge[decision];
  return SCORING_EVENT_RATE.approach[decision] * SOURCE_MULTIPLIER[source];
}

export function scrambleScoringEventRate(decision: Decision): number {
  return SCORING_EVENT_RATE.scramble[decision];
}

function eventForApproach(par: number, reachedInTwo: boolean, layupWedge: boolean): ScoringEvent {
  if (par === 3) {
    return {
      kind: "hole-in-one", stage: "approach", label: "Hole in one",
      narration: "One swing, straight in — hole in one!", strokesTaken: 1,
    };
  }
  if (par === 5 && reachedInTwo) {
    return {
      kind: "albatross", stage: "approach", label: "Albatross",
      narration: "Holed the second shot — albatross!", strokesTaken: 2,
    };
  }
  if (layupWedge) {
    return {
      kind: "wedge-hole-out", stage: "layup", label: "Wedge hole-out",
      narration: "Spun the wedge straight into the cup — eagle!", strokesTaken: 3,
    };
  }
  return {
    kind: "approach-hole-out", stage: "approach", label: "Approach hole-out",
    narration: "Holed the approach — eagle!", strokesTaken: 2,
  };
}

export function rollApproachScoringEvent(
  par: number,
  source: GreenSource,
  decision: Decision,
  reachedInTwo: boolean,
  layupWedge: boolean,
  seed: number,
  force = false,
): ScoringEvent | null {
  const rate = approachScoringEventRate(par, source, decision, reachedInTwo, layupWedge);
  if (!force && (rate <= 0 || mulberry32(seed)() >= rate)) return null;
  return eventForApproach(par, reachedInTwo, layupWedge);
}

export function rollScrambleScoringEvent(
  par: number,
  decision: Decision,
  hazard: NarrativeHazard | undefined,
  reachedInTwo: boolean,
  seed: number,
  force = false,
): ScoringEvent | null {
  const rate = scrambleScoringEventRate(decision);
  if (!force && mulberry32(seed)() >= rate) return null;
  const bunker = hazard === "sand";
  return {
    kind: bunker ? "bunker-hole-out" : "chip-in",
    stage: "scramble",
    label: bunker ? "Bunker hole-out" : "Chip-in",
    narration: bunker ? "Holed it straight from the bunker!" : "Chipped it straight into the cup!",
    // Reached-in-two par 5: this is stroke three. Every other scramble chip-in
    // is one stroke under regulation (2 on a par 3, 3 on a par 4, 4 on a par 5).
    strokesTaken: reachedInTwo ? 3 : par - 1,
  };
}
