import { describe, it, expect } from "vitest";
import { nextStreak, type StreakState } from "@/lib/scoring";

/**
 * The streak continuity rule (one-day freeze) lives in nextStreak, the exact
 * function the finish route calls. These drive it day-by-day with real dateKeys
 * so the freeze + DST behaviour is the same as production.
 *
 * Convention: `play(prev, key)` finishes a daily round on civil day `key`,
 * carrying lastPlayedKey forward like the route's upsert does.
 */
type S = StreakState & { lastPlayedKey: string };
const play = (prev: S | null, key: string, relativeToPar = 0): S => ({
  ...nextStreak(prev, key, relativeToPar),
  lastPlayedKey: key,
});

describe("streak continuity on consecutive Eastern days", () => {
  it("increments one per day", () => {
    let s = play(null, "2026-06-25");
    expect(s.currentStreak).toBe(1);
    s = play(s, "2026-06-26");
    s = play(s, "2026-06-27");
    expect(s.currentStreak).toBe(3);
    expect(s.maxStreak).toBe(3);
  });
});

describe("one-day freeze", () => {
  it("ONE missed day is bridged (streak preserved, not credited)", () => {
    let s = play(null, "2026-06-25"); // day 1
    s = play(s, "2026-06-26"); // day 2 (streak 2)
    // skip 2026-06-27 entirely, play again on the 28th
    s = play(s, "2026-06-28");
    expect(s.currentStreak).toBe(3); // bridged: 2 -> 3, the gap is spanned
    expect(s.daysPlayed).toBe(3); // but only 3 rounds were actually played
  });

  it("TWO missed days breaks the streak (resets to 1, keeps max)", () => {
    let s = play(null, "2026-06-25");
    s = play(s, "2026-06-26"); // streak 2
    // skip 27th AND 28th, play on the 29th
    s = play(s, "2026-06-29");
    expect(s.currentStreak).toBe(1); // freeze spent -> reset
    expect(s.maxStreak).toBe(2); // best run survives the break
  });

  it("does not stockpile: freeze is a fresh one-day grace each gap", () => {
    let s = play(null, "2026-06-01");
    s = play(s, "2026-06-03"); // bridged (skip 2nd) -> 2
    s = play(s, "2026-06-05"); // bridged (skip 4th) -> 3
    expect(s.currentStreak).toBe(3); // each single gap bridged independently
  });
});

describe("freeze across a DST boundary (US spring-forward 2026-03-08)", () => {
  it("bridges the skipped clocks-forward day", () => {
    // Play the day before the transition, SKIP the spring-forward day itself,
    // then play the day after. previousKey is pure civil arithmetic, so the
    // 23-hour day is just another calendar date -> freeze bridges it.
    let s = play(null, "2026-03-07");
    s = play(s, "2026-03-09"); // skipped 2026-03-08 (DST day)
    expect(s.currentStreak).toBe(2);
  });

  it("counts consecutive days straight through the transition", () => {
    let s = play(null, "2026-03-07");
    s = play(s, "2026-03-08"); // the DST day
    s = play(s, "2026-03-09");
    expect(s.currentStreak).toBe(3);
  });
});

describe("guest tracking", () => {
  it("builds a streak with no Clerk identity (same path as the route)", () => {
    // A guest's Streak row is keyed by their durable User id; nextStreak is
    // identity-agnostic, so a guest accrues a streak exactly like a signed-in
    // user. Starting from null (first ever round) proves the create path.
    let s = play(null, "2026-06-25", -1); // under par day 1
    s = play(s, "2026-06-26", 2); // over par day 2
    expect(s.currentStreak).toBe(2);
    expect(s.daysPlayed).toBe(2);
    expect(s.bestScore).toBe(-1); // best held across days
  });
});
