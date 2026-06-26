import { describe, it, expect } from "vitest";
import {
  resolveHoleShots,
  teeWeights,
  scoreWeights,
  SHOTS_PER_HOLE,
  shotPrompt,
  type Lie,
} from "@/lib/engine/shots";
import type { HoleSpec } from "@/lib/engine/resolveHole";
import type { Decision } from "@/lib/engine/probabilities";

const hole: HoleSpec = { number: 1, par: 4, strokeIndex: 9 };
const conditions = { difficulty: 6, wind: 10 };
const LIES: Lie[] = ["dialed", "fairway", "rough", "trouble"];

describe("teeWeights", () => {
  it("aggressive risks trouble more than safe; safe finds fairway more", () => {
    const safe = teeWeights("safe", hole, conditions);
    const aggro = teeWeights("aggressive", hole, conditions);
    expect(aggro.trouble).toBeGreaterThan(safe.trouble);
    expect(aggro.dialed).toBeGreaterThan(safe.dialed);
    for (const v of Object.values(aggro)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreWeights", () => {
  it("a good lie scores better than trouble for the same decision", () => {
    const good = scoreWeights("dialed", "normal", hole, conditions);
    const bad = scoreWeights("trouble", "normal", hole, conditions);
    const birdiesGood = good.eagle + good.birdie;
    const blowupsBad = bad.double + bad.triple;
    expect(birdiesGood).toBeGreaterThan(good.double + good.triple);
    expect(blowupsBad).toBeGreaterThan(bad.eagle + bad.birdie);
  });
  it("all outcome weights stay non-negative across lies", () => {
    for (const lie of LIES) {
      for (const dec of ["safe", "normal", "aggressive"] as Decision[]) {
        for (const v of Object.values(scoreWeights(lie, dec, hole, conditions)))
          expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("resolveHoleShots", () => {
  const seedFor = (s: number) => 1000 + s;

  it("returns an unfinished step (just a lie) after the tee shot", () => {
    const step = resolveHoleShots(["normal"], hole, conditions, seedFor);
    expect(step.complete).toBe(false);
    if (!step.complete) expect(LIES).toContain(step.lie);
  });

  it("returns a final outcome once both shots are in", () => {
    const step = resolveHoleShots(["normal", "aggressive"], hole, conditions, seedFor);
    expect(step.complete).toBe(true);
    if (step.complete) {
      expect(step.strokes).toBe(hole.par + step.scoreDelta);
      expect(LIES).toContain(step.lie);
    }
  });

  it("is deterministic & idempotent for the same decisions + seeds (anti re-roll)", () => {
    const a = resolveHoleShots(["aggressive", "safe"], hole, conditions, seedFor);
    const b = resolveHoleShots(["aggressive", "safe"], hole, conditions, seedFor);
    expect(a).toEqual(b);
    // the tee result is stable whether or not the scoring shot is included
    const tee = resolveHoleShots(["aggressive"], hole, conditions, seedFor);
    if (!tee.complete && a.complete) expect(tee.lie).toBe(a.lie);
  });

  it("plays exactly SHOTS_PER_HOLE shots", () => {
    expect(SHOTS_PER_HOLE).toBe(2);
    expect(shotPrompt(4, 0)).toMatch(/tee/i);
    expect(shotPrompt(3, 1)).toMatch(/putt/i);
    expect(shotPrompt(4, 1)).toMatch(/approach/i);
  });
});
