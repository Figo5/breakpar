/**
 * OSM → HoleLayout conversion (pure geometry, no network).
 *
 * OpenStreetMap models a golf hole as a `golf=hole` way drawn along the
 * playing path from tee to green, where the node count is (par - 1). So a
 * par 3 is a straight tee→green line, a par 4 has one intermediary node at
 * the scratch-golfer landing area, a par 5 has two. Those intermediary nodes
 * ARE the dogleg — exactly what a hole layout wants for its fairway bend.
 *
 * Greens, bunkers, tees and penalty areas are separate polygons.
 *
 * This module is SELF-CONTAINED on purpose: it defines the layout shape it
 * emits, so you can run the importer and check OSM coverage without having
 * committed to any particular renderer. A renderer can import these types.
 *
 * Data © OpenStreetMap contributors, ODbL. Attribution required wherever the
 * derived hole maps are displayed.
 */

export type WaterStyle = "none" | "surround" | "left" | "right" | "carry" | "greenside";

export interface BunkerAnchor {
  x: number;
  y: number;
  r: number; // rough radius; a renderer can turn this into an irregular blob
}

export interface HoleLayout {
  tee: { x: number; y: number };
  /** Control points from tee to green. The bend is the intermediary point(s). */
  fairway: [number, number][];
  green: { x: number; y: number; r: number };
  bunkers: BunkerAnchor[];
  water: WaterStyle;
  /** Only used when water is "greenside" — a pond anchor near the green. */
  waterAnchor?: { x: number; y: number; r: number };
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** A `golf=hole` way: the playing path, plus its tags. */
export interface OsmHoleWay {
  ref: number; // hole number
  par?: number;
  geometry: LatLon[];
}

/** Any closed polygon feature we care about (green / bunker / water). */
export interface OsmPolygon {
  kind: "green" | "bunker" | "water" | "tee" | "fairway";
  geometry: LatLon[];
}

export interface OsmCourse {
  holes: OsmHoleWay[];
  polygons: OsmPolygon[];
}

// --- projection ---------------------------------------------------------

/** Equirectangular projection to metres, accurate at golf-course scale. */
export function toLocalMetres(p: LatLon, origin: LatLon): [number, number] {
  const mPerDegLat = 110574;
  const mPerDegLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return [(p.lon - origin.lon) * mPerDegLon, (p.lat - origin.lat) * mPerDegLat];
}

export function centroid(pts: [number, number][]): [number, number] {
  if (pts.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  return [sx / pts.length, sy / pts.length];
}

/** Mean distance from centroid to vertices — a stand-in "radius" for a blob. */
export function meanRadius(pts: [number, number][]): number {
  if (pts.length === 0) return 0;
  const [cx, cy] = centroid(pts);
  let sum = 0;
  for (const [x, y] of pts) sum += Math.hypot(x - cx, y - cy);
  return sum / pts.length;
}

/** Rotate a point about the origin by `angle` radians. */
export function rotate([x, y]: [number, number], angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

export function distToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Shortest distance from a point to a polyline. */
export function distToPath(p: [number, number], path: [number, number][]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return Math.hypot(p[0] - path[0][0], p[1] - path[0][1]);
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, distToSegment(p, path[i], path[i + 1]));
  }
  return best;
}

/** Ray-casting point-in-polygon. Operates in lon/lat space, which is fine at
 * course scale. `poly` is a closed or open ring. */
export function pointInPolygon(pt: LatLon, poly: LatLon[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lon;
    const yi = poly[i].lat;
    const xj = poly[j].lon;
    const yj = poly[j].lat;
    const intersects =
      yi > pt.lat !== yj > pt.lat && pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Centroid of a lat/lon ring, in lat/lon. */
export function latLonCentroid(pts: LatLon[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const p of pts) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / pts.length, lon: lon / pts.length };
}

/**
 * Clip a raw OSM pull down to a single course boundary, optionally subtracting
 * boundaries nested inside it.
 *
 * A resort's outer `leisure=golf_course` polygon often *contains* a second
 * course (e.g. a short course inside the club grounds). Clipping to the outer
 * ring alone scoops up both, and since every course numbers its holes 1..18
 * that silently produces a chimera. So exclusions are subtracted.
 *
 * A feature belongs if its centroid is inside `boundary` and inside none of
 * `exclusions`.
 */
export function clipToCourse(
  course: OsmCourse,
  boundary: LatLon[],
  exclusions: LatLon[][] = []
): OsmCourse {
  if (boundary.length < 3) return course;
  const keep = (geometry: LatLon[]) => {
    const c = latLonCentroid(geometry);
    if (!pointInPolygon(c, boundary)) return false;
    return !exclusions.some((ex) => ex.length >= 3 && pointInPolygon(c, ex));
  };
  return {
    holes: course.holes.filter((h) => keep(h.geometry)),
    polygons: course.polygons.filter((p) => keep(p.geometry)),
  };
}

/** Is `inner` nested inside `outer`? Centroid test — enough for course rings. */
export function isNestedInside(inner: LatLon[], outer: LatLon[]): boolean {
  if (inner.length < 3 || outer.length < 3) return false;
  return pointInPolygon(latLonCentroid(inner), outer);
}

/** Hole numbers 1..18 that are absent. An 18-hole course should return []. */
export function missingRefs(holes: OsmHoleWay[]): number[] {
  const present = new Set(holes.map((h) => h.ref));
  const missing: number[] = [];
  for (let i = 1; i <= 18; i++) if (!present.has(i)) missing.push(i);
  return missing;
}

/** Sorted list of hole numbers actually present — never print just min-max,
 * it hides gaps. */
export function presentRefs(holes: OsmHoleWay[]): number[] {
  return [...new Set(holes.map((h) => h.ref))].sort((a, b) => a - b);
}

/** Hole numbers that appear more than once. Non-empty means the pull spans
 * more than one course (or a hole is mapped twice) — the caller must not
 * silently pick a winner. */
export function duplicateHoleRefs(holes: OsmHoleWay[]): number[] {
  const seen = new Map<number, number>();
  for (const h of holes) seen.set(h.ref, (seen.get(h.ref) ?? 0) + 1);
  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([ref]) => ref)
    .sort((a, b) => a - b);
}

/**
 * Separate holes into distinct COURSE ROUTINGS without needing a boundary
 * polygon.
 *
 * The insight is golf-specific: a routing is a chain. Hole n's green sits close
 * to hole n+1's tee, because you walk from one to the next. Two courses sharing
 * a bbox produce two disjoint chains, even when their holes interleave
 * geographically.
 *
 * So: seed one chain per copy of the lowest hole number, then walk upward,
 * assigning each candidate to whichever chain's last green is nearest its tee
 * (greedy global-minimum matching at each level).
 *
 * More robust than boundary clipping, because plenty of courses have detailed
 * hole data but no `leisure=golf_course` polygon — which is exactly what the
 * Sawgrass pull showed.
 */
export function groupHolesIntoRoutings(holes: OsmHoleWay[]): OsmHoleWay[][] {
  if (holes.length === 0) return [];

  const origin = holes[0].geometry[0];
  const teeOf = (h: OsmHoleWay) => toLocalMetres(h.geometry[0], origin);
  const greenOf = (h: OsmHoleWay) => toLocalMetres(h.geometry[h.geometry.length - 1], origin);

  const byRef = new Map<number, OsmHoleWay[]>();
  for (const h of holes) {
    if (!byRef.has(h.ref)) byRef.set(h.ref, []);
    byRef.get(h.ref)!.push(h);
  }
  const refs = [...byRef.keys()].sort((a, b) => a - b);
  if (refs.length === 0) return [];

  // Number of routings = the most copies any single hole number has.
  const nRoutings = Math.max(...refs.map((r) => byRef.get(r)!.length));
  if (nRoutings === 1) return [holes.slice().sort((a, b) => a.ref - b.ref)];

  // Seed from the first hole number that has a full set of copies.
  const seedRef = refs.find((r) => byRef.get(r)!.length === nRoutings) ?? refs[0];
  const chains: OsmHoleWay[][] = byRef.get(seedRef)!.map((h) => [h]);

  for (const ref of refs) {
    if (ref === seedRef) continue;
    const candidates = byRef.get(ref)!.slice();

    // Greedy min-cost assignment: repeatedly take the closest (chain, candidate).
    const pairs: { ci: number; hi: number; d: number }[] = [];
    chains.forEach((chain, ci) => {
      const lastGreen = greenOf(chain[chain.length - 1]);
      candidates.forEach((c, hi) => {
        const tee = teeOf(c);
        pairs.push({ ci, hi, d: Math.hypot(lastGreen[0] - tee[0], lastGreen[1] - tee[1]) });
      });
    });
    pairs.sort((a, b) => a.d - b.d);

    const usedChain = new Set<number>();
    const usedCand = new Set<number>();
    for (const p of pairs) {
      if (usedChain.has(p.ci) || usedCand.has(p.hi)) continue;
      chains[p.ci].push(candidates[p.hi]);
      usedChain.add(p.ci);
      usedCand.add(p.hi);
      if (usedCand.size === candidates.length) break;
    }
  }

  for (const c of chains) c.sort((a, b) => a.ref - b.ref);
  // Longest (most complete) routing first.
  return chains.sort((a, b) => b.length - a.length);
}

/** Rough centre of a routing, for reporting which is which. */
export function routingCentre(holes: OsmHoleWay[]): LatLon {
  const pts = holes.flatMap((h) => h.geometry);
  return latLonCentroid(pts);
}

/**
 * Separate holes into distinct COURSES using constrained spatial clustering.
 *
 * This exists because neither of the earlier approaches survives reality:
 *
 *  - Boundary clipping fails when OSM tags ONE `leisure=golf_course` polygon
 *    for a whole club that contains two courses (e.g. "TPC Sawgrass" covers
 *    both the Stadium course and Dye's Valley).
 *  - Green->tee chaining fails wherever a hole number exists on only one
 *    course: there's a single candidate, and greedy matching can attach it to
 *    the wrong chain. Missing holes break the chain entirely.
 *
 * The key insight is that duplicates are a HARD CONSTRAINT, not a nuisance:
 * two holes both numbered 3 cannot belong to the same course. So seed one
 * cluster per copy of a duplicated hole number, then assign every other hole
 * to the nearest cluster centroid — subject to the rule that a cluster may
 * hold at most one hole of any given number.
 *
 * Spatial centroids are robust to gaps: missing holes 10 and 15 don't matter,
 * because a unique hole 12 is placed by *where it is*, not by what precedes it.
 */
export function groupHolesIntoCourses(holes: OsmHoleWay[]): OsmHoleWay[][] {
  return groupHolesIntoCoursesDetailed(holes).clusters;
}

/** A hole whose assignment was close-run — the nearest two clusters were within
 * `ratio` of each other. Worth eyeballing on a map. */
export interface AmbiguousAssignment {
  ref: number;
  chosen: number; // cluster index
  nearest: number; // metres to chosen cluster
  runnerUp: number; // metres to next-nearest cluster
}

/**
 * Separate holes into distinct COURSES using constrained clustering seeded by
 * duplicate hole numbers.
 *
 * Why not boundaries: OSM often tags ONE `leisure=golf_course` polygon for a
 * whole club, so "TPC Sawgrass" covers the Stadium course *and* Dye's Valley.
 * Why not green->tee chaining: it mis-handles hole numbers that exist on only
 * one course, and missing holes snap the chain.
 *
 * Duplicates are the hard constraint that makes this tractable: two holes both
 * numbered 3 are provably on different courses. Seed one cluster per copy.
 *
 * Distance is SINGLE-LINKAGE — distance to the nearest hole already in a
 * cluster, not to the cluster's centroid. A golf routing is a long snake, not a
 * blob; a centroid sits in the middle of the property, so holes at either END
 * of a routing (hole 1, hole 18) can look closer to a neighbouring course than
 * to their own. That is exactly how Sawgrass's 1st ended up filed with the
 * wrong course.
 */
export function groupHolesIntoCoursesDetailed(holes: OsmHoleWay[]): {
  clusters: OsmHoleWay[][];
  ambiguous: AmbiguousAssignment[];
} {
  if (holes.length === 0) return { clusters: [], ambiguous: [] };

  const origin = holes[0].geometry[0];
  const ptsOf = (h: OsmHoleWay) => h.geometry.map((p) => toLocalMetres(p, origin));

  /** Nearest distance between any node of hole `h` and any node of `cluster`. */
  const linkDist = (h: OsmHoleWay, cluster: OsmHoleWay[]): number => {
    if (cluster.length === 0) return Infinity;
    const a = ptsOf(h);
    let best = Infinity;
    for (const other of cluster) {
      for (const q of ptsOf(other)) {
        for (const p of a) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d < best) best = d;
        }
      }
    }
    return best;
  };

  const byRef = new Map<number, OsmHoleWay[]>();
  for (const h of holes) {
    if (!byRef.has(h.ref)) byRef.set(h.ref, []);
    byRef.get(h.ref)!.push(h);
  }

  const k = Math.max(...[...byRef.values()].map((v) => v.length));
  if (k === 1) return { clusters: [holes.slice().sort((a, b) => a.ref - b.ref)], ambiguous: [] };

  // Seed from the duplicated hole number whose copies are furthest apart.
  const seedGroups = [...byRef.entries()].filter(([, v]) => v.length === k);
  let bestSeed = seedGroups[0][1];
  let bestSpread = -1;
  for (const [, group] of seedGroups) {
    let spread = 0;
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) spread += linkDist(group[i], [group[j]]);
    if (spread > bestSpread) {
      bestSpread = spread;
      bestSeed = group;
    }
  }

  const clusters: OsmHoleWay[][] = bestSeed.map((h) => [h]);
  const ambiguous: AmbiguousAssignment[] = [];

  // Grow the clusters outward: process duplicated numbers first (they carry the
  // constraint), then singletons, nearest-first so a cluster has neighbours to
  // link against before distant holes are considered.
  const remaining = [...byRef.entries()]
    .filter(([ref]) => !bestSeed.some((s) => s.ref === ref))
    .sort((a, b) => b[1].length - a[1].length);

  const pending: [number, OsmHoleWay[]][] = remaining;

  while (pending.length) {
    // Pick the group with the single closest link to any cluster — growing from
    // the nearest outward keeps the snake connected.
    let bestIdx = 0;
    let bestD = Infinity;
    pending.forEach(([, group], i) => {
      for (const h of group) {
        for (const c of clusters) {
          const d = linkDist(h, c);
          if (d < bestD) {
            bestD = d;
            bestIdx = i;
          }
        }
      }
    });

    const [, group] = pending.splice(bestIdx, 1)[0];
    const costs = group.map((h) => clusters.map((c) => linkDist(h, c)));
    const assign = bestInjectiveAssignmentCost(costs);

    assign.forEach((clusterIdx, holeIdx) => {
      if (clusterIdx < 0) return;
      const row = costs[holeIdx].slice().sort((a, b) => a - b);
      if (row.length > 1 && row[1] < row[0] * 1.5) {
        ambiguous.push({
          ref: group[holeIdx].ref,
          chosen: clusterIdx,
          nearest: Math.round(row[0]),
          runnerUp: Math.round(row[1]),
        });
      }
      clusters[clusterIdx].push(group[holeIdx]);
    });
  }

  for (const c of clusters) c.sort((a, b) => a.ref - b.ref);
  return {
    clusters: clusters.filter((c) => c.length > 0).sort((a, b) => b.length - a.length),
    ambiguous,
  };
}

