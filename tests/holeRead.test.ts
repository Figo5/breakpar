import { describe, it, expect } from "vitest";
import {
  holeCues,
  riskRead,
  lieRiskRead,
  situationRead,
  difficultyBucket,
  greenRead,
  puttRead,
  puttForLabel,
  AGGRESSIVE_BUDGET,
} from "@/lib/holeRead";
import type { CourseHole } from "@/data/courses";

const gettable: CourseHole = { number: 5, par: 5, yardage: 500, strokeIndex: 16, dogleg: "S", hazard: "none" };
const brutal: CourseHole = { number: 8, par: 4, yardage: 470, strokeIndex: 1, dogleg: "L", hazard: "water" };

const easyConds = { difficulty: 3, wind: 5 };
const hardConds = { difficulty: 9, wind: 22 };

describe("putt labels reflect what the putt is FOR (not the distance bucket)", () => {
  it("puttForLabel maps outcome -> label per the eagle/birdie/par/bogey spec", () => {
    expect(puttForLabel("eagle")).toBe("Eagle look");
    expect(puttForLabel("birdie")).toBe("Birdie look");
    expect(puttForLabel("par")).toBe("Par putt");
    expect(puttForLabel("bogey")).toBe("Bogey putt");
  });

  it("greenRead('makeable') reads Eagle for an eagle putt, Birdie otherwise", () => {
    expect(greenRead("makeable", "eagle").text).toBe("Eagle look");
    expect(greenRead("makeable", "birdie").text).toBe("Birdie look");
    // back-compat: no puttFor supplied -> old birdie default
    expect(greenRead("makeable").text).toBe("Birdie look");
  });

  it("puttRead short cue names the putt by what it's FOR", () => {
    const eagle = puttRead("short", 8, "L", "flat", "Medium", "eagle");
    expect(eagle.cues[0].text).toMatch(/Eagle look/);
    const birdie = puttRead("short", 8, "L", "flat", "Medium", "birdie");
    expect(birdie.cues[0].text).toMatch(/Birdie look/);
    // long putts stay neutral (no birdie/eagle claim) regardless of puttFor
    expect(puttRead("long", 40, "L", "flat", "Medium", "eagle").cues[0].text).toMatch(/Long putt/);
  });
});

describe("difficultyBucket", () => {
  it("rates an easy hole lower than a brutal one", () => {
    expect(difficultyBucket(gettable, easyConds)).toBeLessThan(difficultyBucket(brutal, hardConds));
  });
});

describe("holeCues", () => {
  it("leads with a difficulty read and surfaces hazards, capped to 4", () => {
    const cues = holeCues(brutal, hardConds, "Fast");
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.length).toBeLessThanOrEqual(4);
    expect(cues.some((c) => /water/i.test(c.text))).toBe(true);
  });
});

describe("riskRead", () => {
  it("flags aggressive on a brutal hole as dangerous, safe as bankable", () => {
    expect(riskRead("aggressive", brutal, hardConds).tone).toBe("bad");
    expect(riskRead("safe", brutal, hardConds).tone).toBe("good");
  });
  it("greenlights aggressive on a gettable hole", () => {
    expect(riskRead("aggressive", gettable, easyConds).tone).toBe("good");
  });
});

describe("lieRiskRead", () => {
  it("greenlights going for it from a perfect lie, warns from trouble", () => {
    expect(lieRiskRead("dialed", "aggressive").tone).toBe("good");
    expect(lieRiskRead("trouble", "aggressive").tone).toBe("bad");
  });
  it("frames safe from trouble as a punch-out", () => {
    expect(lieRiskRead("trouble", "safe").text).toMatch(/punch/i);
  });
});

describe("situationRead", () => {
  it("urges protection when under par late", () => {
    expect(situationRead(-2, 4)?.tone).toBe("good");
  });
  it("urges a move when over par late", () => {
    expect(situationRead(2, 3)?.tone).toBe("bad");
  });
  it("stays quiet early with a neutral card", () => {
    expect(situationRead(0, 15)).toBeNull();
  });
});

describe("budget", () => {
  it("is a small positive allowance", () => {
    expect(AGGRESSIVE_BUDGET).toBeGreaterThan(0);
    expect(AGGRESSIVE_BUDGET).toBeLessThanOrEqual(18);
  });
});
