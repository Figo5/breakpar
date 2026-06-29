/**
 * Deterministic "course of the day". Same UTC date -> same course + puzzle #
 * for every player, so the daily leaderboard is apples-to-apples.
 */

import { COURSES, type Course } from "@/data/courses";
import { hashSeed } from "@/lib/engine/rng";

const EPOCH_UTC = Date.UTC(2026, 5, 25); // puzzle #1 (day 1 = 2026-06-25, rolls over at 00:00 UTC)

export function dayIndex(date = new Date()): number {
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - EPOCH_UTC) / 86_400_000);
}

export function puzzleNumber(date = new Date()): number {
  return dayIndex(date) + 1;
}

/** Date key like "2026-06-25" used as the DB partition for daily rounds. */
export function dateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Parse a "YYYY-MM-DD" key back into the UTC midnight Date it represents. */
export function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/**
 * Puzzle number for a stored round, derived from its persisted dateKey rather
 * than wall-clock time (so a round straddling UTC midnight stays consistent).
 */
export function puzzleNumberForKey(key: string): number {
  return puzzleNumber(keyToDate(key));
}

/**
 * Pick the course for a day.
 *
 * ROTATION RULE: we never want a course to come back too soon (the old
 * step-recurrence only blocked back-to-back days, so St Andrews → Sawgrass →
 * St Andrews — a 2-day repeat — was still possible). Instead we play a single,
 * fixed, shuffled PERMUTATION of all courses on repeat. That makes each course
 * recur exactly every `COURSES.length` days, so a course can NEVER appear twice
 * within any window of `COURSES.length` consecutive days — the maximum possible
 * spacing for the catalogue.
 *
 * NOTE ON "same week": with only 5 courses it is mathematically impossible to
 * fill a 7-day week without a repeat (pigeonhole). This rule gives the best
 * achievable spacing (no repeat for 5 days). To make every calendar week fully
 * unique, add at least 7 courses to data/courses.ts — no code change needed.
 *
 * Because the cycle length (course count) is coprime with 7, the course that
 * lands on a given weekday drifts week to week, so it never feels static.
 * Fully deterministic and O(1) per lookup.
 */
export function dailyCourse(date = new Date()): Course {
  return COURSES[resolvedPick(dayIndex(date))];
}

/**
 * A fixed, deterministically-shuffled order of all course indices. Seeded so
 * the order is non-alphabetical but constant forever (changing it would reshuffle
 * the whole future schedule — past rounds are unaffected since they persist their
 * own courseId).
 */
const COURSE_CYCLE: number[] = (() => {
  const order = Array.from({ length: COURSES.length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = hashSeed(`course-cycle:${i}`) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
})();

function resolvedPick(idx: number): number {
  const len = COURSES.length;
  if (len <= 1) return 0;
  return COURSE_CYCLE[((idx % len) + len) % len];
}

/**
 * Resolve the course for a stored round by its persisted dateKey. Anything
 * tied to an existing round MUST use this (not dailyCourse()) so gameplay and
 * results don't flip to a different course when play crosses UTC midnight.
 */
export function dailyCourseForKey(key: string): Course {
  return dailyCourse(keyToDate(key));
}
