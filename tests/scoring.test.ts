import { describe, it, expect } from "vitest";
import {
  relativeLabel,
  parResultLabel,
  brokePar,
  isStreakAlive,
  streakStatus,
  updateStreak,
  tally,
  shareGrid,
  dailyStanding,
  ordinal,
  standingLabel,
  PERCENTILE_MIN_FIELD,
} from "@/lib/scoring";
import type { Outcome } from "@/lib/engine/probabilities";

describe("relativeLabel", () => {
  it("formats even, over and under par", () => {
    expect(relativeLabel(0)).toBe("E");
    expect(relativeLabel(3)).toBe("+3");
    expect(relativeLabel(-2)).toBe("-2");
  });
});

describe("parResultLabel", () => {
  it("reports strokes over par without adding the break-par stroke", () => {
    expect(parResultLabel(2)).toBe("Missed par by 2");
    expect(parResultLabel(3)).toBe("Missed par by 3");
  });

  it("handles even and under-par rounds without awkward zero wording", () => {
    expect(parResultLabel(0)).toBe("Even par");
    expect(parResultLabel(-1)).toBe("Under par ✓");
  });
});

describe("brokePar", () => {
  it("is true only strictly under par", () => {
    expect(brokePar(71, 72)).toBe(true);
    expect(brokePar(72, 72)).toBe(false);
    expect(brokePar(73, 72)).toBe(false);
  });
});

// Today / yesterday / grace (day-before-yesterday) — three strictly-decreasing
// civil dates, the exact key set streakStatus + isStreakAlive consume.
const T = "2026-06-25";
const Y = "2026-06-24";
const G = "2026-06-23"; // grace bridge
const OLD = "2026-06-22"; // two missed days -> dead

describe("streakStatus (mutually exclusive)", () => {
  it("maps each last-played key to exactly one state", () => {
    expect(streakStatus(3, T, T, Y, G)).toBe("played-today");
    expect(streakStatus(3, Y, T, Y, G)).toBe("safe");
    expect(streakStatus(3, G, T, Y, G)).toBe("at-risk");
    expect(streakStatus(3, OLD, T, Y, G)).toBe("none"); // freeze spent
  });

  it("is 'none' with no live streak regardless of key", () => {
    expect(streakStatus(0, T, T, Y, G)).toBe("none");
    expect(streakStatus(5, null, T, Y, G)).toBe("none");
  });

  it("never reports a safe streak as at-risk (no false warning)", () => {
    // The three keys are distinct, so a player who played yesterday is 'safe'
    // and can NEVER also match the grace key -> no spurious warning.
    expect(new Set([T, Y, G]).size).toBe(3);
    for (const last of [T, Y, G, OLD, null]) {
      const states = (["played-today", "safe", "at-risk", "none"] as const).filter(
        (st) => streakStatus(3, last, T, Y, G) === st
      );
      expect(states.length).toBe(1); // exactly one state, always
    }
  });
});

describe("isStreakAlive (one-day freeze window)", () => {
  it("alive today, yesterday, or bridged by the freeze; dead beyond", () => {
    expect(isStreakAlive(3, T, T, Y, G)).toBe(true);
    expect(isStreakAlive(3, Y, T, Y, G)).toBe(true);
    expect(isStreakAlive(3, G, T, Y, G)).toBe(true); // freeze keeps it alive
    expect(isStreakAlive(3, OLD, T, Y, G)).toBe(false); // two misses -> dead
    expect(isStreakAlive(0, T, T, Y, G)).toBe(false); // no streak
    expect(isStreakAlive(3, null, T, Y, G)).toBe(false);
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
      "birdie", "par", "bogey", "eagle", "albatross", "double", "triple",
      "par", "par", "par", "par", "par",
      "par", "par", "par", "par", "par", "par",
    ] as const;
    const t = tally([...outcomes]);
    expect(t.birdiesOrBetter).toBe(3);
    expect(t.bogeysOrWorse).toBe(3);
    expect(t.pars).toBe(12);
    expect(shareGrid([...outcomes]).split("\n")).toHaveLength(2);
  });

  it("emits exactly 18 squares for an 18-hole round, 9 per row", () => {
    const outcomes = Array<Outcome>(18).fill("par");
    const [front, back] = shareGrid(outcomes).split("\n");
    // spread counts code points (each square glyph is one), not UTF-16 units
    expect([...front]).toHaveLength(9);
    expect([...back]).toHaveLength(9);
    expect([...front, ...back]).toHaveLength(18);
  });

  it("stays 18-wide when holeResults are short (blanks fill the gap)", () => {
    const short = Array<Outcome>(16).fill("birdie"); // abandoned/partial round
    const all = [...shareGrid(short).split("\n").join("")];
    expect(all).toHaveLength(18);
  });
});

describe("dailyStanding", () => {
  it("falls back to a rank (not a fabricated %) below the min field", () => {
    // 12 finishers, you're 3rd best -> rank, no percentile
    const s = dailyStanding(2, 12);
    expect(s).toEqual({ kind: "rank", rank: 3, field: 12 });
    expect(standingLabel(s)).toBe("3rd of 12 so far today");
  });

  it("reports Top X% once the field is big enough (strictly-better / field)", () => {
    // 240 finishers, 18 strictly better -> 18/240 = 7.5% -> Top 8%
    const s = dailyStanding(18, 240);
    expect(s).toEqual({ kind: "percentile", topPct: 8, rank: 19, field: 240 });
    expect(standingLabel(s)).toBe("Top 8% so far today");
  });

  it("clamps a leader to Top 1% and never shows Top 0%", () => {
    const s = dailyStanding(0, 100);
    expect(s.kind === "percentile" && s.topPct).toBe(1);
  });

  it("uses rank phrasing (not a high %) for the bottom half", () => {
    // 240 finishers, 141 better -> Top 59% would be a confusing humblebrag
    const s = dailyStanding(141, 240);
    expect(s.kind === "percentile" && s.topPct).toBe(59);
    expect(standingLabel(s)).toBe("142nd of 240 so far today");
  });

  it("ties do not count against you (only strictly-better do)", () => {
    // 100 finishers, 9 better, several tied with you -> still 9/100 -> Top 9%
    const s = dailyStanding(9, 100);
    expect(s.kind === "percentile" && s.topPct).toBe(9);
  });

  it("the threshold is the documented constant", () => {
    expect(dailyStanding(0, PERCENTILE_MIN_FIELD - 1).kind).toBe("rank");
    expect(dailyStanding(0, PERCENTILE_MIN_FIELD).kind).toBe("percentile");
  });
});

describe("ordinal", () => {
  it("handles the teens and the 1/2/3 suffixes", () => {
    expect(["1st", "2nd", "3rd", "4th"].map((_, i) => ordinal(i + 1))).toEqual(["1st", "2nd", "3rd", "4th"]);
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(102)).toBe("102nd");
  });
});
