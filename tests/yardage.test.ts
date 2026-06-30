import { describe, it, expect } from "vitest";
import {
  resolveHoleChain,
  driveYards,
  wedgeYards,
  ballProgress,
  type ChainOpts,
} from "@/lib/engine/shots";
import { mulberry32 } from "@/lib/engine/rng";
import type { HoleSpec, Conditions } from "@/lib/engine/resolveHole";
import type { Decision } from "@/lib/engine/probabilities";

const cond: Conditions = { difficulty: 7, wind: 10 };
const par4: HoleSpec = { number: 1, par: 4, strokeIndex: 5 };
const par3: HoleSpec = { number: 7, par: 3, strokeIndex: 14 };
const par5: HoleSpec = { number: 18, par: 5, strokeIndex: 11 };

const opts = (holeYards?: number): ChainOpts => ({
  shotSeed: (i) => 1000 + i * 7,
  eventSeed: (i) => 9000 + i * 13,
  greens: "Medium",
  holeYards,
});

describe("driveYards / wedgeYards / ballProgress (display-only)", () => {
  it("drive is bounded, rounded to 5, and longer from a better lie", () => {
    const d = driveYards(446, "fairway", mulberry32(42));
    expect(d % 5).toBe(0);
    expect(d).toBeGreaterThanOrEqual(Math.round((446 * 0.4) / 5) * 5);
    expect(d).toBeLessThanOrEqual(Math.round((446 * 0.72) / 5) * 5);
    // dialed (0.66) beats trouble (0.50) on the same rng draw
    const seed = () => mulberry32(7);
    expect(driveYards(446, "dialed", seed())).toBeGreaterThan(driveYards(446, "trouble", seed()));
  });

  it("wedge stays short of the remaining and within 40..110", () => {
    const w = wedgeYards(210, mulberry32(3));
    expect(w).toBeGreaterThanOrEqual(40);
    expect(w).toBeLessThanOrEqual(110);
    expect(w).toBeLessThan(210);
  });

  it("ball advances tee -> approach -> scramble -> green", () => {
    expect(ballProgress("tee", null, null, 446)).toBeCloseTo(0.05);
    expect(ballProgress("approach", null, 280, 446)).toBeCloseTo(280 / 446);
    expect(ballProgress("approach", null, null, 446)).toBeCloseTo(0.05); // par 3, no drive
    expect(ballProgress("scramble", "scramble", 280, 446)).toBe(0.9);
    expect(ballProgress("putt", "lag", 280, 446)).toBe(1);
  });
});

describe("yardage-to-target shown on the right stages", () => {
  it("par 4: drive + approach yards sum exactly to the hole yardage", () => {
    const step = resolveHoleChain(["safe"], par4, cond, opts(446));
    expect(step.complete).toBe(false);
    expect(step.next).toBe("approach");
    const tee = step.shots.find((s) => s.stage === "tee")!;
    expect(typeof tee.yards).toBe("number");
    expect(typeof step.approachYards).toBe("number");
    expect(tee.yards! + step.approachYards!).toBe(446); // consistent by construction
    expect(typeof step.ballT).toBe("number");
  });

  it("par 3: approach yardage equals the hole (tee shot is the approach)", () => {
    const step = resolveHoleChain([], par3, cond, opts(188));
    expect(step.next).toBe("approach");
    expect(step.approachYards).toBe(188);
  });

  it("par 5 lay-up: the wedge third gets a short yards-to-pin", () => {
    // safe approach on a par 5 = lay up -> a narration-only wedge record.
    const step = resolveHoleChain(["normal", "safe"], par5, cond, opts(560));
    const wedge = step.shots.find((s) => s.stage === "layup");
    expect(wedge).toBeDefined();
    expect(typeof wedge!.yards).toBe("number");
    expect(wedge!.yards!).toBeLessThanOrEqual(110);
  });
});

describe("yardage is display-only — absent without holeYards, never changes outcomes", () => {
  it("no holeYards -> no yards/approachYards leak", () => {
    const step = resolveHoleChain(["safe"], par4, cond, opts(undefined));
    expect(step.approachYards).toBeUndefined();
    expect(step.shots.find((s) => s.stage === "tee")!.yards).toBeUndefined();
  });

  it("resolved Outcome is identical with and without holeYards", () => {
    const seq: Decision[] = ["normal", "normal", "normal"];
    const withY = resolveHoleChain(seq, par4, cond, opts(446));
    const without = resolveHoleChain(seq, par4, cond, opts(undefined));
    // Whatever the chain resolves to, the display layer must not move it.
    expect(withY.complete).toBe(without.complete);
    expect(withY.outcome).toBe(without.outcome);
    expect(withY.scoreDelta).toBe(without.scoreDelta);
    expect(withY.shots.map((s) => [s.stage, s.green, s.puttResult, s.scrambleResult]))
      .toEqual(without.shots.map((s) => [s.stage, s.green, s.puttResult, s.scrambleResult]));
  });
});
