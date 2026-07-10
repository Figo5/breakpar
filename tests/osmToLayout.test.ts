import { describe, it, expect } from "vitest";
import {
  pointInPolygon,
  latLonCentroid,
  clipToCourse,
  duplicateHoleRefs,
  groupHolesIntoRoutings,
  routingCentre,
  isNestedInside,
  groupHolesIntoCourses,
  groupHolesIntoCoursesDetailed,
  bestInjectiveAssignment,
  bestInjectiveAssignmentCost,
  presentRefs,
  missingRefs,
  toLocalMetres,
  centroid,
  meanRadius,
  rotate,
  distToPath,
  toThreeControlPoints,
  osmHoleToLayout,
  osmCourseToLayouts,
  classifyWater,
  type LatLon,
  type OsmPolygon,
} from "@/lib/engine/osmToLayout";

const ORIGIN: LatLon = { lat: 30.2, lon: -81.39 };

/** Build a lat/lon point offset from ORIGIN by (east, north) metres. */
function at(east: number, north: number): LatLon {
  const mPerDegLat = 110574;
  const mPerDegLon = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
  return { lat: ORIGIN.lat + north / mPerDegLat, lon: ORIGIN.lon + east / mPerDegLon };
}

/** A small closed polygon (square-ish) centred at (east, north). */
function blob(east: number, north: number, r: number): LatLon[] {
  return [at(east - r, north - r), at(east + r, north - r), at(east + r, north + r), at(east - r, north + r)];
}

