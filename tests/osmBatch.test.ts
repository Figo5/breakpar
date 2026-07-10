import { describe, it, expect } from "vitest";
import {
  geocodeQuery,
  geocodeQueries,
  backoffMs,
  normalizeName,
  nameMatchScore,
  bestBoundaryMatch,
  isCompleteRouting,
  autoPickCluster,
  routingHint,
  bboxFromNominatim,
  padBbox,
  bboxToOverpass,
  parseBbox,
  bboxSpanMetres,
  statusOf,
  summaryLine,
  MAX_PLAUSIBLE_COURSE_SPAN_M,
} from "@/lib/engine/osmBatch";
import { COURSES } from "@/data/courses";

describe("geocodeQuery", () => {
  it("strips the routing suffix after the em dash", () => {
    expect(geocodeQuery("TPC Sawgrass — Stadium", "Ponte Vedra Beach, Florida")).toBe(
      "TPC Sawgrass, Ponte Vedra Beach, Florida"
    );
    expect(geocodeQuery("St Andrews — Old Course", "St Andrews, Scotland")).toBe(
      "St Andrews, St Andrews, Scotland"
    );
  });

  it("leaves a plain name alone", () => {
    expect(geocodeQuery("Oakmont", "Oakmont, Pennsylvania")).toBe("Oakmont, Oakmont, Pennsylvania");
  });

  it("produces a non-empty query for every course in the roster", () => {
    for (const c of COURSES) {
      const q = geocodeQuery(c.name, c.location);
      expect(q.length, c.slug).toBeGreaterThan(3);
      expect(q).not.toContain("—");
    }
  });
});

describe("routingHint", () => {
  it("returns the part after the em dash", () => {
    expect(routingHint("TPC Sawgrass — Stadium")).toBe("Stadium");
  });
  it("returns null when there is no dash", () => {
    expect(routingHint("Oakmont")).toBeNull();
  });
});

describe("bbox handling", () => {
  it("bboxFromNominatim maps [south, north, west, east]", () => {
    const b = bboxFromNominatim(["30.19", "30.21", "-81.40", "-81.38"]);
    expect(b).toEqual({ south: 30.19, north: 30.21, west: -81.4, east: -81.38 });
  });

  it("parseBbox accepts south,west,north,east and rejects inverted boxes", () => {
    expect(parseBbox("30.190,-81.400,30.210,-81.385")).toEqual({
      south: 30.19,
      west: -81.4,
      north: 30.21,
      east: -81.385,
    });
    expect(parseBbox("30.210,-81.385,30.190,-81.400")).toBeNull(); // south > north
    expect(parseBbox("1,2,3")).toBeNull();
    expect(parseBbox("a,b,c,d")).toBeNull();
  });

  it("bboxToOverpass emits south,west,north,east", () => {
    const s = bboxToOverpass({ south: 1, west: 2, north: 3, east: 4 });
    expect(s.split(",").map(Number)).toEqual([1, 2, 3, 4]);
  });

  it("padBbox grows the box on all sides", () => {
    const b = { south: 30.19, west: -81.4, north: 30.21, east: -81.38 };
    const p = padBbox(b, 300);
    expect(p.south).toBeLessThan(b.south);
    expect(p.north).toBeGreaterThan(b.north);
    expect(p.west).toBeLessThan(b.west);
    expect(p.east).toBeGreaterThan(b.east);
  });

  it("padBbox by 300m moves each edge ~300m", () => {
    const b = { south: 30.19, west: -81.4, north: 30.21, east: -81.38 };
    const p = padBbox(b, 300);
    const latMetres = (p.north - b.north) * 110574;
    expect(latMetres).toBeCloseTo(300, -1);
  });

  it("bboxSpanMetres sizes a real course box in the low kilometres", () => {
    const sawgrass = parseBbox("30.190,-81.400,30.210,-81.385")!;
    const span = bboxSpanMetres(sawgrass);
    expect(span).toBeGreaterThan(500);
    expect(span).toBeLessThan(MAX_PLAUSIBLE_COURSE_SPAN_M);
  });

  it("flags a city-sized box as implausible for a golf course", () => {
    // Roughly greater San Francisco.
    const city = parseBbox("37.70,-122.52,37.83,-122.35")!;
    expect(bboxSpanMetres(city)).toBeGreaterThan(MAX_PLAUSIBLE_COURSE_SPAN_M);
  });
});

describe("status + summary", () => {
  it("no holes is no-data", () => {
    expect(statusOf(0, [], 0)).toBe("no-data");
  });
  it("a full 18 with no ambiguity is ok", () => {
    expect(statusOf(18, [], 0)).toBe("ok");
  });
  it("missing holes is partial", () => {
    expect(statusOf(16, [10, 15], 0)).toBe("partial");
  });
  it("ambiguity outranks partial", () => {
    expect(statusOf(16, [10, 15], 2)).toBe("ambiguous");
  });

  it("summaryLine reports missing holes when there's no explicit note", () => {
    const line = summaryLine({ slug: "tpc-sawgrass", status: "partial", holes: 16, missing: [10, 15] });
    expect(line).toContain("tpc-sawgrass");
    expect(line).toContain("16/18");
    expect(line).toContain("missing 10,15");
  });

  it("summaryLine prefers an explicit note over the missing list", () => {
    const line = summaryLine({
      slug: "x",
      status: "ambiguous",
      holes: 21,
      missing: [10],
      note: "needs courseIndex",
    });
    expect(line).toContain("needs courseIndex");
    expect(line).not.toContain("missing 10");
  });
});


