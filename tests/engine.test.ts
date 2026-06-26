import { describe, it, expect } from "vitest";
import {
  resolveHole,
  resolveHoleForRound,
  holeDifficulty,
  buildWeights,
  previewOdds,
  type HoleSpec,
} from "@/lib/engine/resolveHole";
import { mulberry32 } from "@/lib/engine/rng";

const hole: HoleSpec = { number: 1, par: 4, strokeIndex: 9 };
const conditions = { difficulty: 7, wind: 12 };

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("returns values in [0,1)", () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("holeDifficulty", () => {
  it("is bounded to 0..1 and harder for low stroke index", () => {
    const hard = holeDifficulty({ number: 1, par: 4, strokeIndex: 1 }, conditions);
    const easy = holeDifficulty({ number: 1, par: 4, strokeIndex: 18 }, conditions);
    expect(hard).toBeGreaterThan(easy);
    expect(hard).toBeLessThanOrEqual(1);
    expect(easy).toBeGreaterThanOrEqual(0);
  });
});

describe("buildWeights", () => {
  it("all weights stay non-negative as difficulty rises", () => {
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      const w = buildWeights("aggressive", d);
      for (const v of Object.values(w)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("resolveHole", () => {
  it("is reproducible from the same seed (anti re-roll)", () => {
    const a = resolveHoleForRound("round-1", "normal", hole, conditions);
    const b = resolveHoleForRound("round-1", "normal", hole, conditions);
    expect(a).toEqual(b);
  });

  it("strokes equal par + scoreDelta", () => {
    const r = resolveHole("normal", hole, conditions, mulberry32(7));
    expect(r.strokes).toBe(hole.par + r.scoreDelta);
  });
});

describe("previewOdds", () => {
  it("under/over are percentages and aggressive birdies more than safe", () => {
    const safe = previewOdds("safe", hole, conditions);
    const aggro = previewOdds("aggressive", hole, conditions);
    expect(safe.underPct).toBeGreaterThanOrEqual(0);
    expect(safe.overPct).toBeLessThanOrEqual(100);
    expect(aggro.underPct).toBeGreaterThan(safe.underPct);
  });
});
