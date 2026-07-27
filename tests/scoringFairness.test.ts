import { describe, expect, it } from "vitest";
import { resolveHoleChain, type ChainResult } from "@/lib/engine/shots";
import type { Decision } from "@/lib/engine/probabilities";
import type { HoleSpec } from "@/lib/engine/resolveHole";

const conditions = { difficulty: 6, wind: 10 };
const par4: HoleSpec = { number: 6, par: 4, strokeIndex: 9, yardage: 410 };

function playSafe(base: number): ChainResult {
  const decisions: Decision[] = [];
  const opts = {
    shotSeed: (i: number) => ((base * 2654435761 + i * 40503 + 1) >>> 0) || 1,
    eventSeed: (i: number) => ((base * 374761393 + i * 668265263 + 7) >>> 0) || 1,
    greens: "Medium" as const,
    hazardPenalties: false,
    scoringEvents: false,
  };
  let result = resolveHoleChain(decisions, par4, conditions, opts);
  let guard = 0;
  while (!result.complete && guard++ < 6) {
    decisions.push("safe");
    result = resolveHoleChain(decisions, par4, conditions, opts);
  }
  return result;
}

describe("casual scoring path gates", () => {
  it("safe tee to fairway plus safe continuation keeps the catastrophic tail tiny", () => {
    let fairways = 0;
    let doubleOrWorse = 0;
    for (let seed = 1; seed <= 10_000; seed++) {
      const result = playSafe(seed);
      if (result.shots[0]?.lie !== "fairway") continue;
      fairways++;
      if ((result.scoreDelta ?? 0) >= 2) doubleOrWorse++;
    }
    expect(fairways).toBeGreaterThan(5_000);
    expect(doubleOrWorse / fairways).toBeLessThan(0.02);
  });

  it("an unpenalized all-safe path never reaches triple", () => {
    for (let seed = 1; seed <= 10_000; seed++) {
      expect(playSafe(seed).scoreDelta).toBeLessThan(3);
    }
  });
});
