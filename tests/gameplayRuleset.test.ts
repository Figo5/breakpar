import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { HoleHazardContext } from "@/lib/engine/hazards";
import type { Decision, Outcome } from "@/lib/engine/probabilities";
import type { HoleSpec } from "@/lib/engine/resolveHole";
import {
  GAMEPLAY_RULESET_VERSIONS,
  STANDARD_V1_RULESET,
  STANDARD_V2_RULESET,
  gameplayRulesetLabel,
  hasClientRulesetOverride,
  requirePinnedGameplayRuleset,
  requireGameplayRulesetVersion,
} from "@/lib/engine/rulesets";
import {
  canReachPar5InTwo,
  resolveHoleChain,
  type ChainOpts,
} from "@/lib/engine/shots";
import { puttWeights, scrambleWeights } from "@/lib/engine/putting";

type GoldenHole = HoleSpec & {
  hazard: NonNullable<HoleHazardContext["hazard"]>;
};

const GOLDEN_HOLES: readonly GoldenHole[] = [
  { number: 3, par: 3, strokeIndex: 17, yardage: 137, hazard: "water" },
  { number: 4, par: 4, strokeIndex: 11, yardage: 340, hazard: "sand" },
  { number: 9, par: 4, strokeIndex: 1, yardage: 458, hazard: "sand" },
  { number: 12, par: 5, strokeIndex: 9, yardage: 543, hazard: "water" },
  { number: 18, par: 5, strokeIndex: 2, yardage: 599, hazard: "ocean" },
];

/**
 * Golden serialization generated directly from baseline HEAD 8491d7f. It
 * covers 1,000 complete holes plus every intermediate descriptor, including
 * notes, hazards, events, lies, putt geometry, strokes, and outcomes.
 */
function legacyTranscript(): { hash: string; bytes: number } {
  const choices: readonly Decision[] = ["safe", "normal", "aggressive"];
  const transcript: unknown[] = [];
  for (const hole of GOLDEN_HOLES) {
    for (let base = 1; base <= 200; base++) {
      const selected: Decision[] = [];
      const snapshots: unknown[] = [];
      const opts: ChainOpts = {
        shotSeed: (shot: number) =>
          (base * 1_000_003 + hole.number * 97 + shot * 7919) >>> 0,
        eventSeed: (shot: number) =>
          (base * 2_000_033 + hole.number * 193 + shot * 104729) >>> 0,
        hazardSeed: (shot: number) =>
          (base * 3_000_017 + hole.number * 389 + shot * 15485863) >>> 0,
        scoringEventSeed: (shot: number) =>
          (base * 4_000_037 + hole.number * 769 + shot * 32452843) >>> 0,
        greens: (["Slow", "Medium", "Firm", "Fast"] as const)[base % 4],
        recent: [] as Outcome[],
        narration: true,
        holeYards: hole.yardage,
        holeContext: {
          hazard: hole.hazard,
          signature: hole.number === 3 ? "Island test" : undefined,
        },
        rulesetVersion: STANDARD_V1_RULESET,
      };
      const conditions = {
        difficulty: (base % 10) + 1,
        wind: (base * 3) % 18,
      };
      let result = resolveHoleChain(selected, hole, conditions, opts);
      snapshots.push(result);
      let guard = 0;
      while (!result.complete && guard++ < 6) {
        selected.push(choices[(base + hole.number + selected.length) % choices.length]);
        result = resolveHoleChain(selected, hole, conditions, opts);
        snapshots.push(result);
      }
      transcript.push({ hole: hole.number, base, selected, snapshots });
    }
  }
  const json = JSON.stringify(transcript);
  return {
    hash: createHash("sha256").update(json).digest("hex"),
    bytes: json.length,
  };
}

