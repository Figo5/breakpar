import { describe, it, expect } from "vitest";
import {
  phaseFor,
  playableRounds,
  cutIsDue,
  computeCut,
  scheduleFromStart,
  scheduleForUpcoming,
  tournamentSeedKey,
  cutlineScore,
  CUT_MIN,
  type CutCandidate,
} from "@/lib/tournament";

// A fixed schedule: start Mon, cut Fri 00:00, end next Mon 00:00 (UTC stand-ins;
// the phase logic only compares instants, so exact zone doesn't matter here).
const sched = {
  startsAt: new Date("2026-07-06T04:00:00Z"), // Mon 00:00 ET
  cutAt: new Date("2026-07-10T04:00:00Z"), // Fri 00:00 ET (end of Thu)
  endsAt: new Date("2026-07-13T04:00:00Z"), // next Mon 00:00 ET (end of Sun)
};

describe("phaseFor", () => {
  it("is upcoming before start", () => {
    expect(phaseFor(sched, new Date("2026-07-05T12:00:00Z"))).toBe("upcoming");
  });
  it("is round1_2 between start and cut", () => {
    expect(phaseFor(sched, new Date("2026-07-07T12:00:00Z"))).toBe("round1_2");
  });
  it("is round3_4 between cut and end", () => {
    expect(phaseFor(sched, new Date("2026-07-11T12:00:00Z"))).toBe("round3_4");
  });
  it("is complete after end", () => {
    expect(phaseFor(sched, new Date("2026-07-14T00:00:00Z"))).toBe("complete");
  });
  it("boundaries are inclusive-forward (exactly start = round1_2)", () => {
    expect(phaseFor(sched, sched.startsAt)).toBe("round1_2");
    expect(phaseFor(sched, sched.cutAt)).toBe("round3_4");
    expect(phaseFor(sched, sched.endsAt)).toBe("complete");
  });
});

describe("playableRounds", () => {
  it("maps phases to rounds", () => {
    expect(playableRounds("upcoming")).toEqual([]);
    expect(playableRounds("round1_2")).toEqual([1, 2]);
    expect(playableRounds("round3_4")).toEqual([3, 4]);
    expect(playableRounds("complete")).toEqual([]);
  });
});

describe("cutIsDue", () => {
  it("is due after the deadline if not yet computed", () => {
    expect(cutIsDue(sched, null, new Date("2026-07-11T00:00:00Z"))).toBe(true);
  });
  it("is not due before the deadline", () => {
    expect(cutIsDue(sched, null, new Date("2026-07-08T00:00:00Z"))).toBe(false);
  });
  it("is not due if already computed", () => {
    expect(cutIsDue(sched, new Date("2026-07-10T05:00:00Z"), new Date("2026-07-11T00:00:00Z"))).toBe(false);
  });
});

describe("computeCut", () => {
  const mk = (entryId: string, done: number, toPar: number): CutCandidate => ({
    entryId,
    completedPreCutRounds: done,
    cumulativeToPar: toPar,
  });

  it("withdraws entries that didn't finish both pre-cut rounds", () => {
    const { advance, withdraw } = computeCut([mk("a", 1, -2), mk("b", 2, 0)], 30, 1);
    expect(withdraw.has("a")).toBe(true);
    expect(advance.has("a")).toBe(false);
    expect(advance.has("b")).toBe(true);
  });

  it("advances at least `min` even when percent would be fewer", () => {
    // 25 qualified, percent 30% => 8, but min 20 => 20 advance.
    const field = Array.from({ length: 25 }, (_, i) => mk(`e${i}`, 2, i));
    const { advance } = computeCut(field, 30, 20);
    expect(advance.size).toBe(20);
  });

  it("uses percent when it exceeds min", () => {
    // 100 qualified, 30% => 30 advance (min 20 not binding).
    const field = Array.from({ length: 100 }, (_, i) => mk(`e${i}`, 2, i));
    const { advance } = computeCut(field, 30, 20);
    expect(advance.size).toBe(30);
  });

  it("never advances more than the field", () => {
    const field = [mk("a", 2, -1), mk("b", 2, 0)];
    const { advance } = computeCut(field, 30, 20); // min 20 > field 2
    expect(advance.size).toBe(2);
  });

  it("ranks by cumulative to-par, lowest advances", () => {
    const field = [mk("hi", 2, 5), mk("lo", 2, -5), mk("mid", 2, 0)];
    const { advance } = computeCut(field, 34, 1); // ~1 advances -> the lowest
    expect(advance.has("lo")).toBe(true);
  });

  it("extends through ties at the cut line", () => {
    // Want 1 by percent, but three players tie at the boundary score -> all advance.
    const field = [mk("a", 2, -3), mk("b", 2, 0), mk("c", 2, 0), mk("d", 2, 0)];
    const { advance } = computeCut(field, 25, 1); // ceil(25% of 4)=1, but ties at 0
    // 'a' is best (advances), then boundary is a's score (-3) — no tie there, so
    // only 'a'. Adjust: make the boundary itself a tie.
    const field2 = [mk("a", 2, 0), mk("b", 2, 0), mk("c", 2, 5)];
    const { advance: adv2 } = computeCut(field2, 34, 1); // 1 by percent, boundary score 0, a&b tie
    expect(adv2.has("a")).toBe(true);
    expect(adv2.has("b")).toBe(true);
    expect(adv2.has("c")).toBe(false);
    expect(advance.has("a")).toBe(true);
  });

  it("handles an empty field", () => {
    const { advance, withdraw } = computeCut([], 30, 20);
    expect(advance.size).toBe(0);
    expect(withdraw.size).toBe(0);
  });
});

