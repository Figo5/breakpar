import { describe, it, expect } from "vitest";
import { COURSES, coursePar, type Dogleg, type Hazard } from "@/data/courses";

const DOGLEGS: Dogleg[] = ["S", "L", "R"];
const HAZARDS: Hazard[] = ["none", "sand", "water", "ocean"];

// Verified par totals for the courses whose cards were cross-checked.
const EXPECTED_PAR: Record<string, number> = {
  oakmont: 70,
  "merion-east": 70,
  "whistling-straits": 72,
  "erin-hills": 72,
  "torrey-pines-south": 72,
};

describe("course catalogue integrity", () => {
  it("every course has 18 holes", () => {
    for (const c of COURSES) expect(c.holes.length, c.slug).toBe(18);
  });

  it("slugs are unique (rotation enumerates them once)", () => {
    const slugs = COURSES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("hole numbers are 1..18 in order", () => {
    for (const c of COURSES)
      expect(c.holes.map((h) => h.number), c.slug).toEqual(
        Array.from({ length: 18 }, (_, i) => i + 1)
      );
  });

  it("each course's strokeIndex is a permutation of 1..18", () => {
    const want = Array.from({ length: 18 }, (_, i) => i + 1);
    for (const c of COURSES) {
      const si = c.holes.map((h) => h.strokeIndex).sort((a, b) => a - b);
      expect(si, c.slug).toEqual(want);
    }
  });

  it("splits stroke index one parity per nine, opposite nines", () => {
    // The standard derived-SI split: every front-nine hole shares one parity and
    // every back-nine hole the other, so handicap strokes alternate nines. (Some
    // existing courses are even-front, the new five odd-front — both are valid;
    // the invariant is single-parity-per-nine, opposite to the other nine.)
    for (const c of COURSES) {
      const front = new Set(c.holes.slice(0, 9).map((h) => h.strokeIndex % 2));
      const back = new Set(c.holes.slice(9).map((h) => h.strokeIndex % 2));
      expect(front.size, `${c.slug} front nine`).toBe(1);
      expect(back.size, `${c.slug} back nine`).toBe(1);
      expect([...front][0], `${c.slug} nines opposite parity`).not.toBe([...back][0]);
    }
  });

  it("pars are 3..5 and dogleg/hazard use only known enums", () => {
    for (const c of COURSES) {
      for (const h of c.holes) {
        expect(h.par, `${c.slug} hole ${h.number}`).toBeGreaterThanOrEqual(3);
        expect(h.par, `${c.slug} hole ${h.number}`).toBeLessThanOrEqual(5);
        expect(DOGLEGS, `${c.slug} hole ${h.number}`).toContain(h.dogleg);
        expect(HAZARDS, `${c.slug} hole ${h.number}`).toContain(h.hazard);
      }
    }
  });

  it("verified courses sum to their documented par total", () => {
    for (const [slug, par] of Object.entries(EXPECTED_PAR)) {
      const c = COURSES.find((x) => x.slug === slug);
      expect(c, slug).toBeDefined();
      expect(coursePar(c!), slug).toBe(par);
    }
  });
});