describe("backoffMs", () => {
  it("grows exponentially and caps", () => {
    expect(backoffMs(0)).toBe(2000);
    expect(backoffMs(1)).toBe(4000);
    expect(backoffMs(2)).toBe(8000);
    expect(backoffMs(10)).toBe(60000);
  });
});

describe("geocodeQueries", () => {
  it("tries the specific query before the loose ones", () => {
    const qs = geocodeQueries("Bandon Dunes", "Bandon, Oregon");
    expect(qs[0]).toContain("golf course");
    expect(qs[qs.length - 1]).toBe("Bandon Dunes");
  });

  it("includes a country-only fallback", () => {
    const qs = geocodeQueries("Muirfield", "East Lothian, Scotland");
    expect(qs).toContain("Muirfield, Scotland");
  });

  it("strips the routing suffix everywhere", () => {
    for (const q of geocodeQueries("TPC Sawgrass — Stadium", "Ponte Vedra Beach, Florida")) {
      expect(q).not.toContain("—");
      expect(q).not.toContain("Stadium");
    }
  });

  it("has no duplicates, for every course in the roster", () => {
    for (const c of COURSES) {
      const qs = geocodeQueries(c.name, c.location);
      expect(new Set(qs).size, c.slug).toBe(qs.length);
      expect(qs.length).toBeGreaterThan(1);
    }
  });
});

describe("normalizeName / nameMatchScore", () => {
  it("strips the words every course shares", () => {
    expect(normalizeName("The Country Club")).toBe("country");
    expect(normalizeName("Muirfield Golf Links")).toBe("muirfield");
    expect(normalizeName("Pinehurst No. 2")).toBe("pinehurst 2");
  });

  it("scores an exact match at 1", () => {
    expect(nameMatchScore("Muirfield", "Muirfield")).toBe(1);
  });

  it("matches a course to its OSM boundary despite decoration", () => {
    expect(nameMatchScore("Pine Valley", "Pine Valley Golf Club")).toBe(1);
    expect(nameMatchScore("Winged Foot West", "Winged Foot Golf Club")).toBeCloseTo(2 / 3, 5);
  });

  it("scores an unrelated boundary near zero", () => {
    expect(nameMatchScore("Muirfield", "Gullane Golf Club")).toBe(0);
  });
});

describe("bestBoundaryMatch", () => {
  it("picks the right boundary out of neighbours (the NGLA case)", () => {
    // NGLA sits beside Shinnecock Hills and Sebonack.
    const names = ["Shinnecock Hills Golf Club", "Sebonack Golf Club", "National Golf Links of America"];
    expect(bestBoundaryMatch("National Golf Links of America", names)).toBe(2);
    expect(bestBoundaryMatch("Shinnecock Hills", names)).toBe(0);
  });

  it("refuses a weak match rather than clipping to the wrong course", () => {
    expect(bestBoundaryMatch("Muirfield", ["Gullane Golf Club", "Luffness New"])).toBeNull();
  });

  it("handles the TPC Sawgrass / The Yards pair", () => {
    expect(bestBoundaryMatch("TPC Sawgrass", ["TPC Sawgrass", "The Yards"])).toBe(0);
  });
});

describe("isCompleteRouting / autoPickCluster", () => {
  const full = Array.from({ length: 18 }, (_, i) => i + 1);

  it("recognises a complete 1-18", () => {
    expect(isCompleteRouting(full)).toBe(true);
    expect(isCompleteRouting([...full.slice(0, 17)])).toBe(false);
  });

  it("auto-picks when exactly one cluster is complete (the Winged Foot case)", () => {
    const clusters = [full, [1, 2, 3, 8, 9, 13, 14, 15, 16, 17, 18]];
    const { index } = autoPickCluster(clusters);
    expect(index).toBe(0);
  });

  it("REFUSES when two clusters are complete (the LACC North/South case)", () => {
    const { index, reason } = autoPickCluster([full, full]);
    expect(index).toBeNull();
    expect(reason).toContain("2 clusters are complete");
  });

  it("refuses Doral, where five courses share the boundary", () => {
    const { index } = autoPickCluster([full, full, full, [4, 5, 6], [1, 2, 3]]);
    expect(index).toBeNull();
  });

  it("refuses when nothing is complete (the Pebble Beach case)", () => {
    const { index, reason } = autoPickCluster([[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 18]]);
    expect(index).toBeNull();
    expect(reason).toContain("no cluster covers a full 18");
  });

  it("auto-picks Pine Valley, Harbour Town and Muirfield shapes", () => {
    expect(autoPickCluster([full, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]).index).toBe(0);
    expect(autoPickCluster([full, [7, 8, 9, 10, 11, 12, 13, 14], [14]]).index).toBe(0);
    expect(autoPickCluster([full, [1, 2, 3, 5, 6, 7, 15, 16, 18]]).index).toBe(0);
  });
});
