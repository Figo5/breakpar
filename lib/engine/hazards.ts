import type { Decision } from "./probabilities";
import { mulberry32 } from "./rng";

export type NarrativeHazard = "none" | "sand" | "water" | "ocean";

export interface HoleHazardContext {
  hazard: NarrativeHazard;
  signature?: string;
}

export interface NarrativeContext {
  hazard?: NarrativeHazard;
  island?: boolean;
}

export type HazardPenaltyStage = "tee" | "approach";

export interface HazardPenalty {
  kind: "water" | "ocean";
  stage: HazardPenaltyStage;
  strokes: 1;
}

/** Share of an already-bad destination that actually finds the marked hazard.
 * The ordinary tee/approach tables still determine how often trouble/misses
 * happen, so aggressive choices naturally create more total penalty risk.
 *
 * RETUNED 0.35 -> 0.20 (Jul 2026): at 0.35 the penalty taxed hazard-heavy
 * courses' whole-field mean by up to +1.45 strokes/round (Muirfield Village,
 * 12 wet holes — measured in the shared-seed field sim and corroborated by the
 * W29 Torrey wet/dry hole split: wet holes -0.09 -> +0.09 while dry holes
 * IMPROVED post-deploy). 0.20 halves the tax (+0.75 at Muirfield) while water
 * stays consequential. Island misses are unchanged on purpose — an island green
 * with no bailout SHOULD always be water. The per-course mean gate in
 * scripts/calibrate.ts now guards this number: move it deliberately, update the
 * band in the same commit. */
export const HAZARD_PENALTY_RATE = {
  teeTrouble: 0.2,
  approachMiss: 0.2,
  islandMiss: 1,
} as const;

export function isIslandHole(par: number, context?: HoleHazardContext): boolean {
  return par === 3 && context?.hazard === "water" && /island/i.test(context.signature ?? "");
}

/** Resolve whether an already-bad tee/approach result actually entered water.
 * Uses its own deterministic seed and never changes the underlying lie/green
 * pick. An island-green miss is always water because there is no bailout. */
export function rollHazardPenalty(
  stage: HazardPenaltyStage,
  badResult: boolean,
  decision: Decision,
  context: HoleHazardContext | undefined,
  island: boolean,
  seed: number,
): HazardPenalty | null {
  void decision; // decision already changes the chance of reaching badResult
  if (!badResult || (context?.hazard !== "water" && context?.hazard !== "ocean")) return null;
  const rate = island && stage === "approach"
    ? HAZARD_PENALTY_RATE.islandMiss
    : stage === "tee"
      ? HAZARD_PENALTY_RATE.teeTrouble
      : HAZARD_PENALTY_RATE.approachMiss;
  if (mulberry32(seed)() >= rate) return null;
  return { kind: context.hazard, stage, strokes: 1 };
}
