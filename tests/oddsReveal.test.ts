import { describe, it, expect } from "vitest";
import { teeOddsReveal, teeOddsTakeaway } from "@/lib/oddsReveal";
import type { HoleSpec, Conditions } from "@/lib/engine/resolveHole";

const hole: HoleSpec = { number: 1, par: 4, strokeIndex: 10 };
const conditions: Conditions = { difficulty: 6, wind: 8 };

describe("teeOddsReveal", () => {
  it("returns odds for all three decisions", () => {
    const r = teeOddsReveal(hole, conditions);
    expect(r.safe).toBeDefined();
    expect(r.normal).toBeDefined();
    expect(r.aggressive).toBeDefined();
  });

  it("percentages sum to exactly 100 for each decision", () => {
    const r = teeOddsReveal(hole, conditions);
    for (const row of [r.safe, r.normal, r.aggressive]) {
      const sum = row.pct.dialed + row.pct.fairway + row.pct.rough + row.pct.trouble;
      expect(sum).toBe(100);
    }
  });

  it("safe finds the short grass more often than aggressive", () => {
    const r = teeOddsReveal(hole, conditions);
    expect(r.safe.goodPct).toBeGreaterThan(r.aggressive.goodPct);
  });

  it("aggressive carries more trouble risk than safe", () => {
    const r = teeOddsReveal(hole, conditions);
    expect(r.aggressive.troublePct).toBeGreaterThan(r.safe.troublePct);
  });

  it("goodPct equals dialed + fairway", () => {
    const r = teeOddsReveal(hole, conditions);
    expect(r.normal.goodPct).toBe(r.normal.pct.dialed + r.normal.pct.fairway);
  });
});

describe("teeOddsTakeaway", () => {
  it("safe takeaway mentions the lowest trouble risk framing", () => {
    const t = teeOddsTakeaway("safe", hole, conditions);
    expect(t.toLowerCase()).toContain("safe");
    expect(t.toLowerCase()).toContain("variance");
  });

  it("aggressive takeaway explains the trade and that the decision shifted odds", () => {
    const t = teeOddsTakeaway("aggressive", hole, conditions);
    expect(t.toLowerCase()).toContain("shifted the odds");
  });

  it("produces a non-empty sentence for every decision", () => {
    for (const d of ["safe", "normal", "aggressive"] as const) {
      expect(teeOddsTakeaway(d, hole, conditions).length).toBeGreaterThan(20);
    }
  });
});
