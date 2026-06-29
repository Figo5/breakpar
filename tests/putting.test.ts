import { describe, it, expect } from "vitest";
import {
  greenWeights,
  puttWeights,
  scrambleWeights,
  composeOutcome,
  GREEN_META,
  GREEN_RESULTS,
  PUTT_RESULTS,
  SCRAMBLE_RESULTS,
} from "@/lib/engine/putting";
import type { HoleSpec } from "@/lib/engine/resolveHole";

const hole: HoleSpec = { number: 1, par: 4, strokeIndex: 9 };
const c = { difficulty: 6, wind: 10 };

describe("greenWeights", () => {
  it("a dialed lie reaches the green far more than trouble", () => {
    const dialed = greenWeights("dialed", "normal", hole, c);
    const trouble = greenWeights("trouble", "normal", hole, c);
    const onGreen = (w: Record<string, number>) => w.kickin + w.makeable + w.lag;
    expect(onGreen(dialed)).toBeGreaterThan(onGreen(trouble));
    expect(trouble.scramble).toBeGreaterThan(dialed.scramble);
  });
  it("never produces negative weights across sources", () => {
    for (const src of ["dialed", "fairway", "rough", "trouble", "tee"] as const)
      for (const d of ["safe", "normal", "aggressive"] as const)
        for (const v of Object.values(greenWeights(src, d, hole, c)))
          expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("puttWeights", () => {
  it("Charge makes more putts AND three-jacks more than Lag", () => {
    const lag = puttWeights("short", "safe", "Medium");
    const charge = puttWeights("short", "aggressive", "Medium");
    expect(charge.oneputt).toBeGreaterThan(lag.oneputt);
    expect(charge.threeputt).toBeGreaterThan(lag.threeputt);
  });
  it("faster greens raise both the make rate and the three-jack rate", () => {
    const med = puttWeights("long", "normal", "Medium");
    const fast = puttWeights("long", "normal", "Fast");
    expect(fast.oneputt).toBeGreaterThan(med.oneputt);
    expect(fast.threeputt).toBeGreaterThan(med.threeputt);
  });
  it("long putts make less often than short ones", () => {
    expect(puttWeights("long", "normal", "Medium").oneputt).toBeLessThan(
      puttWeights("short", "normal", "Medium").oneputt
    );
  });
});

describe("scrambleWeights", () => {
  it("Flop saves more but blows up more than Punch", () => {
    const punch = scrambleWeights("safe", hole, c);
    const flop = scrambleWeights("aggressive", hole, c);
    expect(flop.updown).toBeGreaterThan(punch.updown);
    expect(flop.blowup).toBeGreaterThan(punch.blowup);
  });
});

describe("composeOutcome", () => {
  it("maps green + putt to the right Outcome (regulation)", () => {
    expect(composeOutcome(false, { kind: "putt", result: "oneputt" })).toBe("birdie");
    expect(composeOutcome(false, { kind: "putt", result: "twoputt" })).toBe("par");
    expect(composeOutcome(false, { kind: "putt", result: "threeputt" })).toBe("bogey");
  });
  it("a par-5 reached in two is the only path to eagle", () => {
    expect(composeOutcome(true, { kind: "putt", result: "oneputt" })).toBe("eagle");
    expect(composeOutcome(true, { kind: "putt", result: "twoputt" })).toBe("birdie");
    expect(composeOutcome(true, { kind: "putt", result: "threeputt" })).toBe("par");
  });
  it("maps scramble results: up&down saves par, blow-ups cost", () => {
    expect(composeOutcome(false, { kind: "scramble", result: "updown" })).toBe("par");
    expect(composeOutcome(false, { kind: "scramble", result: "twochip" })).toBe("bogey");
    expect(composeOutcome(false, { kind: "scramble", result: "blowup" })).toBe("double");
    expect(composeOutcome(false, { kind: "scramble", result: "disaster" })).toBe("triple");
  });
  it("clamps to the Outcome range (no worse than triple)", () => {
    // reached-in-two disaster would be +2 -> double, never out of range
    expect(composeOutcome(true, { kind: "scramble", result: "disaster" })).toBe("double");
  });
});

describe("metadata coverage", () => {
  it("every result key has metadata and a putt bucket", () => {
    for (const g of GREEN_RESULTS) expect(GREEN_META[g]).toBeTruthy();
    expect(PUTT_RESULTS.length).toBe(3);
    expect(SCRAMBLE_RESULTS.length).toBe(4);
  });
});