describe("scheduleFromStart", () => {
  it("cut is 3 days after start (Tue->Fri), end is 6 days after (Tue->next Mon)", () => {
    const start = new Date("2026-07-07T04:00:00Z"); // Tue 00:00 ET
    const s = scheduleFromStart(start);
    const days = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);
    expect(days(s.cutAt, s.startsAt)).toBe(3); // Fri
    expect(days(s.endsAt, s.startsAt)).toBe(6); // next Mon
  });
});

describe("tournamentSeedKey", () => {
  it("is stable per (tournament, round) and differs across rounds", () => {
    expect(tournamentSeedKey("t1", 1)).toBe("t1:1");
    expect(tournamentSeedKey("t1", 2)).not.toBe(tournamentSeedKey("t1", 1));
  });
});

describe("cutlineScore (current cut line)", () => {
  it("returns null for an empty field", () => {
    expect(cutlineScore([], 30, 20)).toBeNull();
  });

  it("is the score at the cut position when percent binds", () => {
    // 100 players, 30% => 30 advance; sorted asc, the 30th score (index 29) is the line.
    const scores = Array.from({ length: 100 }, (_, i) => i); // 0..99
    expect(cutlineScore(scores, 30, 20)).toBe(29);
  });

  it("uses the min when the field is small", () => {
    // 25 players, 30% => 8, but min 20 => the 20th score (index 19) is the line.
    const scores = Array.from({ length: 25 }, (_, i) => i);
    expect(cutlineScore(scores, 30, 20)).toBe(19);
  });

  it("caps at the field size", () => {
    // 5 players, min 20 > field => everyone's in, line = worst (last) score.
    const scores = [-5, -3, -1, 0, 2];
    expect(cutlineScore(scores, 30, 20)).toBe(2);
  });

  it("works with realistic negative to-par scores", () => {
    // 10 players through 2 rounds; 30% => 3 advance; line = 3rd-best score.
    const scores = [-16, -15, -14, -12, -11, -9, -8, -6, -4, 1];
    expect(cutlineScore(scores, 30, 3)).toBe(-14);
  });
});

// --- Course rotation (+ major-week overrides) -------------------------------
import {
  tournamentCourseSlugFor,
  TOURNAMENT_COURSE_POOL,
  TOURNAMENT_COURSE_OVERRIDES,
  TOURNAMENT_FALLBACK_SLUG,
} from "@/lib/tournament";
import { COURSES } from "@/data/courses";

