import { describe, it, expect } from "vitest";
import {
  dayIndex,
  dateKey,
  keyToDate,
  dailyCourse,
  dailyCourseForKey,
  puzzleNumber,
} from "@/lib/daily";
import { COURSES } from "@/data/courses";

describe("date helpers", () => {
  it("dateKey is a UTC YYYY-MM-DD string", () => {
    expect(dateKey(new Date("2026-06-25T23:59:00Z"))).toBe("2026-06-25");
  });

  it("keyToDate round-trips with dateKey", () => {
    const k = "2026-06-25";
    expect(dateKey(keyToDate(k))).toBe(k);
  });

  it("puzzleNumber is dayIndex + 1", () => {
    const d = new Date("2026-06-25T12:00:00Z");
    expect(puzzleNumber(d)).toBe(dayIndex(d) + 1);
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

  it("dailyCourseForKey matches dailyCourse for that day", () => {
    const day = new Date("2026-06-25T00:00:00Z");
    expect(dailyCourseForKey("2026-06-25").slug).toBe(dailyCourse(day).slug);
  });

  it("only ever returns seeded courses", () => {
    const slugs = new Set(COURSES.map((c) => c.slug));
    for (let i = 0; i < 100; i++) {
      expect(slugs.has(dailyCourse(new Date(Date.UTC(2026, 0, 1 + i))).slug)).toBe(true);
    }
  });
});