/**
 * Assign each point to at most one distinct cluster, minimising total distance.
 * Cluster counts here are tiny (2-3), so exhaustive search is both exact and
 * cheap — and unlike greedy matching it can't paint itself into a corner.
 * Returns cluster index per point, or -1 if unassigned.
 */
/**
 * Assign each row (hole) to at most one distinct column (cluster), minimising
 * total cost. Exhaustive: cluster counts are 2-3, so this is exact and cheap,
 * and unlike greedy matching it cannot paint itself into a corner.
 *
 * `costs[i][c]` is the cost of putting hole i in cluster c. Returns a cluster
 * index per hole, or -1 if unassigned.
 */
export function bestInjectiveAssignmentCost(costs: number[][]): number[] {
  const n = costs.length;
  const k = n > 0 ? costs[0].length : 0;
  // Leaving a hole unassigned must be possible (a hole number can appear more
  // often than there are courses) but strongly disfavoured — otherwise the
  // search would happily drop everything. Costs are metres.
  const SKIP_COST = 1e7;

  const best = { cost: Infinity, assign: new Array<number>(n).fill(-1) };
  const used = new Array<boolean>(k).fill(false);
  const current = new Array<number>(n).fill(-1);

  const recurse = (i: number, cost: number) => {
    if (cost >= best.cost) return;
    if (i === n) {
      best.cost = cost;
      best.assign = current.slice();
      return;
    }
    for (let c = 0; c < k; c++) {
      if (used[c]) continue;
      used[c] = true;
      current[i] = c;
      recurse(i + 1, cost + costs[i][c]);
      used[c] = false;
      current[i] = -1;
    }
    current[i] = -1;
    recurse(i + 1, cost + SKIP_COST);
    current[i] = -1;
  };
  recurse(0, 0);
  return best.assign;
}

