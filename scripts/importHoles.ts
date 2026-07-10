/**
 * Import real hole geometry from OpenStreetMap and emit HoleLayout entries.
 *
 *   npx tsx scripts/importHoles.ts <course-slug> <south,west,north,east>
 *
 * e.g.
 *   npx tsx scripts/importHoles.ts tpc-sawgrass 30.190,-81.400,30.210,-81.385
 *
 * Prints a COVERAGE REPORT (how well OSM maps this course) and the layout
 * entries. Nothing is written automatically. Run this first purely to find out
 * whether a course has usable data before deciding to build anything on it.
 *
 *   npx tsx scripts/importHoles.ts tpc-sawgrass 30.190,-81.400,30.210,-81.385 > sawgrass.txt
 *
 * To find a bounding box: open openstreetmap.org, navigate to the course,
 * and read the lat/lon off the URL, or use the "Export" tab which shows one.
 *
 * DATA LICENCE: © OpenStreetMap contributors, ODbL. Attribution is required
 * wherever the derived hole maps are displayed. Add a credit line to the play
 * screen or the how-it-works page before shipping these.
 */

import {
  osmCourseToLayouts,
  duplicateHoleRefs,
  clipToCourse,
  groupHolesIntoRoutings,
  groupHolesIntoCoursesDetailed,
  routingCentre,
  isNestedInside,
  presentRefs,
  missingRefs,
  type OsmCourse,
  type OsmHoleWay,
  type OsmPolygon,
  type LatLon,
  type HoleLayout,
  type BunkerAnchor,
} from "../lib/engine/osmToLayout";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
// Overpass asks that clients identify themselves.
const USER_AGENT = "breakpar-hole-import/1.0 (https://breakpar.xyz)";

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  // Relations carry their coordinates on members, not on `geometry`. Missing
  // this is why `courses in box : 0` even when the boundary exists.
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

/** Coordinates for a way (el.geometry) or a relation (outer member rings). */
function elementGeometry(el: OverpassElement): LatLon[] {
  if (el.geometry?.length) return el.geometry.map((p) => ({ lat: p.lat, lon: p.lon }));
  if (el.members?.length) {
    const outer = el.members.filter((m) => m.role !== "inner" && m.geometry?.length);
    return outer.flatMap((m) => m.geometry!.map((p) => ({ lat: p.lat, lon: p.lon })));
  }
  return [];
}

function buildQuery(bbox: string): string {
  return `
[out:json][timeout:120];
(
  way["leisure"="golf_course"](${bbox});
  relation["leisure"="golf_course"](${bbox});
  way["golf"="hole"](${bbox});
  way["golf"="green"](${bbox});
  way["golf"="bunker"](${bbox});
  way["golf"="tee"](${bbox});
  way["golf"="fairway"](${bbox});
  way["golf"="water_hazard"](${bbox});
  way["golf"="lateral_water_hazard"](${bbox});
  way["golf"="penalty"](${bbox});
  way["natural"="water"](${bbox});
  way["natural"="coastline"](${bbox});
);
out geom;
`.trim();
}

function classifyPolygon(tags: Record<string, string>): OsmPolygon["kind"] | null {
  const g = tags.golf;
  if (g === "green") return "green";
  if (g === "bunker") return "bunker";
  if (g === "tee") return "tee";
  if (g === "fairway") return "fairway";
  if (g === "water_hazard" || g === "lateral_water_hazard" || g === "penalty") return "water";
  if (tags.natural === "water" || tags.natural === "coastline") return "water";
  return null;
}

