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
 * happen, so aggressive choices naturally create more total penalty risk. */
export const HAZARD_PENALTY_RATE = {
  teeTrouble: 0.35,
  approachMiss: 0.35,
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
