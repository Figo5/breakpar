/**
 * Batch-import hole geometry from OpenStreetMap for every course in the roster.
 *
 *   npx tsx scripts/importAllHoles.ts              # all courses, uses cache
 *   npx tsx scripts/importAllHoles.ts --only=pebble-beach
 *   npx tsx scripts/importAllHoles.ts --refresh    # ignore cache, re-query
 *
 * Writes:
 *   data/osmHoleLayouts.ts       the layouts, ready to import
 *   .osm-cache/<slug>.json       raw Overpass responses (gitignored)
 *
 * Reads (optional):
 *   scripts/osm-overrides.json   per-course fixes; see below
 *
 * Nothing about the live game changes. This only reads and writes files.
 *
 * OVERRIDES. Some courses can't be resolved automatically — a geocoder matches
 * the wrong place, or a club polygon holds two courses and only you can say
 * which is which. Put those in scripts/osm-overrides.json:
 *
 *   {
 *     "tpc-sawgrass": { "boundaryName": "TPC Sawgrass", "courseIndex": 1 },
 *     "pebble-beach": { "bbox": "36.556,-121.955,36.573,-121.937" },
 *     "cypress-point": { "skip": true }
 *   }
 *
 * DATA LICENCE: © OpenStreetMap contributors, ODbL. Attribution is required
 * wherever the derived hole maps are displayed.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { COURSES } from "../data/courses";
import {
  osmCourseToLayouts,
  clipToCourse,
  groupHolesIntoCoursesDetailed,
  duplicateHoleRefs,
  missingRefs,
  presentRefs,
  isNestedInside,
  routingCentre,
  type OsmCourse,
  type OsmHoleWay,
  type OsmPolygon,
  type LatLon,
  type HoleLayout,
  type BunkerAnchor,
} from "../lib/engine/osmToLayout";
import {
  geocodeQueries,
  routingHint,
  backoffMs,
  bestBoundaryMatch,
  autoPickCluster,
  isCompleteRouting,
  bboxFromNominatim,
  padBbox,
  bboxToOverpass,
  parseBbox,
  bboxSpanMetres,
  statusOf,
  summaryLine,
  MAX_PLAUSIBLE_COURSE_SPAN_M,
  type Bbox,
  type ImportResult,
} from "../lib/engine/osmBatch";

const UA = "breakpar-hole-import/1.0 (https://breakpar.xyz)";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const CACHE_DIR = ".osm-cache";
const OVERRIDES = "scripts/osm-overrides.json";

interface Override {
  bbox?: string;
  boundaryName?: string;
  courseIndex?: number;
  skip?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Overpass is donated infrastructure. 429 (rate limited) and 504 (overloaded)
 * are normal responses under load, not bugs — the only correct reaction is to
 * back off and try again. Honour Retry-After when the server sends it.
 */
async function fetchRetrying(url: string, init: RequestInit, attempts = 5): Promise<Response> {
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    lastStatus = res.status;
    if (res.status !== 429 && res.status !== 504 && res.status !== 503) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(i);
    process.stderr.write(`(${res.status}, waiting ${Math.round(wait / 1000)}s) `);
    await sleep(wait);
  }
  throw new Error(`Overpass ${lastStatus} after ${attempts} attempts`);
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

function elementGeometry(el: OverpassElement): LatLon[] {
  if (el.geometry?.length) return el.geometry.map((p) => ({ lat: p.lat, lon: p.lon }));
  if (el.members?.length) {
    const outer = el.members.filter((m) => m.role !== "inner" && m.geometry?.length);
    return outer.flatMap((m) => m.geometry!.map((p) => ({ lat: p.lat, lon: p.lon })));
  }
  return [];
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

function overpassQuery(bbox: string): string {
  return `
[out:json][timeout:180];
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
);
out geom;
`.trim();
}

async function geocode(name: string, location: string): Promise<Bbox | null> {
  for (const q of geocodeQueries(name, location)) {
    const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    await sleep(1100); // Nominatim asks for <= 1 request/second.
    if (!res.ok) continue;
    const json = (await res.json()) as { boundingbox?: [string, string, string, string] }[];
    if (!json[0]?.boundingbox) continue;
    const bbox = bboxFromNominatim(json[0].boundingbox);
    if (bboxSpanMetres(bbox) <= MAX_PLAUSIBLE_COURSE_SPAN_M) return bbox;
    // Too big means we matched a town. Keep trying looser queries anyway —
    // but if nothing better turns up, report it rather than importing garbage.
  }
  return null;
}

async function fetchOverpass(slug: string, bbox: string, refresh: boolean): Promise<OverpassElement[]> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `${slug}.json`);

  if (!refresh && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8")).elements as OverpassElement[];
  }

  const res = await fetchRetrying(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: "data=" + encodeURIComponent(overpassQuery(bbox)),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = await res.json();
  writeFileSync(cachePath, JSON.stringify(json));
  return json.elements as OverpassElement[];
}