/** Back-compat wrapper: assignment by distance to cluster centres. */
export function bestInjectiveAssignment(
  points: [number, number][],
  centres: [number, number][]
): number[] {
  const costs = points.map((p) => centres.map((c) => Math.hypot(p[0] - c[0], p[1] - c[1])));
  return bestInjectiveAssignmentCost(costs);
}

// --- the conversion -----------------------------------------------------

/** The viewBox HoleMap draws into. Matches the existing hole card exactly. */
const VIEW_W = 400;
const VIEW_H = 150;
const PAD = 26;

/** Bunkers further than this (metres) from the playing line are ignored —
 * they belong to a neighbouring hole. */
const BUNKER_MAX_DIST_M = 55;
/** Water further than this from the playing line isn't in play. */
const WATER_MAX_DIST_M = 70;

/** Reduce a playing path of any length to exactly 3 control points, which is
 * what the ribbon renderer consumes: tee, bend, green. For a par 5 (4 nodes)
 * we take the middle two and average them into a single bend. */
export function toThreeControlPoints(pts: [number, number][]): [number, number][] {
  if (pts.length <= 1) return [pts[0] ?? [0, 0], pts[0] ?? [0, 0], pts[0] ?? [0, 0]];
  if (pts.length === 2) {
    const mid: [number, number] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    return [pts[0], mid, pts[1]];
  }
  if (pts.length === 3) return [pts[0], pts[1], pts[2]];
  const middle = pts.slice(1, -1);
  return [pts[0], centroid(middle), pts[pts.length - 1]];
}

