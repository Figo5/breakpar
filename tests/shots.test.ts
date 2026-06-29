import { describe, it, expect } from "vitest";
import {
  resolveHoleChain,
  teeWeights,
  MAX_DECISIONS,
  approachDecisionCount,
  countTeeApproachAggressive,
  stagePrompt,
  type Lie,
  type ChainResult,
} from "@/lib/engine/shots";
import type { HoleSpec } from "@/lib/engine/resolveHole";
import type { Decision } from "@/lib/engine/probabilities";

const par4: HoleSpec = { number: 1, par: 4, strokeIndex: 9 };
const par3: HoleSpec = { number: 7, par: 3, strokeIndex: 14 };
const par5: HoleSpec = { number: 18, par: 5, strokeIndex: 11 };
const conditions = { difficulty: 6, wind: 10 };
const LIES: Lie[] = ["dialed", "fairway", "rough", "trouble"];

// deterministic seed fns built from a base
const seeds = (base: number) => ({
  shotSeed: (i: number) => ((base * 2654435761 + i * 40503 + 1) >>> 0) || 1,
  eventSeed: (i: number) => ((base * 374761393 + i * 668265263 + 7) >>> 0) || 1,
  greens: "Medium" as const,
});

/** Drive a hole to completion with a fixed policy + seeds. */
function playToEnd(hole: HoleSpec, base: number, policy: (s: ChainResult) => Decision): ChainResult {
  const opts = seeds(base);
  const decisions: Decision[] = [];
  let res = resolveHoleChain(decisions, hole, conditions, opts);
  let guard = 0;
  while (!res.complete && guard++ < 6) {
    decisions.push(policy(res));
    res = resolveHoleChain(decisions, hole, conditions, opts);
  }
  return res;
}

