/**
 * Pure helpers for the batch OSM import. Kept separate from the script so they
 * can be tested without touching the network.
 */

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Build a geocoding query from a course's stored name + location.
 *
 * Course names in the roster carry a routing suffix after an em dash
 * ("TPC Sawgrass — Stadium", "St Andrews — Old Course"). Nominatim doesn't know
 * about those, and including them tanks the match rate — so strip it. The bit
 * after the dash is still useful separately, as a hint for which OSM boundary
 * or cluster to pick.
 */
export function geocodeQuery(name: string, location: string): string {
  const base = name.split("—")[0].trim();
  return `${base}, ${location}`;
}

/**
 * Progressively looser geocoding attempts. A single query fails a lot: OSM may
 * name the feature "Bethpage State Park Golf Course", or place "Cypress Point
 * Club" without the town, or know "Bandon Dunes Golf Resort" but not
 * "Bandon Dunes". Try the specific thing first, then widen.
 */
export function geocodeQueries(name: string, location: string): string[] {
  const base = name.split("—")[0].trim();
  const country = location.split(",").pop()?.trim() ?? "";
  const out = [
    `${base} golf course, ${location}`,
    `${base}, ${location}`,
    `${base} golf club, ${location}`,
    `${base}, ${country}`,
    base,
  ];
  return [...new Set(out.filter((q) => q.length > 3))];
}

/** The routing hint after the em dash, if any ("Stadium", "Old Course"). */
export function routingHint(name: string): string | null {
  const parts = name.split("—");
  return parts.length > 1 ? parts[1].trim() : null;
}

/** Nominatim returns [south, north, west, east] as strings. */
export function bboxFromNominatim(bb: [string, string, string, string]): Bbox {
  return {
    south: Number(bb[0]),
    north: Number(bb[1]),
    west: Number(bb[2]),
    east: Number(bb[3]),
  };
}

/**
 * Grow a bbox by `metres` on every side.
 *
 * Nominatim's box hugs the named feature, and a `golf=hole` way only needs one
 * node inside the query box to be returned — but greens and bunkers near the
 * edge can fall outside it entirely. A little padding avoids losing them.
 */
export function padBbox(b: Bbox, metres: number): Bbox {
  const dLat = metres / 110574;
  const midLat = (b.south + b.north) / 2;
  const dLon = metres / (111320 * Math.cos((midLat * Math.PI) / 180));
  return {
    south: b.south - dLat,
    north: b.north + dLat,
    west: b.west - dLon,
    east: b.east + dLon,
  };
}

/** Overpass wants `south,west,north,east`. */
export function bboxToOverpass(b: Bbox): string {
  return [b.south, b.west, b.north, b.east].map((n) => n.toFixed(6)).join(",");
}

export function parseBbox(s: string): Bbox | null {
  const parts = s.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [south, west, north, east] = parts;
  if (south >= north || west >= east) return null;
  return { south, west, north, east };
}

/** Rough diagonal size, to catch a geocode that returned a whole city. */
export function bboxSpanMetres(b: Bbox): number {
  const dLat = (b.north - b.south) * 110574;
  const midLat = (b.south + b.north) / 2;
  const dLon = (b.east - b.west) * 111320 * Math.cos((midLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** A golf course is ~1-3km across. Much bigger means the geocoder matched a
 * town, not a course, and the pull would be garbage. */
export const MAX_PLAUSIBLE_COURSE_SPAN_M = 8000;

export type ImportStatus = "ok" | "partial" | "ambiguous" | "no-data" | "bad-bbox" | "skipped" | "error";

/**
 * Exponential backoff for Overpass. It's a donated free service and it will
 * return 429 (rate limited) or 504 (overloaded) under load — those are normal,
 * not bugs, and the only correct response is to wait and try again.
 */
export function backoffMs(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 60000);
}

/** Strip the noise words every golf course shares, so names can be compared. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["the", "golf", "club", "course", "links", "at", "of", "no"].includes(w))
    .join(" ");
}

/**
 * Score how well an OSM boundary name matches a course name: the fraction of
 * the course's distinctive words that appear in the boundary's.
 */
export function nameMatchScore(courseName: string, boundaryName: string): number {
  const a = normalizeName(courseName).split(" ").filter(Boolean);
  const b = new Set(normalizeName(boundaryName).split(" ").filter(Boolean));
  if (a.length === 0) return 0;
  return a.filter((w) => b.has(w)).length / a.length;
}

/**
 * Pick the boundary whose name best matches the course. Requires a majority of
 * the course's words to appear — a weak match is worse than no match, because
 * clipping to the wrong polygon silently yields the wrong course.
 */
export function bestBoundaryMatch(courseName: string, boundaryNames: string[]): number | null {
  let bestIdx = -1;
  let bestScore = 0;
  boundaryNames.forEach((n, i) => {
    const s = nameMatchScore(courseName, n);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  });
  return bestScore >= 0.6 ? bestIdx : null;
}

/** Does this set of hole numbers cover a full 18? */
export function isCompleteRouting(refs: number[]): boolean {
  const s = new Set(refs);
  for (let i = 1; i <= 18; i++) if (!s.has(i)) return false;
  return true;
}

/**
 * When a boundary holds several courses, resolve it automatically only when
 * EXACTLY ONE cluster is a complete 1..18 routing. Two complete routings (LACC
 * North and South, Doral's five courses) genuinely need a human — guessing
 * would hand back a real course that is the wrong one.
 */
export function autoPickCluster(clusterRefs: number[][]): { index: number | null; reason: string } {
  const complete = clusterRefs
    .map((refs, i) => ({ i, complete: isCompleteRouting(refs) }))
    .filter((c) => c.complete);

  if (complete.length === 1) {
    return { index: complete[0].i, reason: "only one cluster is a complete 1-18 routing" };
  }
  if (complete.length === 0) {
    return { index: null, reason: "no cluster covers a full 18 holes" };
  }
  return { index: null, reason: `${complete.length} clusters are complete 1-18 routings` };
}

export interface ImportResult {
  slug: string;
  status: ImportStatus;
  holes: number;
  missing: number[];
  note?: string;
}

export function statusOf(holes: number, missing: number[], ambiguousCount: number): ImportStatus {
  if (holes === 0) return "no-data";
  if (ambiguousCount > 0) return "ambiguous";
  if (missing.length > 0) return "partial";
  return "ok";
}

/** One fixed-width line for the summary table. */
export function summaryLine(r: ImportResult): string {
  const mark: Record<ImportStatus, string> = {
    ok: "OK  ",
    partial: "PART",
    ambiguous: "AMBI",
    "no-data": "NONE",
    "bad-bbox": "BBOX",
    skipped: "SKIP",
    error: "ERR ",
  };
  const holes = r.holes ? `${r.holes}/18` : "  - ";
  const note = r.note ? `  ${r.note}` : r.missing.length ? `  missing ${r.missing.join(",")}` : "";
  return `  ${mark[r.status]}  ${r.slug.padEnd(26)} ${holes}${note}`;
}
