import { describe, expect, it } from "vitest";
import { resolveHoleChain, type ChainResult } from "@/lib/engine/shots";
import type { Decision } from "@/lib/engine/probabilities";
import type { HoleSpec } from "@/lib/engine/resolveHole";
import { scrambleWeights } from "@/lib/engine/putting";
import {
  STANDARD_V1_RULESET,
  STANDARD_V2_RULESET,
  STANDARD_V3_RULESET,
} from "@/lib/engine/rulesets";
import { applyCareerShortGameRank } from "@/lib/career/development";

const conditions = { difficulty: 6, wind: 10 };
const par4: HoleSpec = { number: 6, par: 4, strokeIndex: 9, yardage: 410 };

function playSafe(base: number): ChainResult {
  const decisions: Decision[] = [];
  const opts = {
    shotSeed: (i: number) => ((base * 2654435761 + i * 40503 + 1) >>> 0) || 1,
    eventSeed: (i: number) => ((base * 374761393 + i * 668265263 + 7) >>> 0) || 1,
    greens: "Medium" as const,
    hazardPenalties: false,
    scoringEvents: false,
  };
  let result = resolveHoleChain(decisions, par4, conditions, opts);
  let guard = 0;
  while (!result.complete && guard++ < 6) {
    decisions.push("safe");
    result = resolveHoleChain(decisions, par4, conditions, opts);
  }
  return result;
}

describe("casual scoring path gates", () => {
  it("safe tee to fairway plus safe continuation keeps the catastrophic tail tiny", () => {
    let fairways = 0;
    let doubleOrWorse = 0;
    for (let seed = 1; seed <= 10_000; seed++) {
      const result = playSafe(seed);
      if (result.shots[0]?.lie !== "fairway") continue;
      fairways++;
      if ((result.scoreDelta ?? 0) >= 2) doubleOrWorse++;
    }
    expect(fairways).toBeGreaterThan(5_000);
    expect(doubleOrWorse / fairways).toBeLessThan(0.02);
  });

  it("an unpenalized all-safe path never reaches triple", () => {
    for (let seed = 1; seed <= 10_000; seed++) {
      expect(playSafe(seed).scoreDelta).toBeLessThan(3);
    }
  });
});

describe("recovery ladder (standard-v3)", () => {
  const decisions: Decision[] = ["safe", "normal", "aggressive"];
  const holes: HoleSpec[] = [
    { number: 1, par: 3, strokeIndex: 11, yardage: 180 },
    { number: 2, par: 4, strokeIndex: 1, yardage: 470 },
    { number: 3, par: 5, strokeIndex: 7, yardage: 560 },
  ];
  const hardest = { difficulty: 10, wind: 30 };

  it("caps the ordinary Chip at a double under every condition", () => {
    for (const hole of holes) {
      for (const conditionSet of [{ difficulty: 0, wind: 0 }, conditions, hardest]) {
        for (const drivableMiss of [false, true]) {
          const weights = scrambleWeights(
            "normal",
            hole,
            conditionSet,
            drivableMiss,
            STANDARD_V3_RULESET,
          );
          // `disaster` is the ONLY independent path to a triple. Chip must not
          // have one — difficulty, wind, and the drivable-par-4 penalty all
          // scale multiplicatively, so zero has to stay zero.
          expect(weights.disaster).toBe(0);
          // It must still be able to cost a shot or two: capping is not removing.
          expect(weights.blowup).toBeGreaterThan(0);
          expect(weights.twochip).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps the Chip triple path at zero through every Career Short Game rank", () => {
    const base = scrambleWeights(
      "normal",
      holes[1],
      hardest,
      true,
      STANDARD_V3_RULESET,
    );
    for (const rank of [1, 2, 3, 4, 5]) {
      const ranked = applyCareerShortGameRank(base, rank);
      expect(ranked.disaster).toBe(0);
      expect(ranked.blowup).toBeGreaterThan(0);
    }
  });

  it("keeps Punch fully protected and Flop genuinely dangerous", () => {
    const punch = scrambleWeights("safe", holes[1], conditions, false, STANDARD_V3_RULESET);
    expect(punch.blowup).toBe(0);
    expect(punch.disaster).toBe(0);

    const flop = scrambleWeights("aggressive", holes[1], conditions, false, STANDARD_V3_RULESET);
    expect(flop.disaster).toBeGreaterThan(0);
    expect(flop.blowup).toBeGreaterThan(0);
  });

  it("orders the ladder Punch < Chip < Flop by blow-up risk", () => {
    const share = (decision: Decision) => {
      const w = scrambleWeights(decision, holes[1], conditions, false, STANDARD_V3_RULESET);
      const total = w.updown + w.twochip + w.blowup + w.disaster;
      return (w.blowup + w.disaster) / total;
    };
    expect(share("safe")).toBeLessThan(share("normal"));
    expect(share("normal")).toBeLessThan(share("aggressive"));
  });

  it("leaves already-played rulesets exactly as they were", () => {
    const weights = (decision: Decision, version: typeof STANDARD_V1_RULESET
      | typeof STANDARD_V2_RULESET | typeof STANDARD_V3_RULESET) =>
      scrambleWeights(decision, holes[1], conditions, false, version);

    // v3 changes Chip and NOTHING else, so Punch and Flop are byte-identical
    // to v2 — a deployment cannot quietly move an untouched option.
    for (const decision of ["safe", "aggressive"] as Decision[]) {
      expect(weights(decision, STANDARD_V3_RULESET))
        .toEqual(weights(decision, STANDARD_V2_RULESET));
    }

    // The regression this release exists to fix: v2's Chip could make a triple
    // on its own. v3's cannot. Both older rulesets keep their original maths so
    // a stored round replays exactly as it was played.
    expect(weights("normal", STANDARD_V1_RULESET).disaster).toBeGreaterThan(0);
    expect(weights("normal", STANDARD_V2_RULESET).disaster).toBeGreaterThan(0);
    expect(weights("normal", STANDARD_V3_RULESET).disaster).toBe(0);
    // v1 never had the Punch protection; v2 and v3 both do.
    expect(weights("safe", STANDARD_V1_RULESET).blowup).toBeGreaterThan(0);
    expect(weights("safe", STANDARD_V2_RULESET).blowup).toBe(0);
  });
});
