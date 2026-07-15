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

// --- Putting / approach / short-game reveals (Will's request, Jul 7) --------
import {
  puttOddsReveal,
  puttOddsTakeaway,
  approachOddsReveal,
  scrambleOddsReveal,
} from "@/lib/oddsReveal";

describe("puttOddsReveal", () => {
  it("returns all three putt decisions with percentages summing to 100", () => {
    for (const bucket of ["short", "long"] as const) {
      const r = puttOddsReveal(bucket, "Medium", bucket === "short" ? 12 : 35);
      for (const row of [r.safe, r.normal, r.aggressive]) {
        expect(row.onePct + row.twoPct + row.threePct, `${bucket} ${row.label}`).toBe(100);
      }
    }
  });

  it("Charge makes more one-putts than Lag", () => {
    const r = puttOddsReveal("short", "Medium", 12);
    expect(r.aggressive.onePct).toBeGreaterThan(r.safe.onePct);
  });

  it("Lag three-putts less than Charge (protects the three-jack)", () => {
    const r = puttOddsReveal("long", "Medium", 35);
    expect(r.safe.threePct).toBeLessThan(r.aggressive.threePct);
  });

  it("faster greens raise the three-putt rate", () => {
    const slow = puttOddsReveal("long", "Slow", 35);
    const fast = puttOddsReveal("long", "Fast", 35);
    expect(fast.aggressive.threePct).toBeGreaterThan(slow.aggressive.threePct);
  });

  it("takeaway is a non-empty string for each decision", () => {
    for (const d of ["safe", "normal", "aggressive"] as const) {
      expect(puttOddsTakeaway(d, "short", "Medium", 12).length).toBeGreaterThan(0);
    }
  });

  it("shows materially different make odds at different exact distances", () => {
    expect(puttOddsReveal("short", "Medium", 6).normal.onePct).toBeGreaterThan(
      puttOddsReveal("short", "Medium", 18).normal.onePct
    );
    expect(puttOddsReveal("long", "Medium", 25).normal.onePct).toBeGreaterThan(
      puttOddsReveal("long", "Medium", 45).normal.onePct
    );
  });
});

describe("approachOddsReveal", () => {
  const hole2: HoleSpec = { number: 5, par: 4, strokeIndex: 6 };
  it("percentages sum to 100 and greenPct = kickin+makeable+lag", () => {
    const r = approachOddsReveal("fairway", hole2, conditions);
    for (const row of [r.safe, r.normal, r.aggressive]) {
      expect(row.kickinPct + row.makeablePct + row.lagPct + row.scramblePct).toBe(100);
      expect(row.greenPct).toBe(row.kickinPct + row.makeablePct + row.lagPct);
    }
  });
  it("aggressive misses the green more than safe", () => {
    const r = approachOddsReveal("fairway", hole2, conditions);
    expect(r.aggressive.scramblePct).toBeGreaterThan(r.safe.scramblePct);
  });
});

describe("scrambleOddsReveal", () => {
  const hole3: HoleSpec = { number: 8, par: 4, strokeIndex: 2 };
  it("percentages sum to 100", () => {
    const r = scrambleOddsReveal(hole3, conditions);
    for (const row of [r.safe, r.normal, r.aggressive]) {
      expect(row.updownPct + row.twochipPct + row.blowupPct + row.disasterPct).toBe(100);
    }
  });
  it("Flop saves more than Punch but blows up more", () => {
    const r = scrambleOddsReveal(hole3, conditions);
    expect(r.aggressive.savePct).toBeGreaterThan(r.safe.savePct);
    expect(r.aggressive.blowupPct + r.aggressive.disasterPct).toBeGreaterThan(r.safe.blowupPct + r.safe.disasterPct);
  });
});