describe("teeWeights", () => {
  it("aggressive risks trouble more than safe; safe finds fairway more", () => {
    const safe = teeWeights("safe", par4, conditions);
    const aggro = teeWeights("aggressive", par4, conditions);
    expect(aggro.trouble).toBeGreaterThan(safe.trouble);
    expect(aggro.dialed).toBeGreaterThan(safe.dialed);
    for (const v of Object.values(aggro)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("resolveHoleChain — par 4 stage chain", () => {
  it("asks for the tee shot first, then the approach", () => {
    const opts = seeds(11);
    const s0 = resolveHoleChain([], par4, conditions, opts);
    expect(s0.complete).toBe(false);
    expect(s0.next).toBe("tee");

    const s1 = resolveHoleChain(["normal"], par4, conditions, opts);
    expect(s1.complete).toBe(false);
    expect(s1.next).toBe("approach");
    expect(LIES).toContain(s1.lie);
  });

  it("plays through to a final Outcome capped at MAX_DECISIONS", () => {
    const res = playToEnd(par4, 42, () => "normal");
    expect(res.complete).toBe(true);
    expect(res.outcome).toBeTruthy();
    expect(res.strokes).toBe(par4.par + res.scoreDelta!);
    expect(res.shots.filter((s) => s.decision).length).toBeLessThanOrEqual(MAX_DECISIONS);
  });
});

describe("resolveHoleChain — par 3 plays unlike par 4", () => {
  it("first decision IS the approach (no separate tee/lie)", () => {
    const s0 = resolveHoleChain([], par3, conditions, seeds(5));
    expect(s0.next).toBe("approach");
    expect(s0.lie).toBeUndefined();
    const s1 = resolveHoleChain(["normal"], par3, conditions, seeds(5));
    // either done (kick-in) or onto a putt/scramble
    expect(s1.green).toBeTruthy();
  });
});

describe("kick-in auto-resolves (fewer clicks)", () => {
  it("a kick-in finishes the hole without a putt decision", () => {
    // search for a seed whose dialed+aggressive approach yields a kick-in
    let found: ChainResult | null = null;
    for (let b = 1; b < 4000 && !found; b++) {
      const r = resolveHoleChain(["aggressive", "aggressive"], par4, conditions, seeds(b));
      if (r.complete && r.green === "kickin") found = r;
    }
    expect(found).toBeTruthy();
    const auto = found!.shots.find((s) => s.index === -1 && s.decision === null);
    expect(auto).toBeTruthy(); // the auto tap-in
    expect(auto!.puttResult).toBe("oneputt");
    expect(found!.used).toBe(2); // tee + approach only — no third click
  });
});

describe("determinism (anti re-roll)", () => {
  it("same decisions + seeds reproduce the identical chain, events and notes", () => {
    const a = resolveHoleChain(["aggressive", "normal", "normal"], par5, conditions, seeds(99));
    const b = resolveHoleChain(["aggressive", "normal", "normal"], par5, conditions, seeds(99));
    expect(a).toEqual(b);
    // the tee result is stable whether or not later shots are included
    const tee = resolveHoleChain(["aggressive"], par5, conditions, seeds(99));
    if (!tee.complete && a.shots[0]) expect(tee.shots[0].lie).toBe(a.shots[0].lie);
  });

  it("every resolved shot carries a play-by-play note", () => {
    const res = playToEnd(par4, 7, (s) => (s.next === "scramble" ? "normal" : "normal"));
    for (const s of res.shots) expect(s.note.length).toBeGreaterThan(0);
  });
});

describe("budget counts tee/approach only (putts are free)", () => {
  it("approachDecisionCount: par 3 has 1, par 4/5 have 2", () => {
    expect(approachDecisionCount(3)).toBe(1);
    expect(approachDecisionCount(4)).toBe(2);
    expect(approachDecisionCount(5)).toBe(2);
  });
  it("a 'Charge' (aggressive) putt is NOT charged to the budget", () => {
    // par 4: tee=aggressive, approach=normal, putt=aggressive -> only 1 counts
    expect(countTeeApproachAggressive("aggressive,normal,aggressive", 4)).toBe(1);
    // par 3: approach=aggressive, putt=aggressive -> only 1 counts
    expect(countTeeApproachAggressive("aggressive,aggressive", 3)).toBe(1);
    // both tee + approach aggressive -> 2 counts
    expect(countTeeApproachAggressive("aggressive,aggressive,safe", 5)).toBe(2);
  });
});

describe("par-5 layup birdie lean", () => {
  // Same strokeIndex so difficulty is identical — the only difference is par.
  const p4: HoleSpec = { number: 1, par: 4, strokeIndex: 9 };
  const p5: HoleSpec = { number: 1, par: 5, strokeIndex: 9 };
  const birdieRate = (hole: HoleSpec, approach: Decision) => {
    let b = 0;
    const N = 4000;
    for (let base = 1; base <= N; base++)
      if (playToEnd(hole, base, (s) => (s.next === "approach" ? approach : "normal")).outcome === "birdie") b++;
    return b / N;
  };
  it("a normally-played par 5 births more than a par 4 (plays like a par 5)", () => {
    expect(birdieRate(p5, "normal")).toBeGreaterThan(birdieRate(p4, "normal"));
  });
  it("par 4 birdie rate is unchanged by the lean (lean is par-5 only)", () => {
    // par 4 never reaches the par-5 branch; its rate equals the pre-lean ~22%.
    const r = birdieRate(p4, "normal");
    expect(r).toBeGreaterThan(0.15);
    expect(r).toBeLessThan(0.27);
  });
});

describe("stagePrompt", () => {
  it("labels each stage distinctly", () => {
    expect(stagePrompt("tee", 4)).toMatch(/tee/i);
    expect(stagePrompt("approach", 4)).toMatch(/approach/i);
    expect(stagePrompt("approach", 3)).toMatch(/tee/i); // par 3 tee = approach
    expect(stagePrompt("putt", 4)).toMatch(/putt/i);
    expect(stagePrompt("scramble", 4)).toMatch(/up and down/i);
  });
});
