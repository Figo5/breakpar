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
  // Batch 3 (verified):
  "royal-portrush-dunluce": 71,
  "winged-foot-west": 70,
  "kiawah-ocean": 72,
  // Batch 4 (verified par totals):
  aronimink: 70,
  "quail-hollow": 71,
  "harbour-town": 71,
  "doral-blue-monster": 72,
  "royal-birkdale": 70,
  // Batch 5 (fully verified from official BlueGolf scorecards):
  "paynes-valley": 72,
  "bandon-dunes": 72,
  "chambers-bay": 72,
  "arcadia-bluffs": 72,
  "pacific-dunes": 71,
  // Batch 6 (fully verified from official BlueGolf scorecards):
  "the-country-club": 70,
  "lacc-north": 71,
  "national-golf-links": 72,
  muirfield: 71,
  "royal-melbourne": 71,
  // Batch 7 (cross-checked against current club/competition scorecards):
  "royal-dornoch": 70,
  carnoustie: 72,
  "royal-troon": 71,
  "whispering-pines": 72,
  camargo: 70,
};

describe("course catalogue integrity", () => {
  it("roster is the expected size (38 after batch 7)", () => {
    expect(COURSES.length).toBe(38);
  });

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
    // every back-nine hole the other, so handicap strokes alternate nines. Some
    // courses are even-front and others odd-front; both satisfy the invariant.
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