function loadOverrides(): Record<string, Override> {
  if (!existsSync(OVERRIDES)) return {};
  return JSON.parse(readFileSync(OVERRIDES, "utf8"));
}

/** Reduce a raw Overpass pull to the holes/polygons of ONE course. */
function selectCourse(
  courseName: string,
  elements: OverpassElement[],
  ov: Override,
  hint: string | null
): { course: OsmCourse; note?: string; needsChoice?: string } {
  const holes: OsmHoleWay[] = [];
  const polygons: OsmPolygon[] = [];
  const boundaries: { name: string; geometry: LatLon[] }[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const geometry = elementGeometry(el);
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

  let course: OsmCourse = { holes, polygons };
  const notes: string[] = [];

  // 1. Clip to the boundary whose NAME matches this course. Neighbouring clubs
  //    routinely fall inside a geocoded bbox (NGLA sits beside Shinnecock and
  //    Sebonack), so an explicit name match beats "there's only one boundary".
  const names = boundaries.map((b) => b.name);
  const wanted = ov.boundaryName ?? null;
  let matchIdx = wanted
    ? boundaries.findIndex((b) => b.name.toLowerCase().includes(wanted.toLowerCase()))
    : bestBoundaryMatch(courseName, names);
  if (matchIdx === -1) matchIdx = null as unknown as number;

  const match = matchIdx !== null && matchIdx >= 0 ? boundaries[matchIdx] : null;

  if (match) {
    const nested = boundaries
      .filter((b) => b !== match && isNestedInside(b.geometry, match.geometry))
      .map((b) => b.geometry);
    course = clipToCourse(course, match.geometry, nested);
    notes.push(`boundary "${match.name}"`);
  } else if (boundaries.length > 0) {
    notes.push(`no name match among [${names.join(" | ")}]`);
  }

  // 2. A club polygon can still hold several courses. Duplicated hole numbers
  //    prove it. Cluster, then auto-resolve ONLY when exactly one cluster is a
  //    complete 1-18 routing. Two complete routings (LACC North/South, Doral's
  //    five) genuinely need a human: guessing returns a real course, wrong one.
  if (duplicateHoleRefs(course.holes).length > 0) {
    const { clusters, ambiguous } = groupHolesIntoCoursesDetailed(course.holes);
    const refsPer = clusters.map((c) => presentRefs(c));

    let idx = ov.courseIndex ? ov.courseIndex - 1 : -1;
    if (idx < 0 || idx >= clusters.length) {
      const auto = autoPickCluster(refsPer);
      if (auto.index !== null) {
        idx = auto.index;
        notes.push(`auto-picked cluster ${idx + 1} (${auto.reason})`);
      } else {
        const lines = clusters
          .map((c, i) => {
            const ctr = routingCentre(c);
            const full = isCompleteRouting(refsPer[i]) ? " COMPLETE" : "";
            return `      [${i + 1}] ${c.length} holes${full}  refs [${refsPer[i].join(",")}]  centre ${ctr.lat.toFixed(5)},${ctr.lon.toFixed(5)}`;
          })
          .join("\n");
        const bnames = names.length ? `\n      boundaries seen: ${names.join(" | ")}` : "";
        return {
          course,
          needsChoice: `${auto.reason}. Set "courseIndex" in ${OVERRIDES}:\n${lines}${bnames}`,
        };
      }
    }

    course = { holes: clusters[idx], polygons: course.polygons };
    if (ambiguous.length) notes.push(`close-run holes ${ambiguous.map((a) => a.ref).join(",")}`);
  }

  if (hint && !ov.boundaryName && boundaries.length > 1) {
    notes.push(`hint "${hint}" unused`);
  }

  return { course, note: notes.length ? notes.join("; ") : undefined };
}

function emit(slug: string, layouts: Record<number, HoleLayout>): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return Object.entries(layouts)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([num, l]) => {
      const fw = l.fairway.map(([x, y]: [number, number]) => `[${r(x)}, ${r(y)}]`).join(", ");
      const bk = l.bunkers.map((b: BunkerAnchor) => `{ x: ${r(b.x)}, y: ${r(b.y)}, r: ${r(b.r)} }`).join(", ");
      const wa = l.waterAnchor
        ? `\n    waterAnchor: { x: ${r(l.waterAnchor.x)}, y: ${r(l.waterAnchor.y)}, r: ${r(l.waterAnchor.r)} },`
        : "";
      return `  "${slug}:${num}": {
    tee: { x: ${r(l.tee.x)}, y: ${r(l.tee.y)} },
    fairway: [${fw}],
    green: { x: ${r(l.green.x)}, y: ${r(l.green.y)}, r: ${r(l.green.r)} },
    bunkers: [${bk}],
    water: "${l.water}",${wa}
  },`;
    })
    .join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];

  const overrides = loadOverrides();
  const targets = COURSES.filter((c) => (only ? c.slug === only : true));

  if (targets.length === 0) {
    console.error(`No course matching --only=${only}`);
    process.exit(1);
  }

  const results: ImportResult[] = [];
  const blocks: string[] = [];

  for (const c of targets) {
    const ov = overrides[c.slug] ?? {};
    if (ov.skip) {
      results.push({ slug: c.slug, status: "skipped", holes: 0, missing: [] });
      continue;
    }

    process.stderr.write(`${c.slug} ... `);
    try {
      // --- bbox
      let bbox: Bbox | null = ov.bbox ? parseBbox(ov.bbox) : null;
      let fromCache = existsSync(join(CACHE_DIR, `${c.slug}.json`)) && !refresh;

      if (!bbox && !fromCache) {
        bbox = await geocode(c.name, c.location);
        if (!bbox) {
          results.push({ slug: c.slug, status: "bad-bbox", holes: 0, missing: [], note: "geocode failed" });
          console.error("geocode failed");
          continue;
        }
        if (bboxSpanMetres(bbox) > MAX_PLAUSIBLE_COURSE_SPAN_M) {
          results.push({
            slug: c.slug,
            status: "bad-bbox",
            holes: 0,
            missing: [],
            note: `geocoded area is ${Math.round(bboxSpanMetres(bbox) / 1000)}km across — set "bbox" manually`,
          });
          console.error("bbox too big");
          continue;
        }
        bbox = padBbox(bbox, 300);
      }

      // --- fetch (cache first)
      const bboxStr = bbox ? bboxToOverpass(bbox) : "0,0,0,0";
      const elements = await fetchOverpass(c.slug, bboxStr, refresh);
      if (!fromCache) await sleep(2000); // be a good citizen on a free service

      // --- select one course
      const { course, note, needsChoice } = selectCourse(c.name, elements, ov, routingHint(c.name));
      if (needsChoice) {
        results.push({ slug: c.slug, status: "ambiguous", holes: course.holes.length, missing: [], note: needsChoice });
        console.error("needs courseIndex");
        continue;
      }

      const { layouts, duplicates } = osmCourseToLayouts(course);
      if (duplicates.length) {
        results.push({
          slug: c.slug,
          status: "ambiguous",
          holes: course.holes.length,
          missing: [],
          note: `duplicate holes ${duplicates.join(",")} — separation failed`,
        });
        console.error("duplicates");
        continue;
      }

      const n = Object.keys(layouts).length;
      const missing = missingRefs(course.holes);
      results.push({ slug: c.slug, status: statusOf(n, missing, 0), holes: n, missing, note });
      if (n > 0) blocks.push(emit(c.slug, layouts));
      console.error(`${n}/18`);
    } catch (e) {
      results.push({ slug: c.slug, status: "error", holes: 0, missing: [], note: String(e) });
      console.error(`error: ${e}`);
    }
  }

  // --- write the layouts file
  const header = `// GENERATED by scripts/importAllHoles.ts — do not edit by hand.
// Data © OpenStreetMap contributors, ODbL. Attribution required where displayed.
import type { HoleLayout } from "@/lib/engine/osmToLayout";

export const OSM_LAYOUTS: Record<string, HoleLayout> = {
`;
  writeFileSync("data/osmHoleLayouts.ts", header + blocks.join("\n") + "\n};\n");

  // --- summary
  console.error("\\n" + "=".repeat(60));
  for (const r of results) console.error(summaryLine(r));
  console.error("=".repeat(60));

  const ok = results.filter((r) => r.status === "ok").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const total = results.reduce((s, r) => s + r.holes, 0);
  console.error(`\\n${ok} complete, ${partial} partial, ${total} holes total -> data/osmHoleLayouts.ts`);

  const needy = results.filter((r) => r.status === "ambiguous" || r.status === "bad-bbox");
  if (needy.length) {
    console.error(`\\n${needy.length} course(s) need a decision in ${OVERRIDES}:\\n`);
    for (const r of needy) console.error(`  ${r.slug}\\n    ${r.note}\\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
