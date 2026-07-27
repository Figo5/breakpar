import { describe, expect, it } from "vitest";

import { CAREER_V2_FORMULA_BUNDLE } from "@/lib/career/formulaBundle";
import { simulatePlayerPacedCareer } from "@/lib/career/playerPacedSimulator";
import { tourRating } from "@/lib/career/rules";
import {
  ABILITY_BANDS,
  TENDENCIES,
  type ScoreBank,
} from "@/lib/career/simulator";

function frozenFixedBank(): ScoreBank {
  const scores = new Map<string, number[]>();
  const means = new Map<string, number>();
  for (const ability of ABILITY_BANDS) {
    for (const tendency of TENDENCIES) {
      const values = ability === "rusty" ? [3, 4, 5] : ability === "scratch" ? [0, 1, 2] : [-3, -2, -1];
      scores.set(`${ability}:${tendency}`, values);
      means.set(
        `${ability}:${tendency}`,
        values.reduce((sum, value) => sum + value, 0) / values.length,
      );
    }
  }
  return {
    seed: "player-paced-fixed",
    samplesPerArchetype: 3,
    scores,
    means,
    model: CAREER_V2_FORMULA_BUNDLE.ability.model,
    errorRates: { ...CAREER_V2_FORMULA_BUNDLE.ability.errorRates },
  };
}

describe("player-paced Career simulator", () => {
  it("replays an unlimited personal career deterministically with no inactive seasons", () => {
    const config = {
      seed: "player-paced-repeat",
      seasons: 25,
      ability: "scratch" as const,
      scoreBank: frozenFixedBank(),
    };
    const first = simulatePlayerPacedCareer(config);
    const second = simulatePlayerPacedCareer(config);

    expect(second).toEqual(first);
    expect(first.formulaVersion).toBe("career-v3-four-round-events");
    expect(first.histories).toHaveLength(25);
    expect(first.histories.every((history) => history.movement !== "inactive")).toBe(true);
    expect(first.histories.every((history) => history.legacyTotal >= history.legacyEarned)).toBe(true);
  });

  it("rejects a score bank that is not pinned to the player-paced package", () => {
    const bank = frozenFixedBank();
    expect(() => simulatePlayerPacedCareer({
      seed: "wrong-package",
      seasons: 1,
      ability: "ace",
      scoreBank: { ...bank, model: "v5" },
    })).toThrow(/requires a career-v3-four-round-events real-engine score bank/);
  });

  it("proves Tour Rating is independent of career volume when recent form matches", () => {
    const recent = [95, 120, 80, 150, 110, 140, 100, 130]
      .map((rating) => ({ rating, active: true }));
    const tenSeasonCareer = [
      { rating: 5, active: true },
      { rating: 10, active: true },
      ...recent,
    ];
    const twoHundredSeasonCareer = [
      ...Array.from({ length: 192 }, (_, index) => ({
        rating: (index * 37) % 226,
        active: true,
      })),
      ...recent,
    ];

    expect(tourRating(twoHundredSeasonCareer)).toBe(tourRating(tenSeasonCareer));
  });
});
