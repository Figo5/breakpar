import { describe, it, expect } from "vitest";
import { COURSES } from "@/data/courses";
import {
  regionOf, characterOf, wetHoleCount, courseYardage,
  REGION_ORDER, REGION_META, CHARACTER_ORDER, CHARACTER_META,
  type Region,
} from "@/lib/courseFacets";

describe("course facets — region", () => {
  it("places every course in a known region", () => {
    for (const c of COURSES) {
      const r = regionOf(c.location);
      expect(REGION_ORDER, `${c.slug} -> ${r}`).toContain(r);
    }
  });

  it("every region bucket is non-empty (no dead filter chips)", () => {
    // A chip that can never match anything is a UI bug, not a filter.
    const counts = new Map<Region, number>();
    for (const c of COURSES) {
      const r = regionOf(c.location);
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    for (const r of REGION_ORDER) {
      expect(counts.get(r) ?? 0, `${REGION_META[r].label} has no courses`).toBeGreaterThan(0);
    }
  });

  it("regions partition the roster — every course counted exactly once", () => {
    const total = REGION_ORDER.reduce(
      (sum, r) => sum + COURSES.filter((c) => regionOf(c.location) === r).length,
      0
    );
    expect(total).toBe(COURSES.length);
  });

  it("maps known places correctly", () => {
    expect(regionOf("Springfield, New Jersey")).toBe("northeast");
    expect(regionOf("Bethesda, Maryland")).toBe("south");
    expect(regionOf("Dublin, Ohio")).toBe("midwest");
    expect(regionOf("Pebble Beach, California")).toBe("west");
    expect(regionOf("Dornoch, Scotland")).toBe("uk-ireland");
    expect(regionOf("Melbourne, Australia")).toBe("international");
  });

  it("falls back to international rather than throwing on an unmapped place", () => {
    // A newly added course is always browsable, just in the catch-all bucket.
    expect(regionOf("Somewhere, Patagonia")).toBe("international");
    expect(regionOf("")).toBe("international");
  });
});

describe("course facets — character", () => {
  it("only ever emits known tags", () => {
    for (const c of COURSES) {
      for (const t of characterOf(c)) {
        expect(CHARACTER_ORDER, `${c.slug} -> ${t}`).toContain(t);
      }
    }
  });

  it("every character chip matches at least one course", () => {
    for (const t of CHARACTER_ORDER) {
      const n = COURSES.filter((c) => characterOf(c).includes(t)).length;
      expect(n, `${CHARACTER_META[t].label} matches nothing`).toBeGreaterThan(0);
    }
  });

  it("tags describe rather than partition — a course may hold several", () => {
    // Pebble is both exposed and water-defined; that overlap is intentional.
    const pebble = COURSES.find((c) => c.slug === "pebble-beach");
    expect(pebble).toBeDefined();
    expect(characterOf(pebble!)).toContain("water");
  });

  it("parkland and links are mutually exclusive by construction", () => {
    // links needs wind >= 14, parkland needs wind <= 10 — they cannot co-occur.
    for (const c of COURSES) {
      const t = characterOf(c);
      expect(t.includes("links") && t.includes("parkland"), c.slug).toBe(false);
    }
  });

  it("water tag tracks the real wet-hole count", () => {
    for (const c of COURSES) {
      expect(characterOf(c).includes("water"), c.slug).toBe(wetHoleCount(c) >= 5);
    }
  });
});

describe("course facets — yardage", () => {
  it("sums the hole yardages", () => {
    for (const c of COURSES) {
      expect(courseYardage(c), c.slug).toBe(c.holes.reduce((s, h) => s + h.yardage, 0));
    }
  });

  it("every course lands in a plausible championship range", () => {
    for (const c of COURSES) {
      expect(courseYardage(c), c.slug).toBeGreaterThan(6000);
      expect(courseYardage(c), c.slug).toBeLessThan(8200);
    }
  });
});
