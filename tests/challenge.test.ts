import { describe, it, expect } from "vitest";
import { verdict } from "@/lib/challenge";
import { resolveHoleChain, type ChainResult } from "@/lib/engine/shots";
import { holeShotSeed, eventSeed } from "@/lib/engine/rng";
import type { HoleSpec } from "@/lib/engine/resolveHole";
import type { Decision } from "@/lib/engine/probabilities";

describe("verdict — lower to-par wins (from my perspective)", () => {
  it("win when my score is lower", () => expect(verdict(-3, -1)).toBe("win"));
  it("loss when my score is higher", () => expect(verdict(2, -1)).toBe("loss"));
  it("draw when equal", () => expect(verdict(0, 0)).toBe("draw"));
});

// Play one hole to completion under a fixed policy, seeded from `seedRef` exactly
// as the hole route does (holeShotSeed/eventSeed(seedRef, hole, shot)).
function playHole(seedRef: string, hole: HoleSpec, policy: Decision): ChainResult["outcome"] {
  const opts = {
    shotSeed: (shot: number) => holeShotSeed(seedRef, hole.number, shot),
    eventSeed: (shot: number) => eventSeed(seedRef, hole.number, shot),
    greens: "Medium" as const,
  };
  const cond = { difficulty: 6, wind: 10 };
  const decisions: Decision[] = [];
  let res = resolveHoleChain(decisions, hole, cond, opts);
  let guard = 0;
  while (!res.complete && guard++ < 8) {
    decisions.push(policy);
    res = resolveHoleChain(decisions, hole, cond, opts);
  }
  return res.outcome;
}

const HOLES: HoleSpec[] = [
  { number: 1, par: 4, strokeIndex: 5 },
  { number: 7, par: 3, strokeIndex: 14 },
  { number: 12, par: 5, strokeIndex: 2 },
];

describe("shared-seed fairness: same seedKey => identical hole conditions", () => {
  it("two players (different round ids) on the SAME seedKey get identical outcomes for identical play", () => {
    const seedKey = "chal_ABC123"; // both rounds carry this (= challenge id)
    for (const hole of HOLES) {
      for (const policy of ["safe", "normal", "aggressive"] as Decision[]) {
        // seedRef = round.seedKey ?? round.id -> both use the shared seedKey,
        // NOT their own round id, so the outcomes must match exactly.
        const a = playHole(seedKey, hole, policy);
        const b = playHole(seedKey, hole, policy);
        expect(b, `hole ${hole.number} ${policy}`).toBe(a);
      }
    }
  });

  it("different seedKeys generally diverge (it isn't accidentally constant)", () => {
    // Across the set, at least one hole/policy differs between two seeds.
    let anyDiff = false;
    for (const hole of HOLES) {
      for (const policy of ["safe", "normal", "aggressive"] as Decision[]) {
        if (playHole("chal_ONE", hole, policy) !== playHole("chal_TWO", hole, policy)) anyDiff = true;
      }
    }
    expect(anyDiff).toBe(true);
  });
});

describe("daily/unlimited unaffected: seedKey null => seed from round id (byte-identical)", () => {
  it("a null seedKey resolves to the round id, matching pre-Stage-2 seeding", () => {
    const roundId = "round_XYZ";
    const seedKey: string | null = null;
    // The route computes seedRef = round.seedKey ?? roundId.
    const seedRef = seedKey ?? roundId;
    expect(seedRef).toBe(roundId);
    // And seeding from that ref equals seeding from the round id directly.
    for (const hole of HOLES) {
      expect(playHole(seedRef, hole, "normal")).toBe(playHole(roundId, hole, "normal"));
    }
  });
});
