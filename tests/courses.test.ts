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
  // Batch 8 (championship cards cross-checked against club/PGA sources):
  "prairie-dunes": 70,
  seminole: 72,
  riviera: 71,
  "muirfield-village": 72,
  "tpc-potomac": 70,
  // Batch 9 — NY/NJ (fully verified from official BlueGolf scorecards, except
  // Oak Hill which uses the published 2023 PGA Championship hole-by-hole card):
  "baltusrol-lower": 72,
  "quaker-ridge": 70,
  // NOTE: Fishers Island is par 70, not 72 — the real card is 35/35 (6,597 yds).
  "fishers-island": 70,
  "oak-hill-east": 70,
  "somerset-hills": 71,
  // Batch 10 — Congressional (BlueGolf Back card, post-Andrew-Green restoration):
  "congressional-blue": 72,
  // Batch 11 — links + Sand Hills (BlueGolf championship cards):
  "royal-county-down": 71,
  "ballybunion-old": 71,
  "sand-hills": 71,
  "turnberry-ailsa": 71,
};

const EXPECTED_YARDAGE: Record<string, number> = {
  "prairie-dunes": 6947,
  seminole: 7265,
  riviera: 7383,
  "muirfield-village": 7573,
  "tpc-potomac": 7107,
  // Batch 9 — championship-tee totals from the same sources as the pars above.
  "baltusrol-lower": 7550,
  "quaker-ridge": 7023,
  "fishers-island": 6597,
  "oak-hill-east": 7394,
  "somerset-hills": 6703,
  "congressional-blue": 7820,
  "royal-county-down": 7183,
  "ballybunion-old": 6802,
  "sand-hills": 7073,
  "turnberry-ailsa": 7489,
};

describe("course catalogue integrity", () => {
  it("roster is the expected size (53 after batch 11)", () => {
    expect(COURSES.length).toBe(53);
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

  it("batch 8 + 9 courses sum to their documented championship yardage", () => {
    for (const [slug, yardage] of Object.entries(EXPECTED_YARDAGE)) {
      const c = COURSES.find((x) => x.slug === slug);
      expect(c, slug).toBeDefined();
      expect(c!.holes.reduce((sum, h) => sum + h.yardage, 0), slug).toBe(yardage);
    }
  });
});
