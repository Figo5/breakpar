/**
 * Course catalogue.
 *
 * Pars are accurate to each real course. Yardages are real championship-tee
 * distances (rounded to documented values); a few are representative where exact
 * per-hole figures vary by tee/season. Each hole also carries a stylized LAYOUT
 * descriptor — dogleg direction and signature hazard — so HoleArt can draw a
 * hole-specific diagram. This is an artistic representation of the real routing,
 * not a licensed aerial image.
 *
 * (In production these live in the Courses + Holes DB tables; this file seeds them.)
 */

export type Dogleg = "S" | "L" | "R"; // straight, dogleg-left, dogleg-right
export type Hazard = "none" | "sand" | "water" | "ocean";

export interface CourseHole {
  number: number;
  par: number;
  yardage: number;
  strokeIndex: number; // 1 = hardest
  dogleg: Dogleg;
  hazard: Hazard;
  signature?: string; // famous-hole note, shown in the UI
}

export interface Course {
  slug: string;
  name: string;
  location: string;
  rating: number;
  slope: number;
  difficulty: number; // 1..10
  wind: number; // mph
  windDir: number; // degrees, for the wind arrow
  greens: "Slow" | "Medium" | "Firm" | "Fast";
  blurb: string;
  holes: CourseHole[];
}

// Compact per-hole builder: [par, yardage, strokeIndex, dogleg, hazard, signature?]
type HoleTuple = [number, number, number, Dogleg, Hazard, string?];
function holes(rows: HoleTuple[]): CourseHole[] {
  return rows.map(([par, yardage, strokeIndex, dogleg, hazard, signature], i) => ({
    number: i + 1,
    par,
    yardage,
    strokeIndex,
    dogleg,
    hazard,
    signature,
  }));
}

