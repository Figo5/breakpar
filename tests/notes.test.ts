import { describe, it, expect } from "vitest";
import { approachNote, hazardPenaltyNote, puttNote, scrambleNote, teeNote } from "@/lib/engine/notes";
import { resolveHoleChain, type ChainResult } from "@/lib/engine/shots";
import type { HoleSpec } from "@/lib/engine/resolveHole";
import type { Decision, Outcome } from "@/lib/engine/probabilities";

// The narration score word must always match the engine's actual Outcome, on
// any par and via any path — the "read engine truth" principle. These tests
// pin the reached-in-two par-5 cases (the blind spot that caused two bugs) and
// the par-independent safe+disaster bug.

const SCORE_WORDS = ["albatross", "eagle", "birdie", "par", "bogey", "double", "triple"] as const;
// rng that deterministically selects pool index `i` out of `len`.
const rngFor = (i: number, len: number) => () => (i + 0.5) / len;

describe("note {score} token is filled from the engine Outcome (never re-derived)", () => {
  it("one-putt short reads eagle on a par-5 reached in two, birdie otherwise", () => {
    // index 1 of the 3-string pool ("Buried the {score} putt from {ft}")
    expect(puttNote("oneputt", "short", 8, rngFor(1, 3), "normal", "eagle")).toMatch(/\beagle\b/);
    expect(puttNote("oneputt", "short", 8, rngFor(1, 3), "normal", "eagle")).not.toMatch(/\bbirdie\b/);
    expect(puttNote("oneputt", "short", 8, rngFor(1, 3), "normal", "birdie")).toMatch(/\bbirdie\b/);
  });

  it("twochip scramble reads par on a par-5 reached in two, bogey otherwise (the reported bug)", () => {
    // index 2 ("On in three, walked off with {score}")
    expect(scrambleNote("twochip", rngFor(2, 3), "normal", "par")).toMatch(/\bpar\b/);
    expect(scrambleNote("twochip", rngFor(2, 3), "normal", "par")).not.toMatch(/\bbogey\b/);
    expect(scrambleNote("twochip", rngFor(2, 3), "normal", "bogey")).toMatch(/\bbogey\b/);
  });

  it("blowup scramble reads bogey on a par-5 reached in two, double otherwise", () => {
    // index 1 ("Chunked it — scrambling for {score}")
    expect(scrambleNote("blowup", rngFor(1, 3), "normal", "bogey")).toMatch(/\bbogey\b/);
    expect(scrambleNote("blowup", rngFor(1, 3), "normal", "bogey")).not.toMatch(/\bdouble\b/);
    expect(scrambleNote("blowup", rngFor(1, 3), "normal", "double")).toMatch(/\bdouble\b/);
  });

  it("safe+disaster reads triple, not the old hardcoded 'double' (par-independent bug)", () => {
    // safe blow-up/disaster routes to SAFE_SCRAMBLE_UNLUCKY (4 strings)
    for (let i = 0; i < 4; i++) {
      const note = scrambleNote("disaster", rngFor(i, 4), "safe", "triple");
      expect(note).toMatch(/\btriple\b/);
      expect(note).not.toMatch(/\bdouble\b/);
    }
  });

  it("makeable approach reads eagle look on a par-5 reached in two, birdie otherwise", () => {
    // index 1 ("On the dance floor, {score} chance")
    expect(approachNote("makeable", false, rngFor(1, 3), "eagle")).toMatch(/\beagle\b/);
    expect(approachNote("makeable", false, rngFor(1, 3), "birdie")).toMatch(/\bbirdie\b/);
  });
});

describe("hazard-aware narration", () => {
  it("uses water and ocean context for trouble without inventing a penalty stroke", () => {
    const water = teeNote("trouble", rngFor(0, 3), { hazard: "water" });
    const ocean = teeNote("trouble", rngFor(1, 3), { hazard: "ocean" });
    expect(water.toLowerCase()).toMatch(/water|hazard/);
    expect(ocean.toLowerCase()).toMatch(/ocean|coastal/);
    expect(`${water} ${ocean}`.toLowerCase()).not.toContain("penalty");
  });

  it("gives an island-green miss the most specific carry narration", () => {
    const island = approachNote("scramble", true, rngFor(0, 3), "birdie", {
      hazard: "water",
      island: true,
    });
    const guarded = approachNote("scramble", true, rngFor(0, 3), "birdie", {
      hazard: "water",
      island: false,
    });
    expect(island.toLowerCase()).toContain("island");
    expect(guarded.toLowerCase()).not.toContain("island");
  });

  it("uses bunker-specific short-game narration on sand holes", () => {
    const note = scrambleNote("updown", rngFor(0, 3), "normal", "par", { hazard: "sand" });
    expect(note.toLowerCase()).toMatch(/sand|bunker|splashed/);
  });

  it("states the stroke when an actual water penalty is recorded", () => {
    const note = hazardPenaltyNote(
      { kind: "water", stage: "approach", strokes: 1 },
      rngFor(0, 3),
      { hazard: "water", island: true },
    );
    expect(note.toLowerCase()).toMatch(/one-stroke penalty|add one/);
  });
});

