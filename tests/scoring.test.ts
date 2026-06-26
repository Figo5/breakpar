import { describe, it, expect } from "vitest";
import {
  relativeLabel,
  brokePar,
  isStreakAlive,
  updateStreak,
  tally,
  shareGrid,
  percentileFromRank,
} from "@/lib/scoring";

describe("relativeLabel", () => {
  it("formats even, over and under par", () => {
    expect(relativeLabel(0)).toBe("E");
    expect(relativeLabel(3)).toBe("+3");
    expect(relativeLabel(-2)).toBe("-2");
  });
});

describe("brokePar", () => {
  it("is true only strictly under par", () => {
    expect(brokePar(71, 72)).toBe(true);
    expect(brokePar(72, 72)).toBe(false);
    expect(brokePar(73, 72)).toBe(false);
  });
});

describe("isStreakAlive", () => {
  it("alive when last played is today or yesterday, dead otherwise", () => {
    expect(isStreakAlive("2026-06-25", "2026-06-25", "2026-06-24")).toBe(true);
    expect(isStreakAlive("2026-06-24", "2026-06-25", "2026-06-24")).toBe(true);
    expect(isStreakAlive("2026-06-23", "2026-06-25", "2026-06-24")).toBe(false);
    expect(isStreakAlive(null, "2026-06-25", "2026-06-24")).toBe(false);
  });
});

describe("updateStreak", () => {
  it("starts a streak from null", () => {
    const s = updateStreak(null, -1, false);
    expect(s).toMatchObject({ daysPlayed: 1, currentStreak: 1, maxStreak: 1, underParStreak: 1 });
    expect(s.bestScore).toBe(-1);
  });

  it("continues a consecutive streak and tracks max", () => {
    let s = updateStreak(null, 2, false); // day 1, over par
    s = updateStreak(s, -1, true); // day 2, consecutive, under par
    s = updateStreak(s, 0, true); // day 3, consecutive, even (not under par)
    expect(s.currentStreak).toBe(3);
    expect(s.maxStreak).toBe(3);
    expect(s.underParStreak).toBe(0); // reset by the even round
    expect(s.bestScore).toBe(-1); // best held across days
  });

  it("resets currentStreak on a missed day but keeps maxStreak", () => {
    let s = updateStreak(null, 0, false);
    s = updateStreak(s, 0, true); // streak 2
    const broken = updateStreak(s, 1, false); // missed a day -> reset
    expect(broken.currentStreak).toBe(1);
    expect(broken.maxStreak).toBe(2);
  });
});

describe("tally + shareGrid", () => {
  it("buckets outcomes by tone and builds a 2-line grid", () => {
    const outcomes = [
      "birdie", "par", "bogey", "eagle", "double", "triple",
      "par", "par", "par", "par", "par", "par",
      "par", "par", "par", "par", "par", "par",
    ] as const;
    const t = tally([...outcomes]);
    expect(t.birdiesOrBetter).toBe(2);
    expect(t.bogeysOrWorse).toBe(3);
    expect(t.pars).toBe(13);
    expect(shareGrid([...outcomes]).split("\n")).toHaveLength(2);
  });
});

describe("percentileFromRank", () => {
  it("clamps to 1..99 and rounds", () => {
    expect(percentileFromRank(1, 1000)).toBe(1); // best -> top 1%
    expect(percentileFromRank(1000, 1000)).toBe(99); // worst clamped
    expect(percentileFromRank(50, 100)).toBe(50);
  });
});
