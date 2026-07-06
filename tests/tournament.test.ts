import { describe, it, expect } from "vitest";
import {
  phaseFor,
  playableRounds,
  cutIsDue,
  computeCut,
  scheduleFromStart,
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
  it("cut is 4 days after start, end is 7 days after", () => {
    const start = new Date("2026-07-06T04:00:00Z"); // Mon 00:00 ET
    const s = scheduleFromStart(start);
    const days = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);
    expect(days(s.cutAt, s.startsAt)).toBe(4); // Fri
    expect(days(s.endsAt, s.startsAt)).toBe(7); // next Mon
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