async function main() {
  const [slug, bbox, courseName, courseArg2] = process.argv.slice(2);
  if (!slug || !bbox) {
    console.error("usage: npx tsx scripts/importHoles.ts <slug> <s,w,n,e> [course-name] [course-number]");
    console.error("  Run without the 3rd arg first — it lists the routings it found.");
    process.exit(1);
  }

  console.error(`Querying Overpass for bbox ${bbox} ...`);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: "data=" + encodeURIComponent(buildQuery(bbox)),
  });

  if (!res.ok) {
    console.error(`Overpass returned ${res.status}. If 429/504, wait and retry — it's a shared free service.`);
    process.exit(1);
  }

  const json = (await res.json()) as { elements: OverpassElement[] };

  const holes: OsmHoleWay[] = [];
  const polygons: OsmPolygon[] = [];
  const boundaries: { name: string; geometry: LatLon[] }[] = [];

  for (const el of json.elements) {
    const tags = el.tags ?? {};
    const geometry: LatLon[] = elementGeometry(el);
    if (geometry.length === 0) continue;

    if (tags.leisure === "golf_course") {
      boundaries.push({ name: tags.name ?? "(unnamed)", geometry });
      continue;
    }

    if (tags.golf === "hole") {
      const ref = Number(tags.ref);
      if (!Number.isInteger(ref) || ref < 1 || ref > 18) continue;
      holes.push({ ref, par: tags.par ? Number(tags.par) : undefined, geometry });
      continue;
    }

    const kind = classifyPolygon(tags);
    if (kind) polygons.push({ kind, geometry });
  }

  // --- coverage report ---------------------------------------------------
  const counts = polygons.reduce<Record<string, number>>((acc, p) => {
    acc[p.kind] = (acc[p.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.error("");
  console.error(`  golf=hole ways : ${holes.length}`);
  console.error(`  greens         : ${counts.green ?? 0}`);
  console.error(`  bunkers        : ${counts.bunker ?? 0}`);
  console.error(`  water features : ${counts.water ?? 0}`);
  console.error(`  courses in box : ${boundaries.length}`);
  for (const b of boundaries) console.error(`      - ${b.name}`);
  console.error("");

  if (holes.length === 0) {
    console.error("No golf=hole ways found. This course isn't mapped in enough detail on OSM.");
    process.exit(1);
  }

  // --- pick a single course ------------------------------------------------
  // Prefer a real boundary polygon; fall back to reconstructing routings from
  // the green->tee chain when no boundary is mapped.
  //
  // Critical: a resort's outer polygon often CONTAINS a second course. Clipping
  // to the outer ring alone scoops up both, and since every course numbers its
  // holes 1..18 that yields a silent chimera. Nested boundaries are subtracted.
  let chosen: OsmHoleWay[] = holes;
  let chosenPolys: OsmPolygon[] = polygons;

  const describe = (hs: OsmHoleWay[]) => {
    const present = presentRefs(hs);
    const missing = missingRefs(hs);
    return `${hs.length} holes  refs [${present.join(",")}]` + (missing.length ? `  MISSING ${missing.join(",")}` : "");
  };

  if (boundaries.length > 0 && courseName && !/^\d+$/.test(courseName)) {
    const match = boundaries.find((b) => b.name.toLowerCase().includes(courseName.toLowerCase()));
    if (!match) {
      console.error(`No course boundary matching "${courseName}". Names found above.`);
      process.exit(1);
    }
    const nested = boundaries
      .filter((b) => b !== match && isNestedInside(b.geometry, match.geometry))
      .map((b) => {
        console.error(`  subtracting nested course: "${b.name}"`);
        return b.geometry;
      });

    const clipped = clipToCourse({ holes, polygons }, match.geometry, nested);
    chosen = clipped.holes;
    chosenPolys = clipped.polygons;
    console.error(`\nClipped to "${match.name}": ${describe(chosen)}\n`);
  } else if (boundaries.length > 0 && !courseName) {
    console.error("Boundaries are available — clip by NAME (more reliable than routing chains):");
    for (const b of boundaries) {
      console.error(`  npx tsx scripts/importHoles.ts ${slug} ${bbox} "${b.name}"`);
    }
    console.error("");
    process.exit(1);
  } else {
    const routings = groupHolesIntoRoutings(holes);
    if (routings.length > 1) {
      console.error(`No usable boundary. Detected ${routings.length} routings by green->tee chaining:\n`);
      routings.forEach((r, i) => {
        const c = routingCentre(r);
        console.error(`  [${i + 1}] ${describe(r)}  centre ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`);
      });
      console.error("\nNOTE: chaining is a heuristic. Where hole numbers exist on only one");
      console.error("course, it can attach them to the wrong chain. Prefer a named boundary.\n");

      const pick = Number(courseName);
      if (!Number.isInteger(pick) || pick < 1 || pick > routings.length) {
        console.error(`Re-run with a routing number, e.g.:  npx tsx scripts/importHoles.ts ${slug} ${bbox} 1`);
        process.exit(1);
      }
      chosen = routings[pick - 1];
      console.error(`Using routing [${pick}]: ${describe(chosen)}\n`);
    }
  }

  // --- separate courses that share one boundary ---------------------------
  // OSM often tags ONE `leisure=golf_course` polygon for a whole club. "TPC
  // Sawgrass" covers both the Stadium course and Dye's Valley. Boundaries can't
  // split those, and green->tee chaining mis-handles hole numbers that exist on
  // only one course. But duplicates are a hard constraint: two holes numbered 3
  // are provably on different courses. Seed clusters from that.
  if (duplicateHoleRefs(chosen).length > 0) {
    const { clusters: courses, ambiguous } = groupHolesIntoCoursesDetailed(chosen);
    console.error(`\nThis boundary contains ${courses.length} courses (hole numbers repeat).`);
    console.error("Separated them by single-linkage proximity:\n");
    courses.forEach((c, i) => {
      const ctr = routingCentre(c);
      console.error(`  [${i + 1}] ${describe(c)}`);
      console.error(`      centre ${ctr.lat.toFixed(5)}, ${ctr.lon.toFixed(5)}`);
    });
    console.error("");
    if (ambiguous.length) {
      console.error("Close-run assignments — worth checking on a map:");
      for (const a of ambiguous) {
        console.error(`  hole ${a.ref}: ${a.nearest}m to its cluster vs ${a.runnerUp}m to the next`);
      }
      console.error("");
    }

    const pick = Number(courseArg2);
    if (!Number.isInteger(pick) || pick < 1 || pick > courses.length) {
      console.error("Re-run with the course number as a 4th argument, e.g.:");
      console.error(`  npx tsx scripts/importHoles.ts ${slug} ${bbox} "${courseName}" 1`);
      console.error("");
      console.error("Paste a centre into openstreetmap.org to confirm which is which.");
      process.exit(1);
    }
    chosen = courses[pick - 1];
    console.error(`Using course [${pick}]: ${describe(chosen)}\n`);
  }

  const gone = missingRefs(chosen);
  if (gone.length) {
    console.error(`NOTE: holes ${gone.join(", ")} have no OSM geometry — no layout for those.`);
  }
  if (chosenPolys.filter((p) => p.kind === "green").length === 0) {
    console.error("WARNING: no greens — green position falls back to the end of the playing line.");
  }

  const course: OsmCourse = { holes: chosen, polygons: chosenPolys };
  const { layouts, skipped, duplicates } = osmCourseToLayouts(course);

  if (duplicates.length) {
    console.error("");
    console.error(`ABORT: hole numbers still appear twice: ${duplicates.join(", ")}`);
    console.error("Course separation failed. Nothing was emitted for those holes.");
    process.exit(1);
  }

  if (skipped.length) {
    console.error(`Skipped (unusable geometry): holes ${skipped.join(", ")}`);
  }

  // --- emit ---------------------------------------------------------------
  const round = (n: number) => Math.round(n * 10) / 10;
  const entries = Object.entries(layouts)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([num, l]: [string, HoleLayout]) => {
      const fairway = l.fairway.map(([x, y]: [number, number]) => `[${round(x)}, ${round(y)}]`).join(", ");
      const bunkers = l.bunkers
        .map((b: BunkerAnchor) => `{ x: ${round(b.x)}, y: ${round(b.y)}, r: ${round(b.r)} }`)
        .join(", ");
      const anchor = l.waterAnchor
        ? `\n    waterAnchor: { x: ${round(l.waterAnchor.x)}, y: ${round(l.waterAnchor.y)}, r: ${round(l.waterAnchor.r)} },`
        : "";
      return `  "${slug}:${num}": {
    tee: { x: ${round(l.tee.x)}, y: ${round(l.tee.y)} },
    fairway: [${fairway}],
    green: { x: ${round(l.green.x)}, y: ${round(l.green.y)}, r: ${round(l.green.r)} },
    bunkers: [${bunkers}],
    water: "${l.water}",${anchor}
  },`;
    });

  console.error(`Emitting ${entries.length} layouts (stdout). Redirect to a file, or paste into your layout registry.\n`);
  console.log("  // Data © OpenStreetMap contributors, ODbL.");
  console.log(entries.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