describe("immutable gameplay rulesets", () => {
  it("keeps the pre-fairness engine byte-identical to baseline HEAD", () => {
    expect(legacyTranscript()).toEqual({
      hash: "6dee1a60870b722fe103565255f32096b13f12d32ff133c852450f5d767adf19",
      bytes: 1_417_264,
    });
  });

  it("recognizes only registered immutable IDs", () => {
    expect(GAMEPLAY_RULESET_VERSIONS).toEqual([
      "standard-v1",
      "standard-v2-casual",
    ]);
    expect(requireGameplayRulesetVersion("standard-v1")).toBe(STANDARD_V1_RULESET);
    expect(() => requireGameplayRulesetVersion("classic-launch-v1")).toThrow(
      "Unsupported gameplay ruleset",
    );
    expect(gameplayRulesetLabel(STANDARD_V1_RULESET)).toBe("Standard v1");
    expect(gameplayRulesetLabel(STANDARD_V2_RULESET)).toBe("Standard");
    expect(hasClientRulesetOverride({})).toBe(false);
    expect(hasClientRulesetOverride({ rulesetVersion: null })).toBe(true);
    expect(hasClientRulesetOverride({ rulesetVersion: STANDARD_V2_RULESET })).toBe(true);
  });

  it("keeps Tournament rounds on their official stored ruleset", () => {
    expect(requirePinnedGameplayRuleset(STANDARD_V1_RULESET)).toBe(
      STANDARD_V1_RULESET,
    );
    expect(
      requirePinnedGameplayRuleset(STANDARD_V2_RULESET, STANDARD_V2_RULESET),
    ).toBe(STANDARD_V2_RULESET);
    expect(() =>
      requirePinnedGameplayRuleset(STANDARD_V1_RULESET, STANDARD_V2_RULESET)
    ).toThrow("does not match official");
    expect(() => requirePinnedGameplayRuleset("practice-only-forgery")).toThrow(
      "Unsupported gameplay ruleset",
    );
  });

  it("dispatches the intended fairness differences without changing v1", () => {
    const hole = { number: 4, par: 4, strokeIndex: 11, yardage: 340 };
    const conditions = { difficulty: 5, wind: 8 };
    const seeds = (rulesetVersion: typeof STANDARD_V1_RULESET | typeof STANDARD_V2_RULESET) => ({
      shotSeed: (shot: number) => 100 + shot,
      eventSeed: (shot: number) => 200 + shot,
      rulesetVersion,
    });

    const v1 = resolveHoleChain(
      ["aggressive"],
      hole,
      conditions,
      seeds(STANDARD_V1_RULESET),
    );
    const v2 = resolveHoleChain(
      ["aggressive"],
      hole,
      conditions,
      seeds(STANDARD_V2_RULESET),
    );
    expect(v1.next).toBe("approach");
    expect(v2.next).not.toBe("approach");

    expect(canReachPar5InTwo(
      5,
      "rough",
      "aggressive",
      235,
      STANDARD_V1_RULESET,
    )).toBe(false);
    expect(canReachPar5InTwo(
      5,
      "rough",
      "aggressive",
      235,
      STANDARD_V2_RULESET,
    )).toBe(true);

    expect(
      puttWeights(
        "long",
        "safe",
        "Medium",
        35,
        "straight",
        "flat",
        STANDARD_V1_RULESET,
      ),
    ).toEqual({ oneputt: 4, twoputt: 83, threeputt: 9 });
    expect(
      puttWeights(
        "long",
        "safe",
        "Medium",
        35,
        "straight",
        "flat",
        STANDARD_V2_RULESET,
      ),
    ).toEqual({ oneputt: 4, twoputt: 90, threeputt: 6 });

    expect(scrambleWeights(
      "safe",
      hole,
      conditions,
      false,
      STANDARD_V1_RULESET,
    ).blowup).toBeGreaterThan(0);
    expect(scrambleWeights(
      "safe",
      hole,
      conditions,
      false,
      STANDARD_V2_RULESET,
    ).blowup).toBe(0);
  });
});
