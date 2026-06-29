/**
 * Deterministic "course of the day". Same UTC date -> same course + puzzle #
 * for every player, so the daily leaderboard is apples-to-apples.
 */

import { COURSES, type Course } from "@/data/courses";

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
 * ROTATION RULE: courses play in catalogue order on repeat, so each course
 * recurs every `COURSES.length` days — a course can NEVER appear twice within
 * any window of that length (the maximum possible spacing for the catalogue).
 *
 * APPEND-STABLE — this is the important property: day `d` maps to index
 * `d % len`. For any already-elapsed or current day `d < oldLen`, appending
 * courses keeps `d % oldLen === d % newLen === d`, so the schedule for the past
 * and for today NEVER changes when you add courses. Only FUTURE days (`d >=
 * oldLen`) pick up the new courses. (The previous seeded-shuffle cycle did NOT
 * have this property: growing the catalogue reshuffled every position and
 * retroactively rewrote which course each elapsed day mapped to — splitting a
 * live daily field whose rounds had already been played on the old course.)
 *
 * INVARIANT: only ever APPEND to data/courses.ts; never reorder existing
 * entries — reordering shifts indices and would move the schedule.
 *
 * NOTE ON "same week": with fewer than 7 courses a 7-day week can't be repeat-
 * free (pigeonhole). Add ≥7 courses for fully-unique weeks — no code change.
 * Fully deterministic and O(1) per lookup.
 */
export function dailyCourse(date = new Date()): Course {
  const len = COURSES.length;
  return COURSES[((dayIndex(date) % len) + len) % len];
}

/**
 * Resolve the course for a stored round by its persisted dateKey. Anything
 * tied to an existing round MUST use this (not dailyCourse()) so gameplay and
 * results don't flip to a different course when play crosses UTC midnight.
 */
export function dailyCourseForKey(key: string): Course {
  return dailyCourse(keyToDate(key));
}
