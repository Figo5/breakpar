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
  {
    slug: "augusta-national",
    name: "Augusta National",
    location: "Augusta, Georgia",
    // windDir assigned (not in source data): light SE breeze.
    rating: 76.2, slope: 148, difficulty: 9, wind: 6, windDir: 135, greens: "Fast",
    blurb: "Jones & MacKenzie's cathedral of azaleas. Amen Corner (11\u201313) and the Sunday back nine decide the green jacket.",
    // par + yardage are from source; strokeIndex assigned by ranked difficulty
    // (odd front / even back); dogleg + hazard inferred from course character.
    holes: holes([
      [4, 445, 9, "R", "sand"],
      [5, 575, 11, "L", "sand"],
      [4, 350, 17, "S", "sand"],
      [3, 240, 3, "S", "sand"],
      [4, 495, 1, "L", "sand"],
      [3, 180, 15, "S", "none"],
      [4, 450, 7, "S", "sand"],
      [5, 570, 13, "L", "sand"],
      [4, 460, 5, "L", "sand"],
      [4, 495, 4, "L", "sand"],
      [4, 520, 2, "L", "water"],
      [3, 155, 18, "S", "water", "Golden Bell \u2014 the perilous heart of Amen Corner over Rae's Creek"],
      [5, 545, 14, "L", "water", "Azalea \u2014 risk-and-reward par 5 bending around Rae's Creek"],
      [4, 440, 8, "S", "none"],
      [5, 550, 12, "S", "water", "Firethorn \u2014 water guards the green on the reachable par 5"],
      [3, 170, 16, "S", "water"],
      [4, 440, 10, "S", "sand"],
      [4, 465, 6, "R", "sand"],
    ]),
  },
  {
    slug: "shinnecock-hills",
    name: "Shinnecock Hills",
    location: "Southampton, New York",
    // windDir assigned (not in source data): prevailing SW sea breeze.
    rating: 75.4, slope: 146, difficulty: 9, wind: 18, windDir: 225, greens: "Firm",
    blurb: "America's oldest links test, wind-battered above the dunes. Fescue, shaved run-offs and the Redan 7th punish the timid.",
    // par + yardage from source; strokeIndex assigned (odd front / even back);
    // dogleg + hazard inferred from the links character.
    holes: holes([
      [4, 394, 17, "S", "sand"],
      [3, 252, 5, "S", "sand"],
      [4, 501, 1, "R", "sand"],
      [4, 476, 9, "S", "sand"],
      [5, 592, 11, "L", "sand"],
      [4, 495, 3, "S", "water"],
      [3, 187, 15, "S", "sand", "The Redan \u2014 a fall-away green that punishes the timid"],
      [4, 440, 13, "S", "sand"],
      [4, 482, 7, "R", "sand"],
      [4, 415, 10, "S", "sand"],
      [3, 157, 16, "S", "sand"],
      [4, 469, 8, "L", "sand"],
      [4, 371, 18, "S", "none"],
      [4, 520, 2, "R", "sand"],
      [4, 409, 12, "S", "sand"],
      [5, 614, 6, "R", "sand"],
      [3, 176, 14, "S", "sand"],
      [4, 490, 4, "S", "sand", "Home \u2014 the climbing closer to the hilltop clubhouse"],
    ]),
  },
  {
    slug: "cypress-point",
    name: "Cypress Point",
    location: "Pebble Beach, California",
    // windDir assigned (not in source data): onshore W off the Pacific.
    rating: 73.1, slope: 141, difficulty: 8, wind: 12, windDir: 270, greens: "Fast",
    blurb: "MacKenzie's coastal masterpiece \u2014 forest to dunes to raw Pacific. The back-to-back par 3s at 15 and 16 carry the ocean itself.",
    // par + yardage from source; strokeIndex assigned (odd front / even back);
    // dogleg + hazard inferred (forest \u2192 dunes \u2192 ocean routing).
    holes: holes([
      [4, 421, 1, "S", "sand"],
      [5, 548, 3, "S", "sand"],
      [3, 162, 7, "S", "sand"],
      [4, 384, 9, "R", "sand"],
      [5, 493, 15, "S", "none"],
      [5, 518, 11, "R", "sand"],
      [3, 168, 5, "S", "sand"],
      [4, 363, 13, "L", "none"],
      [4, 292, 17, "S", "sand", "A drivable par 4 tempting the bold"],
      [5, 480, 18, "S", "sand"],
      [4, 437, 4, "S", "none"],
      [4, 404, 6, "L", "none"],
      [4, 365, 14, "R", "sand"],
      [4, 388, 10, "S", "sand"],
      [3, 139, 12, "S", "ocean"],
      [3, 231, 2, "S", "ocean", "A ~231-yard par 3 carrying the open Pacific"],
      [4, 393, 8, "L", "ocean", "Cliff-edge tee shot hugging the coastline"],
      [4, 346, 16, "S", "sand"],
    ]),
  },
  {
    slug: "pine-valley",
    name: "Pine Valley",
    location: "Pine Valley, New Jersey",
    // windDir assigned (not in source data): light inland SSW.
    rating: 76.0, slope: 155, difficulty: 10, wind: 8, windDir: 200, greens: "Firm",
    blurb: "Often ranked the world's #1. Islands of fairway in a sea of sand and pine \u2014 Hell's Half Acre (7) and the Devil's pot bunker (10) await.",
    // par + yardage from source; strokeIndex assigned (odd front / even back);
    // dogleg + hazard inferred \u2014 sand everywhere, per the sea-of-sand layout.
    holes: holes([
      [4, 421, 11, "R", "sand"],
      [4, 367, 15, "S", "sand"],
      [3, 198, 9, "S", "sand"],
      [4, 461, 3, "R", "sand"],
      [3, 232, 1, "S", "sand"],
      [4, 388, 13, "L", "sand"],
      [5, 585, 5, "S", "sand", "Hell's Half Acre \u2014 a vast sandy waste splits the par 5"],
      [4, 327, 17, "S", "sand"],
      [4, 432, 7, "R", "sand"],
      [3, 145, 14, "S", "sand", "The Devil's pot bunker guards the short par 3"],
      [4, 397, 12, "L", "sand"],
      [4, 337, 18, "S", "sand"],
      [4, 486, 2, "R", "sand"],
      [3, 184, 10, "S", "sand"],
      [5, 603, 6, "L", "sand"],
      [4, 436, 8, "S", "sand"],
      [4, 345, 16, "S", "sand"],
      [4, 483, 4, "R", "sand"],
    ]),
  },
  {
    slug: "cabot-links",
    name: "Cabot Links",
    location: "Inverness, Nova Scotia",
    // windDir assigned (not in source data): NW off the Gulf of St. Lawrence.
    rating: 73.6, slope: 137, difficulty: 7, wind: 18, windDir: 315, greens: "Firm",
    // Designer Rod Whitman (NOT Coore & Crenshaw \u2014 that's the sister course
    // Cabot Cliffs). No designer field in schema, so the credit lives here.
    blurb: "Rod Whitman's links on the Gulf of St. Lawrence \u2014 Canada's first true links. Every hole sees the sea; the 100-yard 16th hangs over the water.",
    // par + yardage from source; strokeIndex assigned (odd front / even back);
    // dogleg + hazard inferred \u2014 ocean on the seaside holes, sand elsewhere.
    holes: holes([
      [5, 506, 15, "S", "sand"],
      [4, 410, 7, "S", "sand"],
      [4, 300, 17, "S", "ocean", "A drivable par 4 aimed at the ocean"],
      [3, 175, 9, "S", "sand"],
      [4, 455, 3, "S", "sand"],
      [4, 425, 5, "R", "ocean", "The Cape hole bending along the harbour"],
      [3, 160, 13, "S", "sand"],
      [4, 470, 1, "L", "sand"],
      [4, 405, 11, "S", "sand"],
      [4, 415, 12, "S", "sand"],
      [5, 560, 10, "S", "sand"],
      [4, 430, 6, "L", "sand"],
      [4, 445, 4, "S", "sand"],
      [3, 200, 8, "S", "ocean"],
      [4, 380, 16, "S", "sand"],
      [3, 100, 18, "S", "ocean", "A ~100-yard wedge to an infinity green over the water"],
      [4, 415, 14, "S", "ocean"],
      [4, 470, 2, "S", "sand"],
    ]),
  },
  {
    // Par + par-type + yardage verified across multiple sources; strokeIndex
    // derived (odd front / even back). Bunker-heavy, so hazard defaults to sand.
    slug: "oakmont",
    name: "Oakmont Country Club",
    location: "Oakmont, Pennsylvania",
    rating: 77.5, slope: 150, difficulty: 10, wind: 8, windDir: 270, greens: "Fast",
    blurb: "America's sternest test — lightning greens, the Church Pews, and a par-70 with only two par 5s.",
    holes: holes([
      [4, 488, 5, "S", "sand"],
      [4, 346, 13, "S", "sand"],
      [4, 462, 7, "L", "sand", "Church Pews bunkers line the left"],
      [5, 611, 9, "L", "sand"],
      [4, 408, 11, "R", "sand"],
      [3, 200, 15, "S", "sand"],
      [4, 485, 3, "S", "sand"],
      [3, 289, 17, "S", "sand", "One of championship golf's longest par 3s (~289 yds)"],
      [4, 477, 1, "S", "sand"],
      [4, 461, 4, "R", "sand"],
      [4, 379, 14, "S", "sand"],
      [5, 632, 8, "S", "sand"],
      [3, 183, 16, "S", "sand"],
      [4, 379, 12, "S", "sand"],
      [4, 507, 2, "L", "sand"],
      [3, 231, 10, "S", "sand"],
      [4, 312, 18, "S", "sand", "A drivable par 4 ringed by deep bunkers"],
      [4, 502, 6, "S", "sand"],
    ]),
  },
  {
    // Par/par-type/yardage verified; strokeIndex derived (odd front / even back).
    slug: "merion-east",
    name: "Merion Golf Club — East",
    location: "Ardmore, Pennsylvania",
    rating: 74.0, slope: 144, difficulty: 8, wind: 8, windDir: 225, greens: "Fast",
    blurb: "Wicker-basket flags and a par-70 quirk: both par 5s in the first four holes, Hogan's 1-iron to finish.",
    holes: holes([
      [4, 350, 13, "R", "sand"],
      [5, 556, 7, "S", "sand"],
      [3, 256, 9, "S", "sand"],
      [5, 628, 1, "R", "sand"],
      [4, 504, 3, "L", "sand"],
      [4, 487, 5, "R", "sand"],
      [4, 360, 15, "S", "sand"],
      [4, 359, 11, "L", "sand"],
      [3, 236, 17, "S", "sand"],
      [4, 303, 16, "S", "sand"],
      [4, 367, 14, "R", "water", "Babbling Brook guards the green"],
      [4, 403, 10, "S", "sand"],
      [3, 115, 18, "S", "sand", "A tiny wedge par 3 to a bunkered green"],
      [4, 464, 6, "S", "sand"],
      [4, 411, 8, "S", "sand"],
      [4, 430, 4, "R", "sand", "The Quarry hole — a long carry to the green"],
      [3, 246, 12, "S", "sand"],
      [4, 521, 2, "S", "sand", "Hogan's 1-iron to the 72nd green"],
    ]),
  },
  {
    // Par/par-type/yardage verified; strokeIndex derived (odd front / even back).
    // Lake-Michigan holes flagged water; Pete Dye's 1,000+ bunkers are sand.
    slug: "whistling-straits",
    name: "Whistling Straits — Straits",
    location: "Sheboygan, Wisconsin",
    rating: 77.2, slope: 151, difficulty: 9, wind: 18, windDir: 315, greens: "Firm",
    blurb: "Pete Dye's faux-links along Lake Michigan — a thousand bunkers and the wind off the water.",
    holes: holes([
      [4, 408, 11, "S", "sand"],
      [5, 593, 7, "S", "sand"],
      [3, 181, 15, "S", "water"],
      [4, 489, 1, "L", "sand"],
      [5, 569, 9, "R", "sand"],
      [4, 355, 13, "S", "sand"],
      [3, 221, 5, "S", "water", "Shipwreck — a par 3 along Lake Michigan"],
      [4, 507, 3, "S", "sand"],
      [4, 446, 17, "S", "water"],
      [4, 361, 12, "S", "sand"],
      [5, 618, 8, "S", "sand"],
      [3, 143, 18, "S", "water", "Pop Up — a short par 3 perched above the lake"],
      [4, 404, 14, "S", "sand"],
      [4, 372, 10, "S", "sand"],
      [4, 518, 2, "L", "sand"],
      [5, 569, 6, "R", "sand"],
      [3, 223, 4, "S", "water", "Pinched Nerve — a clifftop par 3 over the lake"],
      [4, 520, 16, "L", "sand", "Dyeabolical — the closing hole"],
    ]),
  },
  {
    // Par/par-type/yardage verified; strokeIndex derived (odd front / even back).
    // Fescue-and-bunker test, no water in play — sand or none.
    slug: "erin-hills",
    name: "Erin Hills",
    location: "Erin, Wisconsin",
    rating: 76.4, slope: 139, difficulty: 8, wind: 16, windDir: 270, greens: "Firm",
    blurb: "Firm, wide and wind-blown over glacial terrain and waist-high fescue — a par-5 finish.",
    holes: holes([
      [5, 608, 9, "S", "sand"],
      [4, 347, 15, "S", "none"],
      [4, 505, 3, "L", "sand"],
      [4, 450, 7, "R", "sand"],
      [4, 508, 5, "S", "sand"],
      [3, 217, 13, "S", "sand"],
      [5, 607, 11, "L", "sand"],
      [4, 430, 1, "S", "sand"],
      [3, 135, 17, "S", "sand", "A tiny par 3 set into the fescue"],
      [4, 410, 8, "R", "sand"],
      [4, 391, 14, "S", "none"],
      [4, 460, 4, "L", "sand"],
      [3, 195, 16, "S", "sand"],
      [5, 594, 10, "R", "sand"],
      [4, 372, 12, "S", "none"],
      [3, 196, 18, "S", "sand"],
      [4, 451, 6, "S", "sand"],
      [5, 637, 2, "S", "sand"],
    ]),
  },
  {
    // Par/par-type/yardage verified; strokeIndex derived (odd front / even back).
    // Pacific-cliff holes flagged ocean; the 18th plays over a pond (water).
    slug: "torrey-pines-south",
    name: "Torrey Pines — South",
    location: "La Jolla, California",
    rating: 78.0, slope: 144, difficulty: 9, wind: 12, windDir: 250, greens: "Firm",
    blurb: "A muscular public U.S. Open course on the Pacific bluffs — long, exposed, and a water-guarded par-5 home hole.",
    holes: holes([
      [4, 452, 11, "S", "sand"],
      [4, 389, 13, "R", "sand"],
      [3, 198, 15, "S", "ocean"],
      [4, 488, 3, "L", "ocean", "A clifftop par 4 along the Pacific"],
      [4, 453, 7, "S", "sand"],
      [5, 560, 9, "R", "ocean"],
      [4, 462, 5, "S", "sand"],
      [3, 173, 17, "S", "sand"],
      [5, 614, 1, "S", "sand"],
      [4, 416, 10, "S", "sand"],
      [3, 221, 16, "S", "sand"],
      [4, 504, 2, "R", "sand", "The card's hardest hole — a long par 4 into the wind"],
      [5, 612, 12, "L", "sand"],
      [4, 437, 8, "S", "sand"],
      [4, 478, 4, "S", "sand"],
      [3, 227, 14, "S", "ocean"],
      [4, 442, 6, "R", "sand"],
      [5, 568, 18, "S", "water", "A risk-reward par 5 over the pond to the 72nd green"],
    ]),
  },
  {
    // Par 71 verified (3 par-5s / 4 par-3s / 11 par-4s); yardage = championship
    // (2025 Open) back tees; strokeIndex derived (odd front / even back). Links:
    // sand/dunes throughout, with the ocean feel on the clifftop 5th & 6th.
    // Hole names are the real Dunluce hole names, carried as signatures.
    slug: "royal-portrush-dunluce",
    name: "Royal Portrush — Dunluce Links",
    location: "Portrush, Northern Ireland",
    rating: 76.0, slope: 141, difficulty: 9, wind: 20, windDir: 315, greens: "Firm",
    blurb: "The 2019 & 2025 Open host — dramatic clifftop links with the fewest bunkers on the rota, defended by dunes, elevation and Atlantic wind. Calamity Corner waits at 16.",
    holes: holes([
      [4, 420, 7, "S", "sand", "Hughie's"],
      [5, 575, 11, "R", "sand", "Giant's Grave"],
      [3, 176, 15, "S", "sand", "Islay"],
      [4, 502, 1, "L", "sand", "Fred Daly's — the card's hardest hole"],
      [4, 372, 13, "R", "ocean", "White Rocks — along the clifftop"],
      [3, 193, 9, "S", "ocean", "Harry Colt's"],
      [5, 607, 5, "L", "sand", "Curran Point"],
      [4, 434, 3, "S", "sand", "Dunluce"],
      [4, 432, 17, "R", "sand", "Darren Clarke's"],
      [4, 373, 12, "S", "sand", "Himalayas"],
      [4, 475, 2, "L", "sand", "Tavern"],
      [5, 532, 16, "R", "sand", "Dhu Varren"],
      [3, 199, 14, "S", "sand", "Feather Bed"],
      [4, 466, 4, "S", "sand", "Causeway"],
      [4, 429, 8, "L", "sand", "Skerries"],
      [3, 236, 6, "S", "sand", "Calamity Corner — 236 yds over a chasm"],
      [4, 409, 10, "R", "sand", "Purgatory"],
      [4, 474, 18, "S", "sand", "Babington's"],
    ]),
  },
  {
    // Par 70 verified (2 par-5s at 5/12; 4 par-3s at 3/7/10/13; 12 par-4s);
    // yardage = 2020 US Open back tees; strokeIndex derived (odd front / even
    // back). Tillinghast parkland — bunkers throughout, so hazard = sand.
    slug: "winged-foot-west",
    name: "Winged Foot — West",
    location: "Mamaroneck, New York",
    rating: 77.0, slope: 140, difficulty: 9, wind: 8, windDir: 270, greens: "Fast",
    blurb: "A.W. Tillinghast's brute — small, fiercely contoured greens and a punishing par-4 finish. At the 2020 US Open only one man broke par all week.",
    holes: holes([
      [4, 450, 9, "S", "sand"],
      [4, 453, 7, "R", "sand"],
      [3, 243, 15, "S", "sand"],
      [4, 469, 5, "L", "sand"],
      [5, 515, 13, "R", "sand"],
      [4, 321, 17, "S", "sand", "A short, tempting par 4 to a tiny green"],
      [3, 162, 11, "S", "sand"],
      [4, 475, 3, "L", "sand"],
      [4, 514, 1, "R", "sand", "A long par 4 — the card's hardest"],
      [3, 188, 16, "S", "sand"],
      [4, 397, 12, "S", "sand"],
      [5, 640, 8, "R", "sand", "A mammoth par 5 stretching to 640 yds"],
      [3, 214, 14, "S", "sand"],
      [4, 458, 6, "L", "sand"],
      [4, 416, 10, "S", "sand"],
      [4, 478, 2, "R", "sand"],
      [4, 504, 4, "L", "sand"],
      [4, 469, 18, "S", "sand", "Tillinghast's brutal closing par 4"],
    ]),
  },
  {
    // Par 72 verified (4 par-5s at 2/7/11/16; 4 par-3s at 5/8/14/17; 10 par-4s);
    // yardage = 2021 PGA back tees; strokeIndex derived (odd front / even back).
    // Pete Dye ocean links — ocean/water on the seaside holes, sand elsewhere.
    slug: "kiawah-ocean",
    name: "Kiawah Island — Ocean Course",
    location: "Kiawah Island, South Carolina",
    rating: 79.0, slope: 144, difficulty: 10, wind: 18, windDir: 135, greens: "Firm",
    blurb: "Pete Dye's wind-lashed masterpiece — host of 'War by the Shore' and two PGA Championships, with more seaside holes than any course in the northern hemisphere.",
    holes: holes([
      [4, 395, 11, "S", "sand"],
      [5, 543, 9, "R", "ocean"],
      [4, 390, 13, "S", "sand"],
      [4, 453, 5, "L", "water"],
      [3, 207, 15, "S", "ocean"],
      [4, 455, 3, "R", "sand"],
      [5, 579, 7, "L", "ocean", "A reachable par 5 hugging the dunes"],
      [3, 197, 17, "S", "water"],
      [4, 464, 1, "R", "sand", "The card's hardest — a long par 4 into the wind"],
      [4, 439, 8, "S", "sand"],
      [5, 593, 10, "L", "water"],
      [4, 466, 4, "R", "sand"],
      [4, 404, 12, "S", "ocean"],
      [3, 194, 16, "S", "ocean"],
      [4, 470, 2, "L", "sand"],
      [5, 579, 14, "R", "ocean"],
      [3, 221, 6, "S", "ocean", "A long par 3 fully exposed to the sea wind"],
      [4, 439, 18, "S", "ocean", "A dramatic ocean-side closing hole"],
    ]),
  },
  // ---- Batch 4 (appended; rotation stays append-stable) --------------------
  {
    // Par 70 verified (par-3s at 3/6/8/14; par-5s at 9/16; 12 par-4s); yardage
    // verified; strokeIndex derived (odd front / even back). Ross parkland, so
    // hazard defaults to sand. ⚠️ hole-level pars/positions partly derived.
    slug: "aronimink",
    name: "Aronimink Golf Club",
    location: "Newtown Square, Pennsylvania",
    rating: 74.5, slope: 145, difficulty: 8, wind: 6, windDir: 200, greens: "Fast",
    blurb: "A Donald Ross parkland classic — crowned greens and demanding par 4s on a par-70 that has tested BMW Championship fields.",
    holes: holes([
      [4, 448, 7, "R", "sand"],
      [4, 405, 13, "S", "sand"],
      [3, 191, 15, "S", "sand"],
      [4, 480, 1, "L", "sand", "The card's sternest — a 480-yd par 4 to a crowned Ross green"],
      [4, 435, 9, "R", "sand"],
      [3, 232, 11, "S", "sand"],
      [4, 446, 5, "L", "sand"],
      [3, 172, 17, "S", "sand"],
      [5, 578, 3, "R", "sand"],
      [4, 405, 12, "S", "sand"],
      [4, 400, 14, "L", "sand"],
      [4, 460, 2, "R", "sand"],
      [4, 452, 6, "S", "sand"],
      [3, 200, 16, "S", "sand"],
      [4, 421, 10, "L", "sand"],
      [5, 542, 8, "R", "sand", "A reachable par 5 to tempt a birdie run"],
      [4, 440, 4, "S", "sand"],
      [4, 460, 18, "L", "sand"],
    ]),
  },
  {
    // Par 71 verified (par-3s at 4/6/13/17; par-5s at 7/10/15; 11 par-4s); layout
    // confirmed; strokeIndex derived (odd front / even back). Water on the
    // closing "Green Mile" (16-17-18); sand elsewhere.
    slug: "quail-hollow",
    name: "Quail Hollow Club",
    location: "Charlotte, North Carolina",
    rating: 75.5, slope: 148, difficulty: 8, wind: 7, windDir: 220, greens: "Fast",
    blurb: "A modern PGA Championship venue closing with the fearsome water-lined 'Green Mile' — holes 16, 17 and 18.",
    holes: holes([
      [4, 460, 7, "L", "sand"],
      [4, 452, 9, "R", "sand"],
      [4, 483, 3, "S", "sand"],
      [3, 184, 15, "S", "sand"],
      [4, 449, 11, "R", "sand"],
      [3, 249, 13, "S", "sand"],
      [5, 546, 5, "L", "sand"],
      [4, 346, 17, "S", "sand"],
      [4, 458, 1, "R", "sand", "The card's hardest — a long par 4 to a guarded green"],
      [5, 592, 8, "L", "sand"],
      [4, 462, 6, "S", "sand"],
      [4, 456, 10, "R", "sand"],
      [3, 210, 14, "S", "sand"],
      [4, 344, 16, "L", "sand"],
      [5, 577, 12, "R", "sand"],
      [4, 505, 2, "L", "water", "Start of the Green Mile — a brute of a par 4 to a water-guarded green"],
      [3, 223, 18, "S", "water", "A long par 3 over water"],
      [4, 494, 4, "R", "water", "The Green Mile's closing test, water down the left"],
    ]),
  },
  {
    // Par 71 verified (par-3s at 4/7/14/17; par-5s at 2/5/15; 11 par-4s); yardage
    // verified; strokeIndex derived (odd front / even back). Pete Dye — lagoons
    // and pot bunkers; Calibogue Sound alongside the closing hole.
    slug: "harbour-town",
    name: "Harbour Town Golf Links",
    location: "Hilton Head Island, South Carolina",
    rating: 74.0, slope: 148, difficulty: 7, wind: 12, windDir: 110, greens: "Firm",
    blurb: "Pete Dye's short, strategic gem through tight Lowcountry oaks, closing at the iconic lighthouse on Calibogue Sound.",
    holes: holes([
      [4, 414, 11, "R", "sand"],
      [5, 505, 9, "S", "water"],
      [4, 436, 7, "L", "sand"],
      [3, 200, 15, "S", "water"],
      [5, 535, 5, "R", "sand"],
      [4, 419, 3, "L", "water"],
      [3, 192, 17, "S", "water"],
      [4, 470, 1, "R", "sand", "The card's hardest — a long, tree-pinched par 4"],
      [4, 337, 13, "S", "sand"],
      [4, 439, 8, "L", "water"],
      [4, 436, 6, "S", "sand"],
      [4, 451, 4, "R", "sand"],
      [4, 375, 12, "L", "water"],
      [3, 192, 16, "S", "water"],
      [5, 575, 10, "R", "water"],
      [4, 439, 2, "L", "sand"],
      [3, 185, 14, "S", "water"],
      [4, 472, 18, "L", "ocean", "The iconic lighthouse hole along Calibogue Sound"],
    ]),
  },
  {
    // Par 72 verified (par-3s at 4/9/13/15; par-5s at 1/8/10/12; 10 par-4s);
    // yardage verified; strokeIndex derived (odd front / even back). Gil Hanse
    // redesign — water-heavy with sand. ⚠️ exact hole positions partly derived.
    slug: "doral-blue-monster",
    name: "Trump National Doral — Blue Monster",
    location: "Miami, Florida",
    rating: 76.5, slope: 150, difficulty: 9, wind: 12, windDir: 130, greens: "Firm",
    blurb: "The Blue Monster — a long, firm, water-heavy Florida test with a brutal closing par 4 hugging the lake all the way home.",
    holes: holes([
      [5, 562, 9, "S", "water"],
      [4, 407, 11, "R", "sand"],
      [4, 434, 7, "L", "water"],
      [3, 234, 13, "S", "sand"],
      [4, 473, 3, "R", "water"],
      [4, 447, 5, "L", "sand"],
      [4, 430, 15, "S", "water"],
      [5, 599, 1, "R", "water", "The card's hardest — a 599-yd par 5 flanked by water"],
      [3, 178, 17, "S", "water"],
      [5, 564, 8, "L", "water"],
      [4, 440, 6, "R", "sand"],
      [5, 603, 10, "S", "water"],
      [3, 245, 12, "S", "sand"],
      [4, 483, 2, "L", "water"],
      [3, 175, 16, "S", "water"],
      [4, 280, 14, "R", "sand", "A drivable par 4 daring you to go for it"],
      [4, 436, 4, "L", "water"],
      [4, 473, 18, "L", "water", "Water down the entire left of the famous closing par 4"],
    ]),
  },
  {
    // Par 70 verified (par-3s at 4/7/12/14; par-5s at 15/17; 12 par-4s); front
    // nine + par total verified from the official 2026 Open guide; strokeIndex
    // derived (odd front / even back). ⚠️ some back-nine yardages derived. Links
    // sand/dunes throughout; OB tight right on 1.
    slug: "royal-birkdale",
    name: "Royal Birkdale",
    location: "Southport, England",
    rating: 74.8, slope: 143, difficulty: 9, wind: 20, windDir: 245, greens: "Firm",
    blurb: "A classic Southport links through towering dunes — an Open Championship venue where the wind off the Irish Sea decides the card.",
    holes: holes([
      [4, 447, 5, "R", "sand", "Out-of-bounds tight down the right off the first tee"],
      [4, 419, 11, "S", "sand"],
      [4, 450, 7, "L", "sand"],
      [3, 219, 13, "S", "sand"],
      [4, 321, 17, "S", "sand"],
      [4, 514, 1, "R", "sand", "The card's toughest — a brute of a par 4 through the dunes"],
      [3, 151, 15, "S", "sand"],
      [4, 459, 3, "L", "sand"],
      [4, 411, 9, "R", "sand"],
      [4, 408, 8, "S", "sand"],
      [4, 436, 6, "L", "sand"],
      [3, 184, 14, "S", "sand"],
      [4, 499, 2, "R", "sand"],
      [3, 201, 16, "S", "sand"],
      [5, 544, 10, "L", "sand"],
      [4, 439, 4, "R", "sand"],
      [5, 572, 12, "S", "sand", "A reachable par 5 among the closing dunes"],
      [4, 508, 18, "L", "sand", "A long closing par 4 to the grandstands"],
    ]),
  },
];

export const coursePar = (c: Course) =>
  c.holes.reduce((sum, h) => sum + h.par, 0);

/** Look up a seeded course by its slug. Returns null if unknown. */
export const courseBySlug = (slug: string): Course | null =>
  COURSES.find((c) => c.slug === slug) ?? null;
