import { describe, it, expect } from "vitest";
import {
  evaluateTrophies,
  summarizeRounds,
  TROPHIES,
  type TrophyStats,
  type RoundLite,
} from "@/lib/trophies";

const ZERO: TrophyStats = {
  roundsPlayed: 0,
  brokePar: false,
  bestUnderPar: 0,
  subParCourses: 0,
  playedCourses: 0,
  coursesTotal: 18,
  hasBirdie: false,
  hasEagle: false,
  maxStreak: 0,
  maxBirdiesInRound: 0,
  bestHolesAtOrUnderPar: 0,
};

const state = (stats: Partial<TrophyStats>, id: string) => {
  const s = evaluateTrophies({ ...ZERO, ...stats }).find((x) => x.id === id);
  if (!s) throw new Error(`no trophy ${id}`);
  return s;
};

describe("trophies — earned triggers (one per trophy)", () => {
  it("nothing earned on a blank slate (except none)", () => {
    const earned = evaluateTrophies(ZERO).filter((s) => s.earned);
    expect(earned).toHaveLength(0);
  });

  // 🏌️ Breaking Par
  it("broke-par: any sub-par round", () => {
    expect(state({ brokePar: true, bestUnderPar: 1 }, "broke-par").earned).toBe(true);
  });
  it("round-3 / -5 / -8 / -12 fire at their thresholds", () => {
    expect(state({ bestUnderPar: 3 }, "round-3").earned).toBe(true);
    expect(state({ bestUnderPar: 4 }, "round-5").earned).toBe(false);
    expect(state({ bestUnderPar: 5 }, "round-5").earned).toBe(true);
    expect(state({ bestUnderPar: 8 }, "round-8").earned).toBe(true);
    expect(state({ bestUnderPar: 11 }, "round-12").earned).toBe(false);
    expect(state({ bestUnderPar: 12 }, "round-12").earned).toBe(true);
  });

  // ⛳ Scoring
  it("first-birdie / first-eagle", () => {
    expect(state({ hasBirdie: true }, "first-birdie").earned).toBe(true);
    expect(state({ hasEagle: true }, "first-eagle").earned).toBe(true);
  });
  it("bogey-free needs all 18 at-or-under par", () => {
    expect(state({ bestHolesAtOrUnderPar: 17 }, "bogey-free").earned).toBe(false);
    expect(state({ bestHolesAtOrUnderPar: 18 }, "bogey-free").earned).toBe(true);
  });
  it("birdies-3 / birdies-5", () => {
    expect(state({ maxBirdiesInRound: 3 }, "birdies-3").earned).toBe(true);
    expect(state({ maxBirdiesInRound: 4 }, "birdies-5").earned).toBe(false);
    expect(state({ maxBirdiesInRound: 5 }, "birdies-5").earned).toBe(true);
  });

  // 🔥 Dedication
  it("streak ladder 7 / 30 / 100", () => {
    expect(state({ maxStreak: 7 }, "streak-7").earned).toBe(true);
    expect(state({ maxStreak: 29 }, "streak-30").earned).toBe(false);
    expect(state({ maxStreak: 30 }, "streak-30").earned).toBe(true);
    expect(state({ maxStreak: 100 }, "streak-100").earned).toBe(true);
  });
  it("rounds 10 / 50 / 100", () => {
    expect(state({ roundsPlayed: 10 }, "rounds-10").earned).toBe(true);
    expect(state({ roundsPlayed: 50 }, "rounds-50").earned).toBe(true);
    expect(state({ roundsPlayed: 99 }, "rounds-100").earned).toBe(false);
  });
  it("played-all needs every course", () => {
    expect(state({ playedCourses: 17, coursesTotal: 18 }, "played-all").earned).toBe(false);
    expect(state({ playedCourses: 18, coursesTotal: 18 }, "played-all").earned).toBe(true);
  });

  // 🏆 Conquer
  it("conquer 5 / 10 / all", () => {
    expect(state({ subParCourses: 5 }, "conquer-5").earned).toBe(true);
    expect(state({ subParCourses: 10 }, "conquer-10").earned).toBe(true);
    expect(state({ subParCourses: 17, coursesTotal: 18 }, "conquer-all").earned).toBe(false);
    expect(state({ subParCourses: 18, coursesTotal: 18 }, "conquer-all").earned).toBe(true);
  });

  // 🥇 Competition — coming soon, never earned, no progress
  it("competition trophies are coming-soon and never earned", () => {
    for (const id of ["comp-cut", "comp-podium", "comp-win"]) {
      const s = state({ roundsPlayed: 999, subParCourses: 18, maxStreak: 999 }, id);
      expect(s.comingSoon).toBe(true);
      expect(s.earned).toBe(false);
      expect(s.progressPct).toBe(0);
    }
  });
});

describe("trophies — progress %", () => {
  it("reports current/target and a clamped pct for locked goals", () => {
    const s = state({ subParCourses: 6, coursesTotal: 18 }, "conquer-all");
    expect(s.current).toBe(6);
    expect(s.target).toBe(18);
    expect(s.progressPct).toBe(33); // round(6/18*100)
    expect(s.earned).toBe(false);
  });
  it("earned goals report 100%", () => {
    expect(state({ roundsPlayed: 75 }, "rounds-50").progressPct).toBe(100);
  });
});

describe("trophies — summarizeRounds reducer", () => {
  const round = (relativeToPar: number, courseKey: string, outcomes: string[]): RoundLite => ({
    relativeToPar,
    courseKey,
    holes: outcomes.map((outcome) => ({
      outcome,
      scoreChange: { eagle: -2, birdie: -1, par: 0, bogey: 1, double: 2, triple: 3 }[outcome] ?? 0,
    })),
  });

  it("counts birdies-or-better (eagles included) and best-per-round", () => {
    const s = summarizeRounds(
      [round(-2, "a", ["birdie", "eagle", "par", "bogey"]), round(0, "a", ["birdie"])],
      18,
      0
    );
    expect(s.hasBirdie).toBe(true);
    expect(s.hasEagle).toBe(true);
    expect(s.maxBirdiesInRound).toBe(2); // birdie + eagle in round 1
  });

  it("bogey-free counts holes at-or-under par per round", () => {
    const allPar = round(0, "a", Array(18).fill("par"));
    const s = summarizeRounds([allPar], 18, 0);
    expect(s.bestHolesAtOrUnderPar).toBe(18);
  });

  it("distinct played vs sub-par courses, best under-par, maxStreak passthrough", () => {
    const s = summarizeRounds(
      [round(-3, "a", ["par"]), round(2, "b", ["par"]), round(-1, "a", ["birdie"])],
      18,
      42
    );
    expect(s.roundsPlayed).toBe(3);
    expect(s.playedCourses).toBe(2); // a, b
    expect(s.subParCourses).toBe(1); // only a went sub-par
    expect(s.bestUnderPar).toBe(3);
    expect(s.brokePar).toBe(true);
    expect(s.maxStreak).toBe(42);
  });
});

describe("trophies — catalogue integrity", () => {
  it("ids are unique", () => {
    const ids = TROPHIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every non-coming-soon trophy has a measure", () => {
    for (const t of TROPHIES) {
      if (!t.comingSoon) expect(t.measure, t.id).toBeTypeOf("function");
    }
  });
  it("omits albatross (engine can't produce one)", () => {
    expect(TROPHIES.find((t) => /albatross/i.test(t.label))).toBeUndefined();
  });
});
