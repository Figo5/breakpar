import { describe, expect, it } from "vitest";
import { decodeBallDisplay, encodeBallDisplay, encodeStepBallDisplay } from "../lib/ballDisplay";

describe("ball display position", () => {
  it("keeps fairway progress on the route", () => {
    expect(decodeBallDisplay(encodeBallDisplay(0.42, "fairway", "approach")))
      .toEqual({ progress: 0.42, state: "line" });
  });

  it("carries rough and trouble without changing the HoleMap prop type", () => {
    const rough = decodeBallDisplay(encodeBallDisplay(0.38, "rough", "approach"));
    const trouble = decodeBallDisplay(encodeBallDisplay(0.61, "trouble", "approach"));
    expect(rough.state).toBe("rough");
    expect(rough.progress).toBeCloseTo(0.38);
    expect(trouble.state).toBe("trouble");
    expect(trouble.progress).toBeCloseTo(0.61);
  });

  it("marks a missed green as short of the target", () => {
    const short = decodeBallDisplay(encodeBallDisplay(0.9, "fairway", "scramble"));
    expect(short.state).toBe("short");
    expect(short.progress).toBeCloseTo(0.9);
  });

  it("carries an explicit penalty state so HoleArt can place the ball in water", () => {
    const water = decodeBallDisplay(encodeBallDisplay(0.62, "trouble", "approach", true));
    expect(water.state).toBe("water");
    expect(water.progress).toBeCloseTo(0.62);
  });

  it("derives marker state from the latest resolved shot", () => {
    const water = decodeBallDisplay(encodeStepBallDisplay({
      progress: 0.63,
      lie: "trouble",
      nextStage: "approach",
      shots: [{ penalty: { kind: "water", strokes: 1 } }],
    }));
    expect(water.state).toBe("water");
    expect(water.progress).toBeCloseTo(0.63);

    const short = decodeBallDisplay(encodeStepBallDisplay({
      progress: 0.9,
      lie: "fairway",
      nextStage: "scramble",
      shots: [{}],
    }));
    expect(short.state).toBe("short");
    expect(short.progress).toBeCloseTo(0.9);
  });

  it("falls back to the tee when an older response omits display progress", () => {
    expect(decodeBallDisplay(encodeStepBallDisplay({
      progress: null,
      lie: null,
      nextStage: "tee",
      shots: [],
    }))).toEqual({ progress: 0.05, state: "line" });
  });
});
