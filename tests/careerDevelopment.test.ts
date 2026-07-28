import { describe, expect, it } from "vitest";

import { COURSES } from "@/data/courses";
import {
  CAREER_INITIAL_SKILL_RANKS,
  applyCareerApproachRank,
  applyCareerDrivingRank,
  applyCareerPuttingRank,
  applyCareerShortGameRank,
  careerDevelopmentAward,
  careerSkillUpgradeCost,
} from "@/lib/career/development";
import { CAREER_V4_FORMULA_BUNDLE } from "@/lib/career/formulaBundle";
import { simulateArchetypeRound } from "@/lib/career/simulator";

describe("Career player development", () => {
  it("keeps rank one neutral and moves every stage monotonically", () => {
    const driving = { dialed: 10, fairway: 50, rough: 30, trouble: 10 };
    expect(applyCareerDrivingRank(driving, 1)).toBe(driving);
    const improvedDriving = applyCareerDrivingRank(driving, 5);
    expect(improvedDriving.dialed).toBeCloseTo(11.2);
    expect(improvedDriving.fairway).toBeCloseTo(53);
    expect(improvedDriving.rough).toBeCloseTo(28.2);
    expect(improvedDriving.trouble).toBeCloseTo(8.4);

    const approach = { kickin: 10, makeable: 40, lag: 30, scramble: 20 };
    expect(applyCareerApproachRank(approach, 1)).toBe(approach);
    const improvedApproach = applyCareerApproachRank(approach, 5);
    expect(improvedApproach.kickin).toBeGreaterThan(approach.kickin);
    expect(improvedApproach.makeable).toBeGreaterThan(approach.makeable);
    expect(improvedApproach.lag).toBeLessThan(approach.lag);
    expect(improvedApproach.scramble).toBeLessThan(approach.scramble);

    const shortGame = { updown: 45, twochip: 40, blowup: 12, disaster: 3 };
    const improvedShortGame = applyCareerShortGameRank(shortGame, 5);
    expect(improvedShortGame.updown).toBeGreaterThan(shortGame.updown);
    expect(improvedShortGame.twochip).toBe(shortGame.twochip);
    expect(improvedShortGame.blowup).toBeLessThan(shortGame.blowup);
    expect(improvedShortGame.disaster).toBeLessThan(shortGame.disaster);

    const putting = { oneputt: 20, twoputt: 70, threeputt: 10 };
    const improvedPutting = applyCareerPuttingRank(putting, 5);
    expect(improvedPutting.oneputt).toBeGreaterThan(putting.oneputt);
    expect(improvedPutting.twoputt).toBe(putting.twoputt);
    expect(improvedPutting.threeputt).toBeLessThan(putting.threeputt);
  });

  it("replays rank-one engine cards byte-identically and lets ranks affect odds", () => {
    const archetype = { ability: "scratch" as const, tendency: "balanced" as const };
    const neutral: number[] = [];
    const explicitRankOne: number[] = [];
    const maxed: number[] = [];
    for (let index = 0; index < 48; index++) {
      const course = COURSES[index % COURSES.length];
      const seed = `career-rank-replay:${index}`;
      neutral.push(simulateArchetypeRound(
        seed,
        course,
        archetype,
        CAREER_V4_FORMULA_BUNDLE.ability.model,
        { ...CAREER_V4_FORMULA_BUNDLE.ability.errorRates },
        CAREER_V4_FORMULA_BUNDLE.gameplayRulesetVersion,
      ));
      explicitRankOne.push(simulateArchetypeRound(
        seed,
        course,
        archetype,
        CAREER_V4_FORMULA_BUNDLE.ability.model,
        { ...CAREER_V4_FORMULA_BUNDLE.ability.errorRates },
        CAREER_V4_FORMULA_BUNDLE.gameplayRulesetVersion,
        CAREER_INITIAL_SKILL_RANKS,
      ));
      maxed.push(simulateArchetypeRound(
        seed,
        course,
        archetype,
        CAREER_V4_FORMULA_BUNDLE.ability.model,
        { ...CAREER_V4_FORMULA_BUNDLE.ability.errorRates },
        CAREER_V4_FORMULA_BUNDLE.gameplayRulesetVersion,
        { driving: 5, approach: 5, shortGame: 5, putting: 5 },
      ));
    }
    expect(explicitRankOne).toEqual(neutral);
    expect(maxed).not.toEqual(neutral);
    expect(maxed.reduce((sum, score) => sum + score, 0))
      .toBeLessThan(neutral.reduce((sum, score) => sum + score, 0));
  });

  it("caps volume-only foundation points and uses increasing upgrade costs", () => {
    expect([1, 2, 3, 4, 5].map(careerSkillUpgradeCost))
      .toEqual([1, 2, 3, 4, null]);
    expect(careerDevelopmentAward(0.49, 0)).toEqual({
      foundation: 1,
      performance: 0,
      total: 1,
      reasons: ["Season completion foundation"],
    });
    expect(careerDevelopmentAward(0.49, 4).total).toBe(0);
    expect(careerDevelopmentAward(0.74, 4)).toMatchObject({
      foundation: 0,
      performance: 1,
      total: 1,
    });
    expect(careerDevelopmentAward(0.75, 4)).toMatchObject({
      foundation: 0,
      performance: 2,
      total: 2,
    });
  });
});
