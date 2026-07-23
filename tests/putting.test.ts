import { describe, it, expect } from "vitest";
import {
  greenWeights,
  puttWeights,
  scrambleWeights,
  composeOutcome,
  puttDistanceModifiers,
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
  it("par-5 layup lean improves wedge proximity while going for it produces longer looks", () => {
    const par4n = greenWeights("fairway", "normal", { number: 1, par: 4, strokeIndex: 9 }, c);
    const par5n = greenWeights("fairway", "normal", { number: 1, par: 5, strokeIndex: 9 }, c);
    const looks = (w: Record<string, number>) => w.kickin + w.makeable;
    // share of birdie-look results (proportions, since pick() normalizes)
    const share = (w: Record<string, number>) =>
      looks(w) / (w.kickin + w.makeable + w.lag + w.scramble);
    expect(share(par5n)).toBeGreaterThan(share(par4n)); // par 5 leans birdie
    // A long par-5 second should leave fewer close looks than a par-4 approach.
    const par4a = greenWeights("fairway", "aggressive", { number: 1, par: 4, strokeIndex: 9 }, c);
    const par5a = greenWeights("fairway", "aggressive", { number: 1, par: 5, strokeIndex: 9 }, c);
    expect(share(par5a)).toBeLessThan(share(par4a));
    expect(par5a.lag + par5a.scramble).toBeGreaterThan(par4a.lag + par4a.scramble);
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
    const lag = puttWeights("short", "safe", "Medium", 12);
    const charge = puttWeights("short", "aggressive", "Medium", 12);
    expect(charge.oneputt).toBeGreaterThan(lag.oneputt);
    expect(charge.threeputt).toBeGreaterThan(lag.threeputt);
  });
  it("faster greens raise both the make rate and the three-jack rate", () => {
    const med = puttWeights("long", "normal", "Medium", 35);
    const fast = puttWeights("long", "normal", "Fast", 35);
    expect(fast.oneputt).toBeGreaterThan(med.oneputt);
    expect(fast.threeputt).toBeGreaterThan(med.threeputt);
  });
  it("long putts make less often than short ones", () => {
    expect(puttWeights("long", "normal", "Medium", 35).oneputt).toBeLessThan(
      puttWeights("short", "normal", "Medium", 12).oneputt
    );
  });
  it("make chance falls and three-putt risk rises with exact distance", () => {
    const six = puttWeights("short", "normal", "Medium", 6);
    const eighteen = puttWeights("short", "normal", "Medium", 18);
    expect(six.oneputt).toBeGreaterThan(eighteen.oneputt);
    expect(six.threeputt).toBeLessThan(eighteen.threeputt);

    const twentyFive = puttWeights("long", "normal", "Medium", 25);
    const fortyFive = puttWeights("long", "normal", "Medium", 45);
    expect(twentyFive.oneputt).toBeGreaterThan(fortyFive.oneputt);
    expect(twentyFive.threeputt).toBeLessThan(fortyFive.threeputt);
  });
  it("distance modifiers average to the calibrated midpoint baseline", () => {
    for (const [bucket, min, max] of [["short", 6, 18], ["long", 25, 45]] as const) {
      const mods = Array.from({ length: max - min + 1 }, (_, i) => puttDistanceModifiers(bucket, min + i));
      expect(mods.reduce((sum, m) => sum + m.make, 0) / mods.length).toBeCloseTo(1);
      expect(mods.reduce((sum, m) => sum + m.three, 0) / mods.length).toBeCloseTo(1);
    }
  });
});

describe("scrambleWeights", () => {
  it("Flop saves more but blows up more than Punch", () => {
    const punch = scrambleWeights("safe", hole, c);
    const flop = scrambleWeights("aggressive", hole, c);
    expect(flop.updown).toBeGreaterThan(punch.updown);
    expect(flop.blowup).toBeGreaterThan(punch.blowup);
  });
  it("keeps the double-plus risk ordered while routine recovery stays in the middle", () => {
    const doublePlus = (decision: "safe" | "normal" | "aggressive") => {
      const weights = scrambleWeights(decision, hole, c);
      return (weights.blowup + weights.disaster) /
        (weights.updown + weights.twochip + weights.blowup + weights.disaster);
    };
    expect(doublePlus("safe")).toBeLessThan(doublePlus("normal"));
    expect(doublePlus("normal")).toBeLessThan(doublePlus("aggressive"));
    expect(doublePlus("normal")).toBeLessThan(0.2);
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