export const COURSES: Course[] = [
  {
    slug: "pebble-beach",
    name: "Pebble Beach Links",
    location: "Pebble Beach, California",
    rating: 74.7, slope: 144, difficulty: 8, wind: 15, windDir: 135, greens: "Fast",
    blurb: "Cliff-top links on Carmel Bay. The ocean holes 7–10 and 18 make or break the card.",
    holes: holes([
      [4, 380, 8, "R", "none"],
      [5, 502, 12, "R", "sand"],
      [4, 390, 6, "L", "sand"],
      [4, 331, 16, "S", "ocean"],
      [3, 188, 14, "S", "ocean"],
      [5, 506, 4, "R", "sand"],
      [3, 106, 18, "S", "ocean", "Tiny clifftop par 3 over the Pacific"],
      [4, 418, 2, "R", "ocean", "Second shot over a cliff chasm"],
      [4, 462, 10, "S", "ocean"],
      [4, 446, 5, "R", "ocean"],
      [4, 380, 9, "S", "sand"],
      [3, 188, 17, "S", "none"],
      [4, 399, 7, "L", "sand"],
      [5, 572, 13, "R", "sand"],
      [4, 396, 3, "L", "sand"],
      [4, 402, 1, "L", "sand"],
      [3, 178, 15, "S", "ocean"],
      [5, 543, 11, "L", "ocean", "Par 5 hugging the bay to the green"],
    ]),
  },
  {
    slug: "st-andrews-old",
    name: "St Andrews — Old Course",
    location: "St Andrews, Scotland",
    rating: 73.1, slope: 132, difficulty: 7, wind: 20, windDir: 225, greens: "Firm",
    blurb: "The Home of Golf. Shared fairways, hidden pot bunkers and the wind off the North Sea.",
    holes: holes([
      [4, 376, 10, "S", "none"],
      [4, 453, 6, "S", "sand"],
      [4, 397, 14, "S", "sand"],
      [4, 480, 4, "S", "sand"],
      [5, 568, 12, "S", "sand"],
      [4, 412, 8, "S", "sand"],
      [4, 371, 2, "S", "sand"],
      [3, 175, 16, "S", "sand"],
      [4, 352, 18, "S", "none"],
      [4, 386, 9, "S", "none"],
      [3, 174, 15, "S", "sand"],
      [4, 348, 11, "S", "sand"],
      [4, 465, 5, "S", "sand"],
      [5, 618, 13, "S", "sand", "The Long Hole — Hell Bunker awaits"],
      [4, 455, 3, "S", "sand"],
      [4, 423, 7, "S", "sand"],
      [4, 495, 1, "R", "sand", "The Road Hole — over the hotel, bunker & road"],
      [4, 357, 17, "S", "none"],
    ]),
  },
  {
    slug: "tpc-sawgrass",
    name: "TPC Sawgrass — Stadium",
    location: "Ponte Vedra Beach, Florida",
    rating: 76.0, slope: 155, difficulty: 9, wind: 10, windDir: 90, greens: "Fast",
    blurb: "Pete Dye's water-lined gauntlet, home of THE PLAYERS and the island-green 17th.",
    holes: holes([
      [4, 423, 9, "S", "water"],
      [5, 532, 13, "R", "water"],
      [3, 177, 15, "S", "water"],
      [4, 384, 5, "R", "sand"],
      [4, 471, 3, "S", "sand"],
      [4, 393, 7, "L", "water"],
      [4, 451, 1, "L", "sand"],
      [3, 237, 11, "S", "water"],
      [5, 583, 17, "R", "sand"],
      [4, 424, 6, "S", "sand"],
      [5, 558, 12, "L", "water"],
      [4, 358, 4, "R", "sand"],
      [3, 181, 16, "S", "sand"],
      [4, 481, 8, "S", "water"],
      [4, 449, 14, "R", "water"],
      [5, 523, 2, "R", "water", "Reachable par 5 with water all down the right"],
      [3, 137, 18, "S", "water", "The Island Green — all carry, no bailout"],
      [4, 447, 10, "L", "water", "Water left the whole way home"],
    ]),
  },
  {
    slug: "pinehurst-no2",
    name: "Pinehurst No. 2",
    location: "Pinehurst, North Carolina",
    rating: 75.5, slope: 138, difficulty: 8, wind: 8, windDir: 180, greens: "Firm",
    blurb: "Donald Ross's masterpiece. No water — just turtle-back greens and sandy native scrub.",
    holes: holes([
      [4, 404, 7, "R", "sand"],
      [4, 507, 3, "S", "sand"],
      [4, 387, 11, "R", "sand"],
      [5, 529, 13, "L", "sand"],
      [4, 476, 5, "R", "sand"],
      [3, 223, 17, "S", "sand"],
      [4, 407, 1, "L", "sand"],
      [4, 488, 9, "R", "sand"],
      [3, 191, 15, "S", "sand"],
      [5, 617, 12, "L", "sand", "Long par 5 through the pines"],
      [4, 483, 6, "R", "sand"],
      [4, 484, 2, "S", "sand"],
      [4, 380, 8, "L", "sand"],
      [4, 473, 4, "R", "sand"],
      [3, 202, 18, "S", "sand"],
      [4, 489, 10, "R", "sand"],
      [3, 205, 16, "S", "sand", "Crowned green that repels anything short"],
      [4, 451, 14, "L", "sand"],
    ]),
  },
  {
    slug: "bethpage-black",
    name: "Bethpage Black",
    location: "Farmingdale, New York",
    rating: 77.5, slope: 148, difficulty: 9, wind: 12, windDir: 270, greens: "Medium",
    blurb: "The brutal public muni: deep bunkers, long carries and the famous warning sign at the 1st.",
    holes: holes([
      [4, 430, 5, "R", "sand"],
      [4, 389, 7, "L", "sand"],
      [3, 230, 17, "S", "sand"],
      [5, 517, 11, "L", "sand", "Cross-bunkered double dogleg"],
      [4, 478, 1, "L", "sand"],
      [4, 408, 9, "R", "sand"],
      [4, 489, 3, "S", "sand"],
      [3, 210, 15, "S", "sand"],
      [4, 460, 13, "L", "sand"],
      [4, 502, 4, "S", "sand"],
      [4, 435, 6, "R", "sand"],
      [4, 499, 8, "L", "sand"],
      [5, 608, 12, "R", "sand", "Monster par 5, out of reach for most"],
      [3, 161, 16, "S", "sand"],
      [4, 478, 2, "L", "sand"],
      [4, 490, 10, "R", "sand"],
      [3, 207, 18, "S", "sand"],
      [4, 411, 14, "S", "sand"],
    ]),
  },
];

export const coursePar = (c: Course) =>
  c.holes.reduce((sum, h) => sum + h.par, 0);

/** Look up a seeded course by its slug. Returns null if unknown. */
export const courseBySlug = (slug: string): Course | null =>
  COURSES.find((c) => c.slug === slug) ?? null;