describe("projection + geometry primitives", () => {
  it("toLocalMetres round-trips a known offset to within a metre", () => {
    const p = at(100, 50);
    const [x, y] = toLocalMetres(p, ORIGIN);
    expect(x).toBeCloseTo(100, 0);
    expect(y).toBeCloseTo(50, 0);
  });

  it("the origin maps to (0,0)", () => {
    const [x, y] = toLocalMetres(ORIGIN, ORIGIN);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it("centroid of a symmetric square is its centre", () => {
    expect(centroid([[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual([5, 5]);
  });

  it("meanRadius of a square of half-width r is r*sqrt(2)", () => {
    const r = meanRadius([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    expect(r).toBeCloseTo(Math.SQRT2, 5);
  });

  it("rotate by 90 degrees maps +x to +y", () => {
    const [x, y] = rotate([1, 0], Math.PI / 2);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
  });

  it("distToPath measures perpendicular distance to a segment", () => {
    expect(distToPath([5, 3], [[0, 0], [10, 0]])).toBeCloseTo(3, 6);
  });

  it("distToPath clamps to the segment endpoints", () => {
    expect(distToPath([-4, 0], [[0, 0], [10, 0]])).toBeCloseTo(4, 6);
  });
});

describe("toThreeControlPoints", () => {
  it("a par 3 (2 nodes) gets a synthesised midpoint", () => {
    const out = toThreeControlPoints([[0, 0], [10, 0]]);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual([5, 0]);
  });

  it("a par 4 (3 nodes) passes through unchanged", () => {
    const pts: [number, number][] = [[0, 0], [5, 2], [10, 0]];
    expect(toThreeControlPoints(pts)).toEqual(pts);
  });

  it("a par 5 (4 nodes) collapses the two middle nodes into one bend", () => {
    const out = toThreeControlPoints([[0, 0], [4, 2], [8, 4], [12, 0]]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual([0, 0]);
    expect(out[2]).toEqual([12, 0]);
    expect(out[1]).toEqual([6, 3]); // centroid of the middle two
  });
});

describe("osmHoleToLayout", () => {
  const green: OsmPolygon = { kind: "green", geometry: blob(300, 0, 12) };

  it("returns null for an unusable hole way", () => {
    expect(osmHoleToLayout({ ref: 1, geometry: [at(0, 0)] }, [])).toBeNull();
  });

  it("orients the hole tee-left, green-right regardless of compass direction", () => {
    // A hole running due NORTH should still come out left-to-right.
    const northHole = {
      ref: 1,
      par: 4,
      geometry: [at(0, 0), at(0, 150), at(0, 300)],
    };
    const northGreen: OsmPolygon = { kind: "green", geometry: blob(0, 300, 12) };
    const layout = osmHoleToLayout(northHole, [northGreen])!;
    expect(layout).not.toBeNull();
    expect(layout.green.x).toBeGreaterThan(layout.tee.x);
  });

  it("a hole running due WEST also comes out left-to-right", () => {
    const westHole = { ref: 2, par: 4, geometry: [at(0, 0), at(-150, 0), at(-300, 0)] };
    const westGreen: OsmPolygon = { kind: "green", geometry: blob(-300, 0, 12) };
    const layout = osmHoleToLayout(westHole, [westGreen])!;
    expect(layout.green.x).toBeGreaterThan(layout.tee.x);
  });

  it("keeps every coordinate inside the 400x150 viewBox", () => {
    const hole = { ref: 3, par: 5, geometry: [at(0, 0), at(150, 30), at(300, 10), at(450, 0)] };
    const g: OsmPolygon = { kind: "green", geometry: blob(450, 0, 12) };
    const bunkers: OsmPolygon[] = [
      { kind: "bunker", geometry: blob(160, 22, 8) },
      { kind: "bunker", geometry: blob(430, 16, 6) },
    ];
    const layout = osmHoleToLayout(hole, [g, ...bunkers])!;
    const pts = [
      [layout.tee.x, layout.tee.y],
      [layout.green.x, layout.green.y],
      ...layout.fairway,
      ...layout.bunkers.map((b) => [b.x, b.y]),
    ];
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(400);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(150);
    }
  });

  it("produces exactly 3 fairway control points for any par", () => {
    for (const geom of [
      [at(0, 0), at(200, 0)], // par 3
      [at(0, 0), at(180, 20), at(360, 0)], // par 4
      [at(0, 0), at(150, 20), at(300, 25), at(460, 0)], // par 5
    ]) {
      const layout = osmHoleToLayout({ ref: 1, geometry: geom }, [green])!;
      expect(layout.fairway).toHaveLength(3);
    }
  });

  it("drops bunkers belonging to a neighbouring hole (>55m off the line)", () => {
    const hole = { ref: 4, par: 4, geometry: [at(0, 0), at(180, 0), at(360, 0)] };
    const nearBunker: OsmPolygon = { kind: "bunker", geometry: blob(180, 25, 7) };
    const farBunker: OsmPolygon = { kind: "bunker", geometry: blob(180, 200, 7) };
    const g: OsmPolygon = { kind: "green", geometry: blob(360, 0, 12) };
    const layout = osmHoleToLayout(hole, [g, nearBunker, farBunker])!;
    expect(layout.bunkers).toHaveLength(1);
  });

  it("picks the green nearest the end of the playing line", () => {
    const hole = { ref: 5, par: 4, geometry: [at(0, 0), at(180, 0), at(360, 0)] };
    const rightGreen: OsmPolygon = { kind: "green", geometry: blob(360, 0, 12) };
    const otherGreen: OsmPolygon = { kind: "green", geometry: blob(900, 400, 12) };
    const layout = osmHoleToLayout(hole, [otherGreen, rightGreen])!;
    // The chosen green should sit at the right-hand end of the card.
    expect(layout.green.x).toBeGreaterThan(200);
  });
});

describe("classifyWater", () => {
  const greenPt: [number, number] = [300, 0];

  it("no water bodies -> none", () => {
    expect(classifyWater([], [[0, 0], [300, 0]], greenPt, 12)).toBe("none");
  });

  it("a big lake centred on the green -> surround (island green)", () => {
    const lake = { c: [300, 0] as [number, number], r: 60 };
    expect(classifyWater([lake], [[0, 0], [300, 0]], greenPt, 12)).toBe("surround");
  });

  it("a large body consistently left of the line -> left", () => {
    const sea = { c: [150, 80] as [number, number], r: 70 };
    expect(classifyWater([sea], [[0, 0], [300, 0]], greenPt, 12)).toBe("left");
  });

  it("a large body consistently right of the line -> right", () => {
    const sea = { c: [150, -80] as [number, number], r: 70 };
    expect(classifyWater([sea], [[0, 0], [300, 0]], greenPt, 12)).toBe("right");
  });

  it("a small pond by the green -> greenside", () => {
    const pond = { c: [280, 22] as [number, number], r: 14 };
    expect(classifyWater([pond], [[0, 0], [300, 0]], greenPt, 12)).toBe("greenside");
  });
});

describe("osmCourseToLayouts", () => {
  it("keys layouts by hole number and reports skipped holes", () => {
    const good = { ref: 1, par: 4, geometry: [at(0, 0), at(180, 0), at(360, 0)] };
    const broken = { ref: 2, par: 4, geometry: [at(0, 0)] };
    const g: OsmPolygon = { kind: "green", geometry: blob(360, 0, 12) };
    const { layouts, skipped } = osmCourseToLayouts({ holes: [good, broken], polygons: [g] });
    expect(Object.keys(layouts)).toEqual(["1"]);
    expect(skipped).toEqual([2]);
  });
});


describe("course clipping (the two-courses-in-one-bbox problem)", () => {
  // A square boundary around the origin, ~400m a side.
  const boundary = [at(-200, -200), at(200, -200), at(200, 200), at(-200, 200)];

  it("pointInPolygon: inside and outside", () => {
    expect(pointInPolygon(at(0, 0), boundary)).toBe(true);
    expect(pointInPolygon(at(5000, 0), boundary)).toBe(false);
  });

  it("pointInPolygon: a degenerate ring is never inside", () => {
    expect(pointInPolygon(at(0, 0), [at(0, 0), at(1, 1)])).toBe(false);
  });

  it("latLonCentroid averages the ring", () => {
    const c = latLonCentroid([at(-100, -100), at(100, -100), at(100, 100), at(-100, 100)]);
    const [x, y] = toLocalMetres(c, ORIGIN);
    expect(x).toBeCloseTo(0, 0);
    expect(y).toBeCloseTo(0, 0);
  });

  it("clipToCourse keeps in-bounds holes and drops the neighbouring course", () => {
    const mine = { ref: 1, par: 4, geometry: [at(-100, 0), at(0, 0), at(100, 0)] };
    const neighbour = { ref: 1, par: 4, geometry: [at(4000, 0), at(4100, 0), at(4200, 0)] };
    const myGreen: OsmPolygon = { kind: "green", geometry: blob(100, 0, 10) };
    const theirGreen: OsmPolygon = { kind: "green", geometry: blob(4200, 0, 10) };

    const clipped = clipToCourse(
      { holes: [mine, neighbour], polygons: [myGreen, theirGreen] },
      boundary
    );
    expect(clipped.holes).toHaveLength(1);
    expect(clipped.polygons).toHaveLength(1);
  });

  it("duplicateHoleRefs finds hole numbers that appear twice", () => {
    const a = { ref: 3, geometry: [at(0, 0), at(10, 0)] };
    const b = { ref: 3, geometry: [at(500, 0), at(510, 0)] };
    const c = { ref: 4, geometry: [at(0, 0), at(10, 0)] };
    expect(duplicateHoleRefs([a, b, c])).toEqual([3]);
    expect(duplicateHoleRefs([a, c])).toEqual([]);
  });

  it("osmCourseToLayouts REFUSES to emit a hole whose number is ambiguous", () => {
    const stadium = { ref: 17, par: 3, geometry: [at(0, 0), at(120, 0)] };
    const valley = { ref: 17, par: 3, geometry: [at(3000, 0), at(3120, 0)] };
    const g1: OsmPolygon = { kind: "green", geometry: blob(120, 0, 10) };
    const g2: OsmPolygon = { kind: "green", geometry: blob(3120, 0, 10) };

    const { layouts, duplicates } = osmCourseToLayouts({
      holes: [stadium, valley],
      polygons: [g1, g2],
    });
    expect(duplicates).toEqual([17]);
    expect(layouts[17]).toBeUndefined(); // never silently pick a winner
  });

  it("after clipping, the same data converts cleanly with no duplicates", () => {
    const stadium = { ref: 17, par: 3, geometry: [at(0, 0), at(120, 0)] };
    const valley = { ref: 17, par: 3, geometry: [at(3000, 0), at(3120, 0)] };
    const g1: OsmPolygon = { kind: "green", geometry: blob(120, 0, 10) };
    const g2: OsmPolygon = { kind: "green", geometry: blob(3120, 0, 10) };

    const clipped = clipToCourse({ holes: [stadium, valley], polygons: [g1, g2] }, boundary);
    const { layouts, duplicates } = osmCourseToLayouts(clipped);
    expect(duplicates).toEqual([]);
    expect(layouts[17]).toBeDefined();
  });
});


describe("groupHolesIntoRoutings (two courses, no boundary polygon)", () => {
  /** A hole from (east,north) running `len` metres east. */
  const hole = (ref: number, east: number, north: number, len = 200) => ({
    ref,
    par: 4,
    geometry: [at(east, north), at(east + len / 2, north), at(east + len, north)],
  });

  it("a single course stays as one routing", () => {
    const holes = [hole(1, 0, 0), hole(2, 220, 0), hole(3, 440, 0)];
    const routings = groupHolesIntoRoutings(holes);
    expect(routings).toHaveLength(1);
    expect(routings[0].map((h) => h.ref)).toEqual([1, 2, 3]);
  });

  it("two courses split into two chains, each with the right holes", () => {
    // Course A marches east along north=0. Course B along north=1000.
    const a = [hole(1, 0, 0), hole(2, 220, 0), hole(3, 440, 0)];
    const b = [hole(1, 0, 1000), hole(2, 220, 1000), hole(3, 440, 1000)];
    const routings = groupHolesIntoRoutings([...a, ...b]);

    expect(routings).toHaveLength(2);
    for (const r of routings) expect(r.map((h) => h.ref)).toEqual([1, 2, 3]);

    // Each chain must be internally consistent: all holes on the same latitude.
    for (const r of routings) {
      const norths = r.map((h) => Math.round(toLocalMetres(h.geometry[0], ORIGIN)[1] / 100));
      expect(new Set(norths).size).toBe(1);
    }
  });

  it("chains follow green->tee proximity even when courses interleave", () => {
    // Deliberately nasty: courses share latitudes, alternating in x.
    // A: 1 @ x=0, 2 @ x=1000.   B: 1 @ x=400, 2 @ x=1400.
    // Nearest-tee-to-last-green must keep A with A and B with B.
    const holes = [
      hole(1, 0, 0, 300),      // A1 green at x=300
      hole(1, 400, 0, 300),    // B1 green at x=700
      hole(2, 1000, 0, 300),   // A2 tee at x=1000 (300m from A1 green)
      hole(2, 720, 0, 300),    // B2 tee at x=720  (20m from B1 green)
    ];
    const routings = groupHolesIntoRoutings(holes);
    expect(routings).toHaveLength(2);

    // The chain seeded at B1 (x=400) must own the hole 2 that starts at x=720.
    const bChain = routings.find(
      (r) => Math.abs(toLocalMetres(r[0].geometry[0], ORIGIN)[0] - 400) < 1
    )!;
    expect(bChain).toBeDefined();
    const b2Tee = toLocalMetres(bChain[1].geometry[0], ORIGIN)[0];
    expect(b2Tee).toBeCloseTo(720, 0);
  });

  it("each produced routing has no duplicate hole numbers", () => {
    const a = [hole(1, 0, 0), hole(2, 220, 0)];
    const b = [hole(1, 0, 1000), hole(2, 220, 1000)];
    for (const r of groupHolesIntoRoutings([...a, ...b])) {
      expect(duplicateHoleRefs(r)).toEqual([]);
    }
  });

  it("routings are returned longest-first", () => {
    const a = [hole(1, 0, 0), hole(2, 220, 0), hole(3, 440, 0)];
    const b = [hole(1, 0, 1000)];
    const routings = groupHolesIntoRoutings([...a, ...b]);
    expect(routings[0].length).toBeGreaterThanOrEqual(routings[1].length);
  });

  it("routingCentre gives distinguishable centres for two courses", () => {
    const a = [hole(1, 0, 0)];
    const b = [hole(1, 0, 2000)];
    const [r1, r2] = groupHolesIntoRoutings([...a, ...b]);
    expect(routingCentre(r1).lat).not.toBeCloseTo(routingCentre(r2).lat, 4);
  });

  it("empty input is handled", () => {
    expect(groupHolesIntoRoutings([])).toEqual([]);
  });
});


describe("nested course boundaries (Sawgrass contains The Yards)", () => {
  // Outer: the whole club. Inner: a short course inside it.
  const outer = [at(-2000, -2000), at(2000, -2000), at(2000, 2000), at(-2000, 2000)];
  const inner = [at(500, 500), at(1500, 500), at(1500, 1500), at(500, 1500)];

  const hole = (ref: number, east: number, north: number) => ({
    ref,
    par: 4,
    geometry: [at(east, north), at(east + 100, north), at(east + 200, north)],
  });

  it("isNestedInside detects containment, and rejects the reverse", () => {
    expect(isNestedInside(inner, outer)).toBe(true);
    expect(isNestedInside(outer, inner)).toBe(false);
  });

  it("clipping to the outer boundary WITHOUT subtracting picks up both courses", () => {
    const stadium = hole(1, -1000, 0);
    const yards = hole(1, 900, 900); // inside `inner`
    const clipped = clipToCourse({ holes: [stadium, yards], polygons: [] }, outer);
    expect(clipped.holes).toHaveLength(2);
    expect(duplicateHoleRefs(clipped.holes)).toEqual([1]); // the chimera
  });

  it("subtracting the nested boundary leaves only the outer course", () => {
    const stadium = hole(1, -1000, 0);
    const yards = hole(1, 900, 900);
    const clipped = clipToCourse({ holes: [stadium, yards], polygons: [] }, outer, [inner]);
    expect(clipped.holes).toHaveLength(1);
    expect(duplicateHoleRefs(clipped.holes)).toEqual([]);
    // The survivor is the one outside the inner ring.
    expect(toLocalMetres(clipped.holes[0].geometry[0], ORIGIN)[0]).toBeCloseTo(-1000, 0);
  });

  it("subtraction also drops the nested course's polygons", () => {
    const outerGreen: OsmPolygon = { kind: "green", geometry: blob(-1000, 0, 10) };
    const innerGreen: OsmPolygon = { kind: "green", geometry: blob(1000, 1000, 10) };
    const clipped = clipToCourse({ holes: [], polygons: [outerGreen, innerGreen] }, outer, [inner]);
    expect(clipped.polygons).toHaveLength(1);
  });
});

describe("ref reporting (min-max hides gaps)", () => {
  const h = (ref: number) => ({ ref, geometry: [at(0, 0), at(100, 0)] });

  it("presentRefs is sorted and deduped", () => {
    expect(presentRefs([h(3), h(1), h(3)])).toEqual([1, 3]);
  });

  it("missingRefs finds the gaps a min-max range would hide", () => {
    // "9 holes, refs 1-13" looks fine until you list them.
    const holes = [1, 2, 3, 4, 5, 6, 7, 12, 13].map(h);
    expect(missingRefs(holes)).toEqual([8, 9, 10, 11, 14, 15, 16, 17, 18]);
  });

  it("a complete 18-hole course reports nothing missing", () => {
    const holes = Array.from({ length: 18 }, (_, i) => h(i + 1));
    expect(missingRefs(holes)).toEqual([]);
  });
});


describe("groupHolesIntoCourses (constrained clustering, seeded by duplicates)", () => {
  const hole = (ref: number, east: number, north: number) => ({
    ref,
    par: 4,
    geometry: [at(east, north), at(east + 100, north), at(east + 200, north)],
  });

  it("bestInjectiveAssignment is exact where greedy would fail", () => {
    // Greedy takes the globally-smallest pair first (p0->c0, d=1), forcing
    // p1->c1 at d=100. Total 101. Optimal is p0->c1, p1->c0 => 10 + 11 = 21.
    const points: [number, number][] = [[0, 0], [10, 0]];
    const centres: [number, number][] = [[1, 0], [10, 10]];
    const assign = bestInjectiveAssignment(points, centres);
    expect(assign[0]).not.toBe(assign[1]); // injective
    const cost =
      Math.hypot(points[0][0] - centres[assign[0]][0], points[0][1] - centres[assign[0]][1]) +
      Math.hypot(points[1][0] - centres[assign[1]][0], points[1][1] - centres[assign[1]][1]);
    expect(cost).toBeLessThan(101);
  });

  it("assigns -1 when there are more points than clusters", () => {
    const assign = bestInjectiveAssignment([[0, 0], [1, 0], [2, 0]], [[0, 0], [5, 0]]);
    expect(assign.filter((a) => a === -1)).toHaveLength(1);
  });

  it("a single course is returned untouched", () => {
    const holes = Array.from({ length: 18 }, (_, i) => hole(i + 1, i * 150, 0));
    const out = groupHolesIntoCourses(holes);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(18);
  });

  it("reproduces the real Sawgrass shape: 21 holes, dup 3/4/7/12/13, missing 10/15", () => {
    // Stadium: 16 holes in one parcel (10 and 15 unmapped).
    const stadiumRefs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18];
    const stadium = stadiumRefs.map((r, i) =>
      hole(r, (i % 4) * 220, Math.floor(i / 4) * 220)
    );
    // Dye's Valley: only 5 holes mapped, in a parcel ~1.5km away.
    const valleyRefs = [3, 4, 7, 12, 13];
    const valley = valleyRefs.map((r, i) => hole(r, 1500 + (i % 3) * 220, 1500 + Math.floor(i / 3) * 220));

    const all = [...stadium, ...valley];
    expect(all).toHaveLength(21);
    expect(duplicateHoleRefs(all)).toEqual([3, 4, 7, 12, 13]);

    const courses = groupHolesIntoCourses(all);
    expect(courses).toHaveLength(2);

    // Neither cluster may contain a repeated hole number.
    for (const c of courses) expect(duplicateHoleRefs(c)).toEqual([]);

    // The big cluster is the Stadium: 16 holes, and it keeps the unique refs
    // (1,2,5,6,8,9,11,14,16,17,18) that chaining previously mis-assigned.
    expect(courses[0]).toHaveLength(16);
    expect(courses[1]).toHaveLength(5);
    for (const uniqueRef of [1, 2, 5, 6, 8, 9, 11, 14, 16, 17, 18]) {
      expect(presentRefs(courses[0])).toContain(uniqueRef);
    }
    expect(presentRefs(courses[1])).toEqual([3, 4, 7, 12, 13]);
  });

  it("missing holes do not break the assignment (gaps are fine)", () => {
    const a = [1, 2, 5, 9].map((r, i) => hole(r, i * 200, 0));
    const b = [1, 2].map((r, i) => hole(r, 2000 + i * 200, 2000));
    const courses = groupHolesIntoCourses([...a, ...b]);
    expect(courses).toHaveLength(2);
    for (const c of courses) expect(duplicateHoleRefs(c)).toEqual([]);
    expect(courses[0].map((h) => h.ref)).toEqual([1, 2, 5, 9]);
  });

  it("every produced cluster converts with zero duplicates", () => {
    const a = [3, 4].map((r, i) => hole(r, i * 200, 0));
    const b = [3, 4].map((r, i) => hole(r, 3000 + i * 200, 0));
    for (const c of groupHolesIntoCourses([...a, ...b])) {
      const { duplicates } = osmCourseToLayouts({ holes: c, polygons: [] });
      expect(duplicates).toEqual([]);
    }
  });
});


describe("single-linkage clustering (the elongated-course problem)", () => {
  const hole = (ref: number, east: number, north: number) => ({
    ref,
    par: 4,
    geometry: [at(east, north), at(east + 60, north), at(east + 120, north)],
  });

  it("bestInjectiveAssignmentCost respects an arbitrary cost matrix", () => {
    // Hole 0 prefers cluster 1; hole 1 prefers cluster 1 more strongly.
    const costs = [
      [10, 5],
      [10, 1],
    ];
    const assign = bestInjectiveAssignmentCost(costs);
    expect(assign[1]).toBe(1); // the stronger preference wins the contested slot
    expect(assign[0]).toBe(0);
  });

  it("a centroid would mis-file an END hole; single-linkage does not", () => {
    // Course A is a long snake running east from x=0 to x=2400.
    // Its CENTROID is around x=1200.
    const aRefs = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const a = aRefs.map((r, i) => hole(r, i * 240, 0));
    // Course B sits as a tight blob near x=2600 — close to A's far END.
    const bRefs = [3, 4];
    const b = bRefs.map((r, i) => hole(r, 2600 + i * 120, 300));

    // Hole 1 belongs to A, and sits at its far end (x=2500) — nearer to B's
    // centroid than to A's centroid, but adjacent to A's hole 12.
    const aHole1 = hole(1, 2460, 0);

    const { clusters } = groupHolesIntoCoursesDetailed([...a, ...b, aHole1]);
    expect(clusters).toHaveLength(2);
    for (const c of clusters) expect(duplicateHoleRefs(c)).toEqual([]);

    const withHole1 = clusters.find((c) => c.some((h) => h.ref === 1))!;
    // It must land with the 10-hole snake, not the 2-hole blob.
    expect(withHole1.length).toBeGreaterThan(5);
    expect(presentRefs(withHole1)).toContain(12);
  });

  it("still separates the real Sawgrass shape with no duplicates", () => {
    const stadiumRefs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18];
    const stadium = stadiumRefs.map((r, i) => hole(r, (i % 4) * 200, Math.floor(i / 4) * 200));
    const valleyRefs = [3, 4, 7, 12, 13];
    const valley = valleyRefs.map((r, i) => hole(r, 2000 + (i % 3) * 200, 2000 + Math.floor(i / 3) * 200));

    const { clusters } = groupHolesIntoCoursesDetailed([...stadium, ...valley]);
    expect(clusters).toHaveLength(2);
    for (const c of clusters) expect(duplicateHoleRefs(c)).toEqual([]);
    expect(clusters[0]).toHaveLength(16);
    expect(presentRefs(clusters[0])).toContain(1); // hole 1 stays with the Stadium
    expect(presentRefs(clusters[1])).toEqual([3, 4, 7, 12, 13]);
  });

  it("flags a genuinely ambiguous hole rather than silently choosing", () => {
    // Hole 5 sits exactly between two clusters.
    const a = [1, 2].map((r, i) => hole(r, i * 150, 0));
    const b = [1, 2].map((r, i) => hole(r, 1000 + i * 150, 0));
    const middle = hole(5, 570, 0);
    const { ambiguous } = groupHolesIntoCoursesDetailed([...a, ...b, middle]);
    expect(ambiguous.some((x) => x.ref === 5)).toBe(true);
  });

  it("a clear-cut hole is not flagged", () => {
    const a = [1, 2].map((r, i) => hole(r, i * 150, 0));
    const b = [1, 2].map((r, i) => hole(r, 5000 + i * 150, 0));
    const clear = hole(5, 300, 0); // right next to course A
    const { ambiguous } = groupHolesIntoCoursesDetailed([...a, ...b, clear]);
    expect(ambiguous.some((x) => x.ref === 5)).toBe(false);
  });

  it("groupHolesIntoCourses still works as the simple wrapper", () => {
    const a = [3, 4].map((r, i) => hole(r, i * 150, 0));
    const b = [3, 4].map((r, i) => hole(r, 3000 + i * 150, 0));
    expect(groupHolesIntoCourses([...a, ...b])).toHaveLength(2);
  });
});
