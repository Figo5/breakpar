import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/engine/probabilities";
import type { HoleSpec } from "@/lib/engine/resolveHole";
import { resolveHoleChain, type ChainResult } from "@/lib/engine/shots";
import {
  approachScoringEventRate,
  scrambleScoringEventRate,
} from "@/lib/engine/scoringEvents";

const conditions = { difficulty: 6, wind: 10 };
const par3: HoleSpec = { number: 3, par: 3, strokeIndex: 15 };
const par4: HoleSpec = { number: 9, par: 4, strokeIndex: 1 };
const par5: HoleSpec = { number: 18, par: 5, strokeIndex: 7 };

const seeds = (base: number) => ({
  shotSeed: (i: number) => ((base * 2654435761 + i * 40503 + 1) >>> 0) || 1,
  eventSeed: (i: number) => ((base * 374761393 + i * 668265263 + 7) >>> 0) || 1,
  hazardSeed: (i: number) => ((base * 2246822519 + i * 3266489917 + 9) >>> 0) || 1,
  scoringEventSeed: (i: number) => ((base * 1597334677 + i * 3812015801 + 11) >>> 0) || 1,
  greens: "Medium" as const,
  hazardPenalties: false,
});

function forcedApproach(hole: HoleSpec, decisions: Decision[]) {
  return resolveHoleChain(decisions, hole, conditions, {
    ...seeds(17),
    forceScoringEvent: (stage) => stage === "approach",
  });
}

function findScramble(hole: HoleSpec, approach: Decision): { base: number; partial: ChainResult } {
  for (let base = 1; base < 10_000; base++) {
    const partial = resolveHoleChain(["normal", approach], hole, conditions, {
      ...seeds(base),
      scoringEvents: false,
    });
    if (!partial.complete && partial.next === "scramble") return { base, partial };
  }
  throw new Error("Could not find deterministic scramble seed");
}

describe("scoring-event approach finishes", () => {
  it("scores a par-3 tee hole-out as a hole in one", () => {
    const result = forcedApproach(par3, ["normal"]);

    expect(result).toMatchObject({ complete: true, outcome: "eagle", scoreDelta: -2, strokes: 1 });
    expect(result.shots.at(-1)?.scoringEvent?.kind).toBe("hole-in-one");
    expect(result.shots).toHaveLength(1);
  });

  it("scores a par-4 approach hole-out as an eagle", () => {
    const result = forcedApproach(par4, ["normal", "normal"]);

    expect(result).toMatchObject({ complete: true, outcome: "eagle", scoreDelta: -2, strokes: 2 });
    expect(result.shots.at(-1)?.scoringEvent?.kind).toBe("approach-hole-out");
  });

  it("scores an aggressive par-5 second-shot hole-out as an albatross", () => {
    const result = forcedApproach(par5, ["normal", "aggressive"]);

    expect(result).toMatchObject({ complete: true, outcome: "albatross", scoreDelta: -3, strokes: 2 });
    expect(result.shots.at(-1)?.scoringEvent?.kind).toBe("albatross");
  });

  it("shows the layup before a par-5 wedge hole-out", () => {
    const result = forcedApproach(par5, ["normal", "normal"]);

    expect(result).toMatchObject({ complete: true, outcome: "eagle", scoreDelta: -2, strokes: 3 });
    expect(result.shots.map((shot) => shot.stage)).toEqual(["tee", "approach", "layup"]);
    expect(result.shots.at(-1)?.scoringEvent?.kind).toBe("wedge-hole-out");
  });
});

describe("scoring-event scramble finishes", () => {
  it("turns a missed par-4 green into a chip-in birdie", () => {
    const { base } = findScramble(par4, "normal");
    const opts = {
      ...seeds(base),
      forceScoringEvent: (stage: "approach" | "scramble") => stage === "scramble",
    };
    const result = resolveHoleChain(["normal", "normal", "normal"], par4, conditions, opts);

    expect(result).toMatchObject({ complete: true, outcome: "birdie", scoreDelta: -1, strokes: 3 });
    expect(result.shots.at(-1)?.scoringEvent?.kind).toBe("chip-in");
    expect(resolveHoleChain(["normal", "normal", "normal"], par4, conditions, opts)).toEqual(result);

    // A hole-out is an extra success lane before the unchanged short-game
    // table. It must improve this exact shot, never replace an up-and-down
    // with a worse result.
    const withoutHoleOut = resolveHoleChain(["normal", "normal", "normal"], par4, conditions, {
      ...seeds(base),
      scoringEvents: false,
    });
    expect(result.scoreDelta).toBeLessThan(withoutHoleOut.scoreDelta!);
  });

  it("labels the same finish from sand as a bunker hole-out", () => {
    const { base } = findScramble(par4, "normal");
    const result = resolveHoleChain(["normal", "normal", "aggressive"], par4, conditions, {
      ...seeds(base),
      holeContext: { hazard: "sand" },
      forceScoringEvent: (stage) => stage === "scramble",
    });

    expect(result.shots.at(-1)?.scoringEvent?.kind).toBe("bunker-hole-out");
    expect(result.outcome).toBe("birdie");
  });

  it("scores a chip-in after reaching a par 5 in two as eagle", () => {
    const { base } = findScramble(par5, "aggressive");
    const result = resolveHoleChain(["normal", "aggressive", "normal"], par5, conditions, {
      ...seeds(base),
      forceScoringEvent: (stage) => stage === "scramble",
    });

    expect(result).toMatchObject({ complete: true, outcome: "eagle", scoreDelta: -2, strokes: 3 });
    expect(result.shots.at(-1)?.scoringEvent?.kind).toBe("chip-in");
  });
});

describe("scoring-event rates and isolation", () => {
  it("rewards higher-risk choices with higher eligible hole-out rates", () => {
    expect(approachScoringEventRate(4, "fairway", "aggressive", false, false))
      .toBeGreaterThan(approachScoringEventRate(4, "fairway", "safe", false, false));
    expect(scrambleScoringEventRate("aggressive")).toBeGreaterThan(scrambleScoringEventRate("safe"));
    expect(approachScoringEventRate(4, "rough", "normal", false, false))
      .toBeLessThan(approachScoringEventRate(4, "fairway", "normal", false, false));
  });

  it("does not perturb the old chain when no scoring event fires", () => {
    const decisions: Decision[] = ["normal", "normal", "normal"];
    const disabled = resolveHoleChain(decisions, par4, conditions, { ...seeds(41), scoringEvents: false });
    const enabled = resolveHoleChain(decisions, par4, conditions, {
      ...seeds(41),
      scoringEventSeed: () => 1,
    });

    expect(enabled).toEqual(disabled);
  });
});