/**
 * Convert one OSM hole (plus the course's polygons) into a HoleLayout in the
 * 400x150 viewBox, oriented tee-left → green-right.
 *
 * Returns null if the hole way has fewer than 2 nodes (unusable).
 */
export function osmHoleToLayout(hole: OsmHoleWay, polygons: OsmPolygon[]): HoleLayout | null {
  if (hole.geometry.length < 2) return null;

  const origin = hole.geometry[0];
  const path = hole.geometry.map((p) => toLocalMetres(p, origin));

  // Rotate so the tee→green vector points along +x.
  const teePt = path[0];
  const greenPt = path[path.length - 1];
  const angle = -Math.atan2(greenPt[1] - teePt[1], greenPt[0] - teePt[0]);
  const rPath = path.map((p) => rotate(p, angle));

  // Pull in the polygons that belong to this hole.
  const project = (poly: OsmPolygon) =>
    poly.geometry.map((p) => rotate(toLocalMetres(p, origin), angle));

  const rGreenPt = rPath[rPath.length - 1];

  const greens = polygons
    .filter((p) => p.kind === "green")
    .map(project)
    .map((pts) => ({ pts, c: centroid(pts), r: meanRadius(pts) }))
    .sort((a, b) => Math.hypot(a.c[0] - rGreenPt[0], a.c[1] - rGreenPt[1]) - Math.hypot(b.c[0] - rGreenPt[0], b.c[1] - rGreenPt[1]));
  const green = greens[0];

  const bunkers = polygons
    .filter((p) => p.kind === "bunker")
    .map(project)
    .map((pts) => ({ pts, c: centroid(pts), r: meanRadius(pts) }))
    .filter((b) => distToPath(b.c, rPath) < BUNKER_MAX_DIST_M);

  const waters = polygons
    .filter((p) => p.kind === "water")
    .map(project)
    .map((pts) => ({ pts, c: centroid(pts), r: meanRadius(pts) }))
    .filter((w) => distToPath(w.c, rPath) < WATER_MAX_DIST_M);

  // --- fit everything into the viewBox -----------------------------------
  const all: [number, number][] = [
    ...rPath,
    ...(green ? green.pts : []),
    ...bunkers.flatMap((b) => b.pts),
  ];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  // Uniform scale so bunkers stay round; fit whichever axis binds.
  const scale = Math.min((VIEW_W - PAD * 2) / spanX, (VIEW_H - PAD * 2) / spanY);

  const offX = (VIEW_W - spanX * scale) / 2;
  const offY = (VIEW_H - spanY * scale) / 2;
  // SVG y grows downward, so flip.
  const tx = (p: [number, number]): [number, number] => [
    (p[0] - minX) * scale + offX,
    VIEW_H - ((p[1] - minY) * scale + offY),
  ];

  const vPath = rPath.map(tx);
  const fairway = toThreeControlPoints(vPath) as [number, number][];

  const vGreenC = green ? tx(green.c) : vPath[vPath.length - 1];
  const vGreenR = green ? Math.max(green.r * scale, 8) : 13;

  const vBunkers: BunkerAnchor[] = bunkers.map((b) => {
    const [x, y] = tx(b.c);
    return { x, y, r: Math.max(b.r * scale, 4) };
  });

  const water = classifyWater(waters, rPath, rGreenPt, green?.r ?? 12);

  const layout: HoleLayout = {
    tee: { x: vPath[0][0], y: vPath[0][1] },
    fairway,
    green: { x: vGreenC[0], y: vGreenC[1], r: vGreenR },
    bunkers: vBunkers,
    water,
  };

  if (water === "greenside" && waters.length > 0) {
    const nearest = waters.reduce((a, b) =>
      Math.hypot(a.c[0] - rGreenPt[0], a.c[1] - rGreenPt[1]) <
      Math.hypot(b.c[0] - rGreenPt[0], b.c[1] - rGreenPt[1])
        ? a
        : b
    );
    const [wx, wy] = tx(nearest.c);
    layout.waterAnchor = { x: wx, y: wy, r: Math.max(nearest.r * scale, 10) };
  }

  return layout;
}

