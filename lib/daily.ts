/**
 * Deterministic "course of the day". Same UTC date -> same course + puzzle #
 * for every player, so the daily leaderboard is apples-to-apples.
 */

import { COURSES, type Course } from "@/data/courses";
import { hashSeed } from "@/lib/engine/rng";

const EPOCH_UTC = Date.UTC(2024, 0, 1); // puzzle #1

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
 * Pick the course for a day. Uses a hash-derived STEP recurrence so the
 * sequence looks shuffled AND two consecutive days can never land on the same
 * course (the step is always 1..len-1). Walking from the epoch keeps it fully
 * deterministic — O(dayIndex), which is a few hundred trivial hashes.
 */
export function dailyCourse(date = new Date()): Course {
  return COURSES[resolvedPick(dayIndex(date))];
}

function resolvedPick(idx: number): number {
  const len = COURSES.length;
  let pick = hashSeed("course:0") % len;
  for (let i = 1; i <= idx; i++) {
    const step = 1 + (hashSeed(`course:${i}`) % (len - 1)); // 1..len-1, never 0
    pick = (pick + step) % len;
  }
  return pick;
}

/**
 * Resolve the course for a stored round by its persisted dateKey. Anything
 * tied to an existing round MUST use this (not dailyCourse()) so gameplay and
 * results don't flip to a different course when play crosses UTC midnight.
 */
export function dailyCourseForKey(key: string): Course {
  return dailyCourse(keyToDate(key));
}
