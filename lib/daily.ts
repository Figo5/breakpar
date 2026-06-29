/**
 * Deterministic "course of the day". Same Eastern date -> same course + puzzle #
 * for every player, so the daily leaderboard is apples-to-apples.
 *
 * The day boundary is midnight **America/New_York** (DST-aware), not 00:00 UTC:
 * a dateKey is the civil Eastern date, and all key<->index math is civil-date
 * arithmetic (count of days from EPOCH). EPOCH is a civil day-number anchor, not
 * a wall-clock instant, so it never needs a timezone.
 */

import { COURSES, type Course } from "@/data/courses";

const TZ = "America/New_York";
const EPOCH_UTC = Date.UTC(2026, 5, 25); // puzzle #1 = civil date 2026-06-25 (day 0)

interface CivilDate {
  y: number;
  m: number; // 1..12
  d: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The civil (calendar) date at `date` in America/New_York — DST-aware. */
function easternCivilDate(date: Date): CivilDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Day number (days since EPOCH) for a civil date — pure calendar arithmetic. */
function dayNumber({ y, m, d }: CivilDate): number {
  return Math.floor((Date.UTC(y, m - 1, d) - EPOCH_UTC) / 86_400_000);
}

const keyOf = ({ y, m, d }: CivilDate): string => `${y}-${pad(m)}-${pad(d)}`;

/** Parse a "YYYY-MM-DD" dateKey into its civil-date parts. */
function parseKey(key: string): CivilDate {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

export function dayIndex(date = new Date()): number {
  return dayNumber(easternCivilDate(date));
}

export function puzzleNumber(date = new Date()): number {
  return dayIndex(date) + 1;
}

/** Date key like "2026-06-25" — the Eastern civil date, used to partition rounds. */
export function dateKey(date = new Date()): string {
  return keyOf(easternCivilDate(date));
}

/**
 * Parse a "YYYY-MM-DD" key into the UTC-midnight Date it nominally represents.
 * Kept for callers that need an instant; key<->puzzle/course math no longer
 * routes through this (that's pure civil arithmetic on the key string), so a
 * stored key always maps to the same puzzle/course regardless of timezone.
 */
export function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** The dateKey of the civil day BEFORE `key` (DST-safe — pure calendar math). */
export function previousKey(key: string): string {
  const { y, m, d } = parseKey(key);
  const prev = new Date(Date.UTC(y, m - 1, d - 1)); // UTC arithmetic on civil parts
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
}

/**
 * Puzzle number for a stored round, derived from its persisted dateKey via pure
 * civil-date arithmetic (NOT a timezone conversion) so a round's number is
 * fixed forever the moment its key is written.
 */
export function puzzleNumberForKey(key: string): number {
  return dayNumber(parseKey(key)) + 1;
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
 * results don't flip to a different course when play crosses the day boundary.
 * Uses civil-date arithmetic on the key — never a timezone conversion.
 */
export function dailyCourseForKey(key: string): Course {
  const len = COURSES.length;
  return COURSES[((dayNumber(parseKey(key)) % len) + len) % len];
}
