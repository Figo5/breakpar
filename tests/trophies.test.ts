import { describe, it, expect } from "vitest";
import {
  evaluateTrophies,
  buildTrophyBoard,
  summarizeRounds,
  newlyUnlocked,
  validateFeatured,
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
  totalBirdies: 0,
  totalEagles: 0,
  maxEaglesInRound: 0,
  maxConsecutiveSubPar: 0,
  hasHoleInOne: false,
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
  it("round-3 / -5 / -8 / -12 / -15 fire at their thresholds", () => {
    expect(state({ bestUnderPar: 3 }, "round-3").earned).toBe(true);
    expect(state({ bestUnderPar: 4 }, "round-5").earned).toBe(false);
    expect(state({ bestUnderPar: 5 }, "round-5").earned).toBe(true);
    expect(state({ bestUnderPar: 8 }, "round-8").earned).toBe(true);
    expect(state({ bestUnderPar: 11 }, "round-12").earned).toBe(false);
    expect(state({ bestUnderPar: 12 }, "round-12").earned).toBe(true);
    expect(state({ bestUnderPar: 14 }, "round-15").earned).toBe(false);
    expect(state({ bestUnderPar: 15 }, "round-15").earned).toBe(true);
  });
  it("subpar-streak-3 needs 3 consecutive sub-par rounds", () => {
    expect(state({ maxConsecutiveSubPar: 2 }, "subpar-streak-3").earned).toBe(false);
    expect(state({ maxConsecutiveSubPar: 3 }, "subpar-streak-3").earned).toBe(true);
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
  it("birdies-3 / birdies-5 / birdies-7", () => {
    expect(state({ maxBirdiesInRound: 3 }, "birdies-3").earned).toBe(true);
    expect(state({ maxBirdiesInRound: 4 }, "birdies-5").earned).toBe(false);
    expect(state({ maxBirdiesInRound: 5 }, "birdies-5").earned).toBe(true);
    expect(state({ maxBirdiesInRound: 6 }, "birdies-7").earned).toBe(false);
    expect(state({ maxBirdiesInRound: 7 }, "birdies-7").earned).toBe(true);
  });
  it("eagle-double-round needs 2 eagles in one round", () => {
    expect(state({ maxEaglesInRound: 1 }, "eagle-double-round").earned).toBe(false);
    expect(state({ maxEaglesInRound: 2 }, "eagle-double-round").earned).toBe(true);
  });
  it("hole-in-one fires when an ace was recorded", () => {
    expect(state({ hasHoleInOne: false }, "hole-in-one").earned).toBe(false);
    expect(state({ hasHoleInOne: true }, "hole-in-one").earned).toBe(true);
  });

  // Counters — earned at the first, then the live tally is `current` (no cap).
  it("birdies counter: earned at 1, current tracks the running total", () => {
    const zero = state({ totalBirdies: 0 }, "birdies-counter");
    expect(zero.counter).toBe(true);
    expect(zero.earned).toBe(false);
    const many = state({ totalBirdies: 247 }, "birdies-counter");
    expect(many.earned).toBe(true);
    expect(many.current).toBe(247);
    expect(many.unit).toBe("birdies made");
  });
  it("eagles counter: earned at 1, current tracks the running total", () => {
    expect(state({ totalEagles: 0 }, "eagles-counter").earned).toBe(false);
    const s = state({ totalEagles: 18 }, "eagles-counter");
    expect(s.earned).toBe(true);
    expect(s.current).toBe(18);
    expect(s.counter).toBe(true);
  });

  // 🔥 Dedication
  it("streak ladder 7 / 30 / 100", () => {
    expect(state({ maxStreak: 7 }, "streak-7").earned).toBe(true);
    expect(state({ maxStreak: 29 }, "streak-30").earned).toBe(false);
    expect(state({ maxStreak: 30 }, "streak-30").earned).toBe(true);
    expect(state({ maxStreak: 100 }, "streak-100").earned).toBe(true);
  });
  it("rounds 10 / 50 / 100 / 250 / 500", () => {
    expect(state({ roundsPlayed: 10 }, "rounds-10").earned).toBe(true);
    expect(state({ roundsPlayed: 50 }, "rounds-50").earned).toBe(true);
    expect(state({ roundsPlayed: 99 }, "rounds-100").earned).toBe(false);
    expect(state({ roundsPlayed: 250 }, "rounds-250").earned).toBe(true);
    expect(state({ roundsPlayed: 499 }, "rounds-500").earned).toBe(false);
    expect(state({ roundsPlayed: 500 }, "rounds-500").earned).toBe(true);
  });
  it("played-all needs every course", () => {
    expect(state({ playedCourses: 17, coursesTotal: 18 }, "played-all").earned).toBe(false);
    expect(state({ playedCourses: 18, coursesTotal: 18 }, "played-all").earned).toBe(true);
  });

  // 🏆 Conquer
  it("conquer 5 / 10 / 15 / 25 / all", () => {
    expect(state({ subParCourses: 5 }, "conquer-5").earned).toBe(true);
    expect(state({ subParCourses: 10 }, "conquer-10").earned).toBe(true);
    expect(state({ subParCourses: 14 }, "conquer-15").earned).toBe(false);
    expect(state({ subParCourses: 15 }, "conquer-15").earned).toBe(true);
    expect(state({ subParCourses: 25 }, "conquer-25").earned).toBe(true);
    expect(state({ subParCourses: 39, coursesTotal: 40 }, "conquer-all").earned).toBe(false);
    expect(state({ subParCourses: 40, coursesTotal: 40 }, "conquer-all").earned).toBe(true);
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

  it("accumulates lifetime birdie/eagle totals and best eagles-in-round", () => {
    const s = summarizeRounds(
      [round(-2, "a", ["birdie", "eagle", "par"]), round(-3, "b", ["eagle", "eagle", "birdie"])],
      18,
      0
    );
    expect(s.totalBirdies).toBe(5); // 2 + 3 (eagles count as birdies-or-better)
    expect(s.totalEagles).toBe(3); // 1 + 2
    expect(s.maxEaglesInRound).toBe(2); // round 2 had two eagles
  });

  it("detects a hole-in-one only when a hole is a 1-stroke (par + scoreChange === 1)", () => {
    // Eagle on a par 3 = 1 stroke = ace.
    const ace: RoundLite = {
      relativeToPar: -2, courseKey: "a",
      holes: [{ outcome: "eagle", scoreChange: -2, par: 3 }, { outcome: "par", scoreChange: 0, par: 4 }],
    };
    expect(summarizeRounds([ace], 18, 0).hasHoleInOne).toBe(true);

    // Eagle on a par 5 = 3 strokes, NOT an ace.
    const par5Eagle: RoundLite = {
      relativeToPar: -2, courseKey: "a", holes: [{ outcome: "eagle", scoreChange: -2, par: 5 }],
    };
    expect(summarizeRounds([par5Eagle], 18, 0).hasHoleInOne).toBe(false);

    // Par-less holes (callers that don't supply par) never award the ace.
    const noPar = round(-2, "a", ["eagle", "par"]);
    expect(summarizeRounds([noPar], 18, 0).hasHoleInOne).toBe(false);
  });

  it("consecutive sub-par run is walked in playedAt order, not input order", () => {
    // Fed out of order; sub-par days are t=1,2,3 (run of 3) with an over-par t=4.
    const at = (relativeToPar: number, t: number): RoundLite => ({
      ...round(relativeToPar, "a", ["par"]),
      playedAt: t,
    });
    const s = summarizeRounds([at(1, 4), at(-1, 2), at(-2, 1), at(-1, 3)], 18, 0);
    expect(s.maxConsecutiveSubPar).toBe(3);
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

describe("trophies — newlyUnlocked (before/after diff, the anti-spam core)", () => {
  const evalWith = (s: Partial<TrophyStats>) => evaluateTrophies({ ...ZERO, ...s });

  it("returns only trophies earned in after but not before", () => {
    const before = evalWith({ roundsPlayed: 9 });
    const after = evalWith({ roundsPlayed: 10 }); // crosses the 10-rounds line
    const fresh = newlyUnlocked(before, after).map((t) => t.id);
    expect(fresh).toContain("rounds-10");
    expect(fresh).not.toContain("broke-par");
  });

  it("is empty when nothing changed (replayed finish)", () => {
    const states = evalWith({ roundsPlayed: 10, brokePar: true, bestUnderPar: 2 });
    expect(newlyUnlocked(states, states)).toEqual([]);
  });

  it("does NOT re-fire an existing player's history (before already had them)", () => {
    // Existing player: before this round they already had broke-par + first-birdie.
    const before = evalWith({ brokePar: true, bestUnderPar: 3, hasBirdie: true, roundsPlayed: 40 });
    // This round adds a 41st round but unlocks nothing new.
    const after = evalWith({ brokePar: true, bestUnderPar: 3, hasBirdie: true, roundsPlayed: 41 });
    expect(newlyUnlocked(before, after)).toEqual([]);
  });

  it("celebrates a brand-new player's first trophy (before empty)", () => {
    const before = evaluateTrophies(ZERO); // no rounds yet
    const after = evalWith({ hasBirdie: true, brokePar: true, bestUnderPar: 1, roundsPlayed: 1 });
    const fresh = newlyUnlocked(before, after).map((t) => t.id);
    expect(fresh).toContain("first-birdie");
    expect(fresh).toContain("broke-par");
  });
});

describe("trophies — validateFeatured (featured-5 picker guard)", () => {
  const earned = new Set(["a", "b", "c", "d", "e", "f"]);

  it("accepts <=5 earned ids and preserves order", () => {
    const r = validateFeatured(["c", "a", "e"], earned);
    expect(r).toEqual({ ok: true, ids: ["c", "a", "e"] });
  });

  it("dedupes before counting", () => {
    const r = validateFeatured(["a", "a", "b"], earned);
    expect(r).toEqual({ ok: true, ids: ["a", "b"] });
  });

  it("rejects more than 5", () => {
    expect(validateFeatured(["a", "b", "c", "d", "e", "f"], earned)).toEqual({
      ok: false,
      error: "too-many",
    });
  });

  it("rejects an id the user hasn't earned", () => {
    expect(validateFeatured(["a", "ghost"], earned)).toEqual({ ok: false, error: "not-earned" });
  });

  it("allows an empty selection (clear featured)", () => {
    expect(validateFeatured([], earned)).toEqual({ ok: true, ids: [] });
  });
});

describe("trophies — special/manual badges (Creator)", () => {
  const creatorState = (states: ReturnType<typeof evaluateTrophies>) =>
    states.find((s) => s.id === "creator")!;

  it("the catalogue has a special 'creator' trophy with no measure", () => {
    const c = TROPHIES.find((t) => t.id === "creator")!;
    expect(c.special).toBe(true);
    expect(c.category).toBe("special");
    expect(c.measure).toBeUndefined();
  });

  it("is NEVER auto-earned by the derived pass, even with maxed stats", () => {
    const maxed = evaluateTrophies({
      ...ZERO, roundsPlayed: 999, brokePar: true, bestUnderPar: 20, subParCourses: 18,
      playedCourses: 18, hasBirdie: true, hasEagle: true, maxStreak: 999,
      maxBirdiesInRound: 18, bestHolesAtOrUnderPar: 18,
      totalBirdies: 999, totalEagles: 99, maxEaglesInRound: 5, maxConsecutiveSubPar: 99,
      hasHoleInOne: true,
    });
    const c = creatorState(maxed);
    expect(c.special).toBe(true);
    expect(c.comingSoon).toBe(false);
    expect(c.earned).toBe(false); // only an award row can earn it
  });

  it("becomes earned only when an award row exists (buildTrophyBoard)", () => {
    const withAward = buildTrophyBoard(ZERO, true, new Map([["creator", "2026-07-01T00:00:00.000Z"]]));
    const c = withAward.states.find((s) => s.id === "creator")!;
    expect(c.earned).toBe(true);
    expect(c.unlockedAt).toBe("2026-07-01T00:00:00.000Z");

    const without = buildTrophyBoard(ZERO, true, new Map());
    expect(without.states.find((s) => s.id === "creator")!.earned).toBe(false);
  });

  it("is excluded from the earned count and rarity tally (honest stats)", () => {
    const board = buildTrophyBoard(ZERO, true, new Map([["creator", null]]));
    // No playable trophies earned on ZERO stats, so earnedCount stays 0 despite
    // the Creator badge being present + earned.
    expect(board.earnedCount).toBe(0);
    expect(board.tierTally.special).toBe(0);
    // And 'special' is not counted in the playable total.
    expect(board.states.some((s) => s.id === "creator" && s.earned)).toBe(true);
    expect(board.totalCount).toBe(TROPHIES.filter((t) => !t.special && !t.comingSoon).length);
  });

  it("an awarded special trophy is feature-able (in the earned set)", () => {
    const board = buildTrophyBoard(ZERO, true, new Map([["creator", null]]));
    const earned = new Set(board.states.filter((s) => s.earned).map((s) => s.id));
    expect(validateFeatured(["creator"], earned)).toEqual({ ok: true, ids: ["creator"] });
  });
});

describe("trophies — catalogue integrity", () => {
  it("ids are unique", () => {
    const ids = TROPHIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every playable (non-coming-soon, non-special) trophy has a measure", () => {
    for (const t of TROPHIES) {
      if (!t.comingSoon && !t.special) expect(t.measure, t.id).toBeTypeOf("function");
      if (t.special) expect(t.measure, t.id).toBeUndefined(); // special = awarded, not measured
    }
  });
  it("omits albatross (engine can't produce one)", () => {
    expect(TROPHIES.find((t) => /albatross/i.test(t.label))).toBeUndefined();
  });
});
