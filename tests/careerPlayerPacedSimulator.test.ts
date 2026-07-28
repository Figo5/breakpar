import { describe, expect, it } from "vitest";

import {
  CAREER_INITIAL_SKILL_RANKS,
  careerSkillKey,
  totalCareerSkillRanks,
} from "@/lib/career/development";
import { CAREER_V4_FORMULA_BUNDLE } from "@/lib/career/formulaBundle";
import {
  autoAllocateCareerSkills,
  balancedCareerSkillPath,
  simulatePlayerPacedCareer,
  type CareerSkillScoreBank,
} from "@/lib/career/playerPacedSimulator";
import { tourRating } from "@/lib/career/rules";
import {
  ABILITY_BANDS,
  TENDENCIES,
  type ScoreBank,
} from "@/lib/career/simulator";

function frozenBaseBank(): ScoreBank {
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
    model: CAREER_V4_FORMULA_BUNDLE.ability.model,
    errorRates: { ...CAREER_V4_FORMULA_BUNDLE.ability.errorRates },
  };
}

function frozenFixedBank(): CareerSkillScoreBank {
  const base = frozenBaseBank();
  const rankVectors = balancedCareerSkillPath();
  const skillScores = new Map<string, readonly number[]>();
  const skillMeans = new Map<string, number>();
  for (const ability of ABILITY_BANDS) {
    for (const tendency of TENDENCIES) {
      const baseValues = base.scores.get(`${ability}:${tendency}`)!;
      for (const ranks of rankVectors) {
        const improvement = Math.floor(
          (totalCareerSkillRanks(ranks) - totalCareerSkillRanks(CAREER_INITIAL_SKILL_RANKS))
          / 4,
        );
        const values = baseValues.map((score) => score - improvement);
        const key = `${ability}:${tendency}|${careerSkillKey(ranks)}`;
        skillScores.set(key, values);
        skillMeans.set(key, values.reduce((sum, value) => sum + value, 0) / values.length);
      }
    }
  }
  return {
    seed: base.seed,
    samplesPerArchetype: base.samplesPerArchetype,
    base,
    skillScores,
    skillMeans,
    rankVectors,
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
    expect(first.formulaVersion).toBe("career-v4-progression");
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
      scoreBank: { ...bank, base: { ...bank.base, model: "v5" } },
    })).toThrow(/requires a career-v4-progression real-engine score bank/);
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

  it("spends along a bounded balanced path and volume-only points cannot max it", () => {
    const fourFoundationPoints = autoAllocateCareerSkills(
      CAREER_INITIAL_SKILL_RANKS,
      4,
    );
    const maxed = autoAllocateCareerSkills(CAREER_INITIAL_SKILL_RANKS, 40);

    expect(fourFoundationPoints.ranks).toEqual({
      driving: 2,
      approach: 2,
      shortGame: 2,
      putting: 2,
    });
    expect(totalCareerSkillRanks(fourFoundationPoints.ranks)).toBe(8);
    expect(maxed.ranks).toEqual({
      driving: 5,
      approach: 5,
      shortGame: 5,
      putting: 5,
    });
    expect(maxed.pointsRemaining).toBe(0);
  });

  it("models exact bounded ranks deterministically and never exceeds rank five", () => {
    const simulation = simulatePlayerPacedCareer({
      seed: "skill-progression",
      seasons: 40,
      ability: "rusty",
      scoreBank: frozenFixedBank(),
    });

    expect(simulation.histories[0].skills.driving).toBeGreaterThanOrEqual(1);
    expect(simulation.histories.every((history) =>
      Object.values(history.skills).every((rank) => rank >= 1 && rank <= 5))).toBe(true);
    expect(simulation.histories.at(-1)!.developmentEarned).toBeGreaterThanOrEqual(
      simulation.histories.at(-1)!.developmentSpent,
    );
    expect(simulatePlayerPacedCareer({
      seed: "skill-progression",
      seasons: 40,
      ability: "rusty",
      scoreBank: frozenFixedBank(),
    })).toEqual(simulation);
  });
});
