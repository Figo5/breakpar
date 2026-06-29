import { describe, it, expect } from "vitest";
import {
  dayIndex,
  dateKey,
  previousKey,
  dailyCourse,
  dailyCourseForKey,
  puzzleNumber,
  puzzleNumberForKey,
} from "@/lib/daily";
import { COURSES } from "@/data/courses";

describe("date helpers (midnight America/New_York boundary)", () => {
  it("dateKey rolls at midnight Eastern in summer (EDT, UTC-4)", () => {
    // 03:59 UTC = 23:59 EDT -> still the previous Eastern day
    expect(dateKey(new Date("2026-06-26T03:59:00Z"))).toBe("2026-06-25");
    // 04:00 UTC = 00:00 EDT -> new day
    expect(dateKey(new Date("2026-06-26T04:00:00Z"))).toBe("2026-06-26");
  });

  it("dateKey rolls at midnight Eastern in winter too (EST, UTC-5)", () => {
    expect(dateKey(new Date("2027-01-15T04:59:00Z"))).toBe("2027-01-14");
    expect(dateKey(new Date("2027-01-15T05:00:00Z"))).toBe("2027-01-15");
  });

  it("puzzleNumber is dayIndex + 1, and key<->index agree for an instant", () => {
    const d = new Date("2026-06-25T12:00:00Z"); // midday Eastern
    expect(puzzleNumber(d)).toBe(dayIndex(d) + 1);
    expect(puzzleNumberForKey(dateKey(d))).toBe(puzzleNumber(d));
  });

  it("a stored key maps to a fixed puzzle number forever (civil arithmetic)", () => {
    expect(puzzleNumberForKey("2026-06-25")).toBe(1); // EPOCH = puzzle #1
    expect(puzzleNumberForKey("2026-06-26")).toBe(2);
  });

  it("previousKey is the civil day before — correct across both DST transitions", () => {
    expect(previousKey("2026-06-26")).toBe("2026-06-25");
    expect(previousKey("2026-03-09")).toBe("2026-03-08"); // around spring-forward (Mar 8)
    expect(previousKey("2026-11-02")).toBe("2026-11-01"); // around fall-back (Nov 1)
    expect(previousKey("2027-01-01")).toBe("2026-12-31"); // year boundary
    expect(previousKey("2026-03-01")).toBe("2026-02-28"); // month boundary
  });
});

describe("dailyCourse", () => {
  it("is deterministic for a given day and never repeats yesterday", () => {
    for (let i = 0; i < 60; i++) {
      const today = new Date(Date.UTC(2026, 0, 1 + i));
      const yest = new Date(Date.UTC(2026, 0, i));
      const a = dailyCourse(today);
      const b = dailyCourse(today);
      expect(a.slug).toBe(b.slug); // deterministic
      expect(a.slug).not.toBe(dailyCourse(yest).slug); // no back-to-back repeat
    }
  });

  it("never repeats a course within any window of COURSES.length days", () => {
    // The reported bug was a 2-day repeat (St Andrews -> Sawgrass -> St Andrews).
    // With the permutation-cycle, no course may reappear until the whole
    // catalogue has been shown -- i.e. not within COURSES.length consecutive days.
    const win = COURSES.length;
    for (let start = 0; start < 120; start++) {
      const window = Array.from({ length: win }, (_, k) =>
        dailyCourse(new Date(Date.UTC(2026, 0, 1 + start + k))).slug
      );
      expect(new Set(window).size).toBe(win); // all distinct in any window
    }
  });

  it("dailyCourseForKey matches dailyCourse for that day", () => {
    const day = new Date("2026-06-25T12:00:00Z"); // midday Eastern, civil date 2026-06-25
    expect(dailyCourseForKey("2026-06-25").slug).toBe(dailyCourse(day).slug);
  });

  it("only ever returns seeded courses", () => {
    const slugs = new Set(COURSES.map((c) => c.slug));
    for (let i = 0; i < 100; i++) {
      expect(slugs.has(dailyCourse(new Date(Date.UTC(2026, 0, 1 + i))).slug)).toBe(true);
    }
  });
});