describe("tournament course rotation", () => {
  const slugs = new Set(COURSES.map((c) => c.slug));

  it("every pool slug exists in the course roster", () => {
    for (const s of TOURNAMENT_COURSE_POOL) {
      expect(slugs.has(s), `pool slug missing from roster: ${s}`).toBe(true);
    }
  });

  it("every override slug exists in the course roster", () => {
    for (const [week, s] of Object.entries(TOURNAMENT_COURSE_OVERRIDES)) {
      expect(slugs.has(s), `override slug for ${week} missing from roster: ${s}`).toBe(true);
    }
  });

  it("the fallback slug exists in the roster", () => {
    expect(slugs.has(TOURNAMENT_FALLBACK_SLUG)).toBe(true);
  });

  it("reserves the crown jewels — they are NOT in the regular rotation", () => {
    for (const jewel of ["augusta-national", "st-andrews-old", "pinehurst-no2", "royal-birkdale"]) {
      expect(TOURNAMENT_COURSE_POOL.includes(jewel), `${jewel} should be override-only`).toBe(false);
    }
  });

  it("treats Sawgrass as a regular stop, not a crown jewel", () => {
    expect(TOURNAMENT_COURSE_POOL).toContain("tpc-sawgrass");
  });

  it("includes every regular roster course", () => {
    const reserved = new Set([
      "pebble-beach",
      "winged-foot-west",
      "augusta-national",
      "st-andrews-old",
      "pinehurst-no2",
      "royal-birkdale",
      // Batch 9 (NY/NJ) — seeded and playable, but deliberately HELD OUT of the
      // tournament rotation pending a call on which belong there. Not crown
      // jewels; move them into TOURNAMENT_COURSE_POOL and delete these lines
      // once that's decided. Note adding any of them shifts the rotation for
      // every future week (the index is ordinal % pool.length).
      "baltusrol-lower",
      "quaker-ridge",
      "fishers-island",
      "oak-hill-east",
      "somerset-hills",
      // Congressional — same holding pattern as batch 9 above, for the same
      // reason: pool placement is a deliberate call, not an automatic
      // consequence of seeding a course.
      "congressional-blue",
    ]);
    const expected = COURSES.map((course) => course.slug).filter((slug) => !reserved.has(slug));
    expect(new Set(TOURNAMENT_COURSE_POOL)).toEqual(new Set(expected));
  });

  it("pebble-beach is out of the pool (it was the launch tournament)", () => {
    expect(TOURNAMENT_COURSE_POOL.includes("pebble-beach")).toBe(false);
  });

  it("no course appears twice in the pool", () => {
    expect(new Set(TOURNAMENT_COURSE_POOL).size).toBe(TOURNAMENT_COURSE_POOL.length);
  });

  it("is deterministic — same week always yields the same course", () => {
    expect(tournamentCourseSlugFor("2026-W30")).toBe(tournamentCourseSlugFor("2026-W30"));
  });

  it("consecutive weeks give different courses", () => {
    for (let w = 20; w < 30; w++) {
      const a = tournamentCourseSlugFor(`2026-W${String(w).padStart(2, "0")}`);
      const b = tournamentCourseSlugFor(`2026-W${String(w + 1).padStart(2, "0")}`);
      expect(a, `weeks ${w} and ${w + 1} repeated`).not.toBe(b);
    }
  });

  it("cycles through the whole pool before repeating", () => {
    const n = TOURNAMENT_COURSE_POOL.length;
    const seen = new Set<string>();
    for (let w = 1; w <= n; w++) seen.add(tournamentCourseSlugFor(`2026-W${String(w).padStart(2, "0")}`));
    expect(seen.size).toBe(n);
  });

  it("an override wins over the rotation", () => {
    const week = Object.keys(TOURNAMENT_COURSE_OVERRIDES)[0];
    if (!week) return; // no overrides configured yet — nothing to assert
    expect(tournamentCourseSlugFor(week)).toBe(TOURNAMENT_COURSE_OVERRIDES[week]);
  });

  it("falls back on a malformed week key", () => {
    expect(tournamentCourseSlugFor("not-a-week")).toBe(TOURNAMENT_FALLBACK_SLUG);
  });

  it("carries the rotation across a year boundary without repeating", () => {
    const a = tournamentCourseSlugFor("2026-W52");
    const b = tournamentCourseSlugFor("2027-W01");
    expect(a).not.toBe(b);
  });
});


describe("scheduleForUpcoming (Tue start / Mon results-day shape)", () => {
  const easternWeekday = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(d);

  it("starts on a Tuesday", () => {
    const s = scheduleForUpcoming(new Date("2026-07-08T12:00:00Z")); // a Wednesday
    expect(easternWeekday(s.startsAt)).toBe("Tuesday");
  });

  it("cut falls on Friday 00:00 ET (end of Thursday)", () => {
    const s = scheduleForUpcoming(new Date("2026-07-08T12:00:00Z"));
    expect(easternWeekday(s.cutAt)).toBe("Friday");
  });

  it("ends on Monday 00:00 ET (end of Sunday) — Monday is the results gap", () => {
    const s = scheduleForUpcoming(new Date("2026-07-08T12:00:00Z"));
    expect(easternWeekday(s.endsAt)).toBe("Monday");
  });

  it("Monday sits in the 'complete' gap between one week ending and the next starting", () => {
    const s = scheduleForUpcoming(new Date("2026-07-08T12:00:00Z"));
    // A moment on the Monday the event ends is complete for that event...
    expect(phaseFor(s, s.endsAt)).toBe("complete");
    // ...and still before next week's Tuesday start.
    const next = scheduleFromStart(new Date(s.endsAt.getTime() + 86_400_000)); // +1 day = Tue
    expect(phaseFor(next, s.endsAt)).toBe("upcoming");
  });
});