describe("hazard narration is score-neutral", () => {
  const conditions = { difficulty: 7, wind: 14 };
  const holes: Array<{
    spec: HoleSpec;
    context: { hazard: "sand" | "water" | "ocean"; signature?: string };
  }> = [
    { spec: { number: 17, par: 3, strokeIndex: 7 }, context: { hazard: "water", signature: "The Island Green" } },
    { spec: { number: 4, par: 4, strokeIndex: 3 }, context: { hazard: "water" } },
    { spec: { number: 8, par: 4, strokeIndex: 5 }, context: { hazard: "ocean" } },
    { spec: { number: 11, par: 5, strokeIndex: 1 }, context: { hazard: "sand" } },
  ];
  const seeds = (base: number) => ({
    shotSeed: (i: number) => ((base * 2654435761 + i * 40503 + 1) >>> 0) || 1,
    eventSeed: (i: number) => ((base * 374761393 + i * 668265263 + 7) >>> 0) || 1,
    greens: "Firm" as const,
  });
  const withoutNotes = (result: ChainResult): ChainResult => ({
    ...result,
    shots: result.shots.map((shot) => ({ ...shot, note: "" })),
  });

  it("changes only note text for identical decisions and seeds", () => {
    let contextualNotes = 0;
    for (const { spec, context } of holes) {
      for (let base = 1; base <= 250; base++) {
        const decisions: Decision[] = ["normal", "normal", "normal"];
        const plain = resolveHoleChain(decisions, spec, conditions, {
          ...seeds(base),
          scoringEvents: false,
        });
        const contextual = resolveHoleChain(decisions, spec, conditions, {
          ...seeds(base),
          holeContext: context,
          hazardPenalties: false,
          scoringEvents: false,
        });
        expect(withoutNotes(contextual)).toEqual(withoutNotes(plain));
        if (contextual.shots.some((shot, i) => shot.note !== plain.shots[i]?.note)) contextualNotes++;
      }
    }
    expect(contextualNotes).toBeGreaterThan(0);
  });
});

// End-to-end invariant: play holes to completion across par 3/4/5 under every
// policy and assert the TERMINAL shot's note never contains a score word that
// contradicts the actual outcome. This catches any future note that hardcodes
// a score word instead of the {score} token.
describe("terminal note never contradicts the scored outcome (par 3/4/5)", () => {
  const par3: HoleSpec = { number: 7, par: 3, strokeIndex: 14 };
  const par4: HoleSpec = { number: 1, par: 4, strokeIndex: 9 };
  const par5: HoleSpec = { number: 18, par: 5, strokeIndex: 11 };
  const conditions = { difficulty: 6, wind: 10 };
  const seeds = (base: number) => ({
    shotSeed: (i: number) => ((base * 2654435761 + i * 40503 + 1) >>> 0) || 1,
    eventSeed: (i: number) => ((base * 374761393 + i * 668265263 + 7) >>> 0) || 1,
    greens: "Medium" as const,
  });
  const play = (hole: HoleSpec, base: number, d: Decision): ChainResult => {
    const opts = seeds(base);
    const decisions: Decision[] = [];
    let res = resolveHoleChain(decisions, hole, conditions, opts);
    let guard = 0;
    while (!res.complete && guard++ < 6) {
      decisions.push(d);
      res = resolveHoleChain(decisions, hole, conditions, opts);
    }
    return res;
  };

  it("holds over many seeds, holes and policies", () => {
    let terminalNotesChecked = 0;
    for (const hole of [par3, par4, par5]) {
      for (const d of ["safe", "normal", "aggressive"] as Decision[]) {
        for (let base = 1; base <= 400; base++) {
          const res = play(hole, base, d);
          if (!res.complete) continue;
          const outcome = res.outcome as Outcome;
          const note = res.shots[res.shots.length - 1].note.toLowerCase();
          for (const w of SCORE_WORDS) {
            if (new RegExp(`\\b${w}\\b`).test(note)) {
              expect(w, `hole par ${hole.par}, seed ${base}, ${d}: "${note}" vs ${outcome}`).toBe(outcome);
            }
          }
          terminalNotesChecked++;
        }
      }
    }
    expect(terminalNotesChecked).toBeGreaterThan(1000);
  });
});