/**
 * Decide how water relates to the hole. Heuristic, meant to be eyeballed:
 * - surround: water sits within a green-radius or two on most sides of the green
 * - left / right: water hugs one side of the playing line for much of its length
 * - greenside: a pond near the green but not surrounding it
 */
export function classifyWater(
  waters: { c: [number, number]; r: number }[],
  rPath: [number, number][],
  rGreenPt: [number, number],
  greenR: number
): WaterStyle {
  if (waters.length === 0) return "none";

  const teePt = rPath[0];
  const holeLen = Math.max(Math.hypot(rGreenPt[0] - teePt[0], rGreenPt[1] - teePt[1]), 1);

  const nearGreen = waters.filter(
    (w) => Math.hypot(w.c[0] - rGreenPt[0], w.c[1] - rGreenPt[1]) < w.r + greenR * 3
  );

  // Island green: a body big relative to the green, centred essentially on it.
  const surrounding = nearGreen.find(
    (w) => w.r > greenR * 1.8 && Math.hypot(w.c[0] - rGreenPt[0], w.c[1] - rGreenPt[1]) < w.r * 0.6
  );
  if (surrounding) return "surround";

  // A coastline/ocean band must be big relative to the HOLE, not merely bigger
  // than the green — otherwise any greenside pond reads as an ocean. After
  // rotation the playing line runs along +x, so sign(y) gives the side.
  const BAND_MIN = holeLen * 0.18;
  const sides = waters.map((w) => Math.sign(w.c[1]));
  const total = waters.length;
  const allLeft = sides.every((s) => s > 0);
  const allRight = sides.every((s) => s < 0);
  const hasBand = waters.some((w) => w.r > BAND_MIN);

  if (total >= 1 && hasBand && allLeft) return "left";
  if (total >= 1 && hasBand && allRight) return "right";

  if (nearGreen.length > 0) return "greenside";
  return "none";
}

/**
 * Convert a whole course. Returns layouts keyed by hole number, holes that
 * couldn't be converted, and any DUPLICATE hole numbers.
 *
 * Duplicates are reported rather than resolved: two holes numbered 3 means the
 * data spans two courses, and picking one arbitrarily would produce a hole map
 * that looks plausible and is wrong. Clip to a course boundary first.
 */
export function osmCourseToLayouts(course: OsmCourse): {
  layouts: Record<number, HoleLayout>;
  skipped: number[];
  duplicates: number[];
} {
  const duplicates = duplicateHoleRefs(course.holes);
  const layouts: Record<number, HoleLayout> = {};
  const skipped: number[] = [];
  for (const hole of course.holes) {
    if (duplicates.includes(hole.ref)) continue; // ambiguous — never guess
    const layout = osmHoleToLayout(hole, course.polygons);
    if (layout) layouts[hole.ref] = layout;
    else skipped.push(hole.ref);
  }
  return { layouts, skipped, duplicates };
}
