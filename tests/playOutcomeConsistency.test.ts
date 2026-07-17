import { describe, expect, it } from "vitest";
import { decodeBallDisplay, encodeStepBallDisplay, type BallDisplayState } from "@/lib/ballDisplay";
import { finishSummary } from "@/lib/finishSummary";
import { resolveHoleChain, type ChainOpts, type ChainResult } from "@/lib/engine/shots";
import type { Decision } from "@/lib/engine/probabilities";
import type { HoleSpec } from "@/lib/engine/resolveHole";

const conditions = { difficulty: 7, wind: 12 };
const par3: HoleSpec = { number: 17, par: 3, strokeIndex: 7 };
const par4: HoleSpec = { number: 8, par: 4, strokeIndex: 5 };
const par5: HoleSpec = { number: 8, par: 5, strokeIndex: 1 };

const seeds = (base: number): ChainOpts => ({
  shotSeed: (i) => ((base * 2654435761 + i * 40503 + 1) >>> 0) || 1,
  eventSeed: (i) => ((base * 374761393 + i * 668265263 + 7) >>> 0) || 1,
  hazardSeed: (i) => ((base * 2246822519 + i * 3266489917 + 9) >>> 0) || 1,
  scoringEventSeed: (i) => ((base * 1597334677 + i * 3812015801 + 11) >>> 0) || 1,
  greens: "Fast",
  narration: false,
  scoringEvents: false,
});

function markerState(step: ChainResult): BallDisplayState {
  if (step.complete || !step.next) throw new Error("expected an unfinished step");
  return decodeBallDisplay(encodeStepBallDisplay({
    progress: step.ballT,
    lie: step.lie,
    nextStage: step.next,
    shots: step.shots,
  })).state;
}

function findStep(
  hole: HoleSpec,
  decisions: Decision[],
  match: (step: ChainResult) => boolean,
  extra: Partial<ChainOpts> = {},
): ChainResult {
  for (let base = 1; base <= 10_000; base++) {
    const step = resolveHoleChain(decisions, hole, conditions, { ...seeds(base), ...extra });
    if (match(step)) return step;
  }
  throw new Error("representative deterministic step not found");
}

function playToEnd(
  hole: HoleSpec,
  base: number,
  policy: (step: ChainResult) => Decision,
  extra: Partial<ChainOpts> = {},
): ChainResult {
  const decisions: Decision[] = [];
  let step = resolveHoleChain(decisions, hole, conditions, { ...seeds(base), ...extra });
  for (let guard = 0; !step.complete && guard < 6; guard++) {
    decisions.push(policy(step));
    step = resolveHoleChain(decisions, hole, conditions, { ...seeds(base), ...extra });
  }
  if (!step.complete) throw new Error("hole did not finish");
  return step;
}

describe("engine outcome -> play-map marker", () => {
  it.each([
    ["fairway", "line"],
    ["rough", "rough"],
    ["trouble", "trouble"],
  ] as const)("renders a %s tee result in the matching terrain", (lie, state) => {
    const step = findStep(
      par4,
      ["normal"],
      (candidate) => !candidate.complete && candidate.next === "approach" && candidate.lie === lie,
      { holeYards: 458, holeContext: { hazard: "none" } },
    );

    expect(markerState(step)).toBe(state);
    expect(step.shots[0].lie).toBe(lie);
    expect(step.shots[0].penalty).toBeUndefined();
  });

  it("renders a real tee-shot water penalty in water, not center fairway", () => {
    const step = findStep(
      par4,
      ["aggressive"],
      (candidate) => !candidate.complete && !!candidate.shots[0]?.penalty,
      { holeYards: 458, holeContext: { hazard: "water" } },
    );

    expect(step.lie).toBe("trouble");
    expect(step.penaltyStrokes).toBe(1);
    expect(markerState(step)).toBe("water");
  });

  it("renders an ordinary missed green short of the green", () => {
    const step = findStep(
      par4,
      ["normal", "normal"],
      (candidate) => !candidate.complete && candidate.next === "scramble" && !candidate.shots.some((s) => s.penalty),
      { holeYards: 458, holeContext: { hazard: "none" } },
    );

    expect(step.green).toBe("scramble");
    expect(markerState(step)).toBe("short");
  });

  it("renders an island-green miss in water and adds exactly one stroke", () => {
    const step = findStep(
      par3,
      ["normal"],
      (candidate) => !candidate.complete && candidate.next === "scramble",
      {
        holeYards: 137,
        holeContext: { hazard: "water", signature: "The Island Green — all carry" },
      },
    );

    expect(step.green).toBe("scramble");
    expect(step.penaltyStrokes).toBe(1);
    expect(step.shots[0].penalty).toEqual({ kind: "water", stage: "approach", strokes: 1 });
    expect(markerState(step)).toBe("water");
  });
});

describe("resolved strokes -> scorecard summary", () => {
  function findFinish(
    policy: (step: ChainResult) => Decision,
    match: (step: ChainResult) => boolean,
  ): ChainResult {
    for (let base = 1; base <= 10_000; base++) {
      const step = playToEnd(par5, base, policy, { holeYards: 599, holeContext: { hazard: "none" } });
      if (match(step)) return step;
    }
    throw new Error("representative deterministic finish not found");
  }

  it("calls a reached-in-two three-putt a par", () => {
    const step = findFinish(
      (candidate) => candidate.next === "approach" ? "aggressive" : "normal",
      (candidate) => candidate.shots.at(-1)?.puttResult === "threeputt",
    );

    expect(step.outcome).toBe("par");
    expect(step.strokes).toBe(5);
    expect(step.strokes).toBe(par5.par + step.scoreDelta!);
    expect(finishSummary(step.shots, step.outcome!, par5.par)).toBe("On in 2 · Three-putt par");
  });

  it("calls a laid-up three-putt a bogey and exposes the wedge third", () => {
    const step = findFinish(
      () => "normal",
      (candidate) => candidate.shots.at(-1)?.puttResult === "threeputt",
    );

    expect(step.shots.some((shot) => shot.stage === "layup")).toBe(true);
    expect(step.outcome).toBe("bogey");
    expect(step.strokes).toBe(6);
    expect(finishSummary(step.shots, step.outcome!, par5.par)).toBe("On in 3 · Three-putt bogey");
  });

  it.each([
    [par3, ["normal"] as Decision[], "hole-in-one", "eagle", 1],
    [par4, ["normal", "normal"] as Decision[], "approach-hole-out", "eagle", 2],
    [par5, ["normal", "aggressive"] as Decision[], "albatross", "albatross", 2],
    [par5, ["normal", "normal"] as Decision[], "wedge-hole-out", "eagle", 3],
  ] as const)("scores a forced %s-hole scoring event from literal strokes", (hole, decisions, kind, outcome, strokes) => {
    const step = resolveHoleChain(decisions, hole, conditions, {
      ...seeds(41),
      scoringEvents: true,
      forceScoringEvent: (stage) => stage === "approach",
    });

    expect(step.complete).toBe(true);
    expect(step.shots.find((shot) => shot.scoringEvent)?.scoringEvent?.kind).toBe(kind);
    expect(step.outcome).toBe(outcome);
    expect(step.strokes).toBe(strokes);
    expect(step.strokes).toBe(hole.par + step.scoreDelta!);
  });
});
