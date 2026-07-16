import { describe, expect, it } from "vitest";
import { applyPenaltyStrokes } from "@/lib/engine/probabilities";
import { rollHazardPenalty } from "@/lib/engine/hazards";
import { resolveHoleChain, type ChainResult } from "@/lib/engine/shots";
import type { Decision } from "@/lib/engine/probabilities";
import type { HoleSpec } from "@/lib/engine/resolveHole";

const conditions = { difficulty: 7, wind: 12 };
const island: HoleSpec = { number: 17, par: 3, strokeIndex: 7 };
const seeds = (base: number) => ({
  shotSeed: (i: number) => ((base * 2654435761 + i * 40503 + 1) >>> 0) || 1,
  eventSeed: (i: number) => ((base * 374761393 + i * 668265263 + 7) >>> 0) || 1,
  hazardSeed: (i: number) => ((base * 2246822519 + i * 3266489917 + 9) >>> 0) || 1,
  greens: "Firm" as const,
});

function finish(base: number, withPenalty: boolean): ChainResult {
  const decisions: Decision[] = ["aggressive", "normal"];
  return resolveHoleChain(decisions, island, conditions, {
    ...seeds(base),
    holeContext: { hazard: "water", signature: "The Island Green" },
    hazardPenalties: withPenalty,
  });
}

describe("hazard penalty resolver", () => {
  it("always penalizes a missed island green and never penalizes sand", () => {
    expect(rollHazardPenalty("approach", true, "safe", { hazard: "water", signature: "Island" }, true, 1))
      .toEqual({ kind: "water", stage: "approach", strokes: 1 });
    expect(rollHazardPenalty("approach", true, "aggressive", { hazard: "sand" }, false, 1)).toBeNull();
  });

  it("keeps the Triple+ label while retaining every real penalty stroke", () => {
    expect(applyPenaltyStrokes("triple", 1)).toEqual({ outcome: "triple", scoreDelta: 4 });
  });
});

describe("scored island-water path", () => {
  it("adds exactly one stroke, records the penalty, and remains deterministic", () => {
    let base = 1;
    while (base < 5000 && finish(base, false).green !== "scramble") base++;
    expect(base).toBeLessThan(5000);

    const plain = finish(base, false);
    const penalized = finish(base, true);
    const replay = finish(base, true);

    expect(penalized).toEqual(replay);
    expect(penalized.green).toBe("scramble");
    expect(penalized.penaltyStrokes).toBe(1);
    expect(penalized.scoreDelta).toBe(plain.scoreDelta! + 1);
    expect(penalized.strokes).toBe(plain.strokes! + 1);
    const penaltyShot = penalized.shots.find((shot) => shot.penalty);
    expect(penaltyShot?.penalty).toEqual({ kind: "water", stage: "approach", strokes: 1 });
    expect(penaltyShot?.note.toLowerCase()).toMatch(/penalty|add one/);
  });
});
