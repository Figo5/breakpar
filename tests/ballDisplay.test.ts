import { describe, expect, it } from "vitest";
import { decodeBallDisplay, encodeBallDisplay } from "../lib/ballDisplay";

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
});
