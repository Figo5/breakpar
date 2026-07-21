/**
 * Course facets — the filter dimensions behind the /courses browser.
 *
 * Pure and client-safe (no prisma, no next/headers) so the browser island can
 * import them directly. Everything is DERIVED from the existing course data:
 * adding a course to data/courses.ts automatically places it in the right
 * region and character buckets, with no second list to keep in sync. That's
 * deliberate — a hand-maintained tag list would drift the first time someone
 * added a course and forgot, which is exactly the failure mode the roster
 * tests exist to catch elsewhere.
 */

import type { Course } from "@/data/courses";

// --- region ----------------------------------------------------------------

export type Region =
  | "northeast"
  | "south"
  | "midwest"
  | "west"
  | "uk-ireland"
  | "international";

export const REGION_META: Record<Region, { label: string }> = {
  northeast: { label: "Northeast" },
  south: { label: "South" },
  midwest: { label: "Midwest" },
  west: { label: "West" },
  "uk-ireland": { label: "UK & Ireland" },
  international: { label: "International" },
};

export const REGION_ORDER: Region[] = [
  "northeast",
  "south",
  "midwest",
  "west",
  "uk-ireland",
  "international",
];

/** State/country -> region. Keyed off the last comma-separated part of
 * `Course.location`, which is how every entry in data/courses.ts is written. */
const REGION_BY_PLACE: Record<string, Region> = {
  // Northeast
  "New York": "northeast",
  "New Jersey": "northeast",
  Pennsylvania: "northeast",
  Massachusetts: "northeast",
  // South (incl. mid-Atlantic and Texas)
  Maryland: "south",
  "North Carolina": "south",
  "South Carolina": "south",
  Georgia: "south",
  Florida: "south",
  Texas: "south",
  // Midwest
  Wisconsin: "midwest",
  Ohio: "midwest",
  Michigan: "midwest",
  Missouri: "midwest",
  Kansas: "midwest",
  Nebraska: "midwest",
  // West
  California: "west",
  Oregon: "west",
  Washington: "west",
  // UK & Ireland
  Scotland: "uk-ireland",
  England: "uk-ireland",
  "Northern Ireland": "uk-ireland",
  Ireland: "uk-ireland",
  // Everything else
  Australia: "international",
  "Nova Scotia": "international",
};

/** The region a course sits in. Unknown places fall to "international" rather
 * than throwing — a new course is always browsable, just possibly in the
 * catch-all bucket until it's added to the map above. */
export function regionOf(location: string): Region {
  const place = location.split(",").pop()?.trim() ?? "";
  return REGION_BY_PLACE[place] ?? "international";
}

// --- character -------------------------------------------------------------

export type Character = "links" | "water" | "parkland";

export const CHARACTER_META: Record<Character, { label: string; hint: string }> = {
  links: { label: "Links & windy", hint: "Exposed, wind-blown golf" },
  water: { label: "Water in play", hint: "Five or more holes with water or ocean" },
  parkland: { label: "Parkland", hint: "Sheltered, tree-lined, inland" },
};

export const CHARACTER_ORDER: Character[] = ["links", "water", "parkland"];

/** Wind at or above this is "exposed" — it's the threshold where the engine's
 * wind term starts meaningfully punishing long approaches. */
const WINDY_MPH = 14;
/** Holes with water or ocean at or above this count means water defines the round. */
const WET_HOLES = 5;
/** Below this wind, and with no ocean, a course reads as sheltered parkland. */
const CALM_MPH = 10;

export function wetHoleCount(course: Course): number {
  return course.holes.filter((h) => h.hazard === "water" || h.hazard === "ocean").length;
}

/** The character tags for a course. A course can hold more than one (Pebble is
 * both links-y and water-heavy) or none — tags describe, they don't partition. */
export function characterOf(course: Course): Character[] {
  const tags: Character[] = [];
  const wet = wetHoleCount(course);
  const hasOcean = course.holes.some((h) => h.hazard === "ocean");
  if (course.wind >= WINDY_MPH) tags.push("links");
  if (wet >= WET_HOLES) tags.push("water");
  if (course.wind <= CALM_MPH && !hasOcean) tags.push("parkland");
  return tags;
}

// --- sorting ---------------------------------------------------------------

export type SortKey = "popular" | "difficulty" | "name";

/** Total yardage — used for the card's stat line, not a filter. */
export function courseYardage(course: Course): number {
  return course.holes.reduce((sum, h) => sum + h.yardage, 0);
}
