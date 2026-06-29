import { describe, it, expect } from "vitest";
import { holeDifficulty } from "@/lib/engine/resolveHole";
import { mulberry32 } from "@/lib/engine/rng";

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
