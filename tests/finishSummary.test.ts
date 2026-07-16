import { describe, expect, it } from "vitest";
import { finishSummary } from "@/lib/finishSummary";
import type { ShotRecord } from "@/lib/engine/shots";

const putt = (puttResult: "oneputt" | "twoputt" | "threeputt"): ShotRecord => ({
  index: 2,
  stage: "putt",
  decision: "normal",
  puttResult,
  event: null,
  note: "",
});

describe("finishSummary", () => {
  it("makes a par-5 three-putt par explicit", () => {
    expect(finishSummary([putt("threeputt")], "par", 5)).toBe("On in 2 · Three-putt par");
  });

  it("labels the other reached-in-two finishes clearly", () => {
    expect(finishSummary([putt("oneputt")], "eagle", 5)).toBe("On in 2 · One-putt eagle");
    expect(finishSummary([putt("twoputt")], "birdie", 5)).toBe("On in 2 · Two-putt birdie");
  });

  it("makes the automatic layup wedge visible on a par 5", () => {
    const wedge: ShotRecord = {
      index: -1,
      stage: "layup",
      decision: null,
      green: "lag",
      event: null,
      note: "Wedge onto the green",
    };
    expect(finishSummary([wedge, putt("threeputt")], "bogey", 5))
      .toBe("On in 3 · Three-putt bogey");
  });

  it("leaves non-putt finishes to their existing narration", () => {
    const scramble: ShotRecord = { index: 2, stage: "scramble", decision: "normal", scrambleResult: "updown", event: null, note: "" };
    expect(finishSummary([scramble], "par")).toBeNull();
  });

  it("keeps a real hazard penalty visible in the final result", () => {
    const penalty: ShotRecord = {
      index: 0,
      stage: "tee",
      decision: "normal",
      lie: "trouble",
      penalty: { kind: "water", stage: "tee", strokes: 1 },
      event: null,
      note: "Water off the tee — one penalty stroke",
    };
    expect(finishSummary([penalty, putt("twoputt")], "bogey")).toBe("Two-putt bogey · 1 penalty stroke");
  });

  it("surfaces a rare scored finish instead of generic shot narration", () => {
    const ace: ShotRecord = {
      index: 0,
      stage: "approach",
      decision: "normal",
      scoringEvent: {
        kind: "hole-in-one",
        stage: "approach",
        label: "Hole in one",
        narration: "One swing, straight in — hole in one!",
        strokesTaken: 1,
      },
      event: null,
      note: "One swing, straight in — hole in one!",
    };
    expect(finishSummary([ace], "eagle")).toBe("Hole in one");
  });
});
