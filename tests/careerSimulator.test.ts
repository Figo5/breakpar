import { describe, expect, it } from "vitest";
import { COURSES } from "@/data/courses";
import {
  ABILITY_BANDS,
  CAREER_V1_FREEZE_CANDIDATE,
  CAREER_V1_LEGACY_POINTS,
  TIER_SCALED_BOT_MIX,
  TENDENCIES,
  activeSeasonPercentile,
  botAbilityForSlot,
  boundHumanMovement,
  buildScoreBank,
  confirmMovementSlot,
  humanMovementLimit,
  rollingHistoryAfterPromotion,
  rollingMovementForSeason,
  simulateArchetypeRound,
  simulateCareerWorld,
  type ScoreBank,
} from "@/lib/career/simulator";
import { legacyPoints } from "@/lib/career/rules";
import type { SeasonStanding } from "@/lib/career/rules";

function fixedBank(): ScoreBank {
  const scores = new Map<string, number[]>();
  const means = new Map<string, number>();
  for (const ability of ABILITY_BANDS) {
    for (const tendency of TENDENCIES) {
      const mean = ability === "rusty" ? 5 : ability === "scratch" ? 0 : -3;
      scores.set(`${ability}:${tendency}`, [mean - 1, mean, mean + 1]);
      means.set(`${ability}:${tendency}`, mean);
    }
  }
  return { seed: "fixed-bank", samplesPerArchetype: 3, scores, means };
}

describe("Career simulator", () => {
  it("replays a real-engine archetype round identically from the same seed", () => {
    const archetype = { ability: "ace", tendency: "situational" } as const;
    const first = simulateArchetypeRound("repeatable", COURSES[0], archetype);
    const second = simulateArchetypeRound("repeatable", COURSES[0], archetype);
    expect(second).toBe(first);
  });

  it("builds all twelve deterministic engine-backed score banks", () => {
    const first = buildScoreBank("bank-repeatability", 2);
    const second = buildScoreBank("bank-repeatability", 2);
    expect([...first.scores.keys()]).toHaveLength(12);
    expect([...second.scores.entries()]).toEqual([...first.scores.entries()]);
  });

  it("produces identical multi-season worlds from the same explicit configuration", () => {
    const config = {
      seed: "world-repeatability",
      fieldSize: 20,
      humanRatio: 0.5,
      seasons: 8,
      scoreBank: fixedBank(),
    };
    const first = simulateCareerWorld(config);
    const second = simulateCareerWorld(config);
    expect(second).toEqual(first);
    expect(first.careers).toHaveLength(10);
    expect(first.careers.every((career) => career.histories.length === 8)).toBe(true);
    expect(first.championships.map((championship) => championship.season)).toEqual([4, 8]);
  });

  it("replays the corrected error-model round identically and preserves the v5 default", () => {
    const archetype = { ability: "ace", tendency: "balanced" } as const;
    const v5a = simulateArchetypeRound("err-seed", COURSES[0], archetype);
    const v5b = simulateArchetypeRound("err-seed", COURSES[0], archetype, "v5");
    expect(v5b).toBe(v5a); // omitted model === "v5"
    const errorFirst = simulateArchetypeRound("err-seed", COURSES[0], archetype, "error");
    const errorSecond = simulateArchetypeRound("err-seed", COURSES[0], archetype, "error");
    expect(errorSecond).toBe(errorFirst);
  });

  it("gives the corrected error-model a monotonic ability ordering the v5 model lacks", () => {
    const bandAverage = (bank: ScoreBank, ability: (typeof ABILITY_BANDS)[number]) =>
      TENDENCIES.reduce((sum, tendency) => sum + (bank.means.get(`${ability}:${tendency}`) ?? 0), 0) / TENDENCIES.length;

    const corrected = buildScoreBank("ordering-check", 48, "error");
    const rusty = bandAverage(corrected, "rusty");
    const scratch = bandAverage(corrected, "scratch");
    const ace = bandAverage(corrected, "ace");
    // Strictly monotonic: rusty is worst (highest score), ace is best.
    expect(rusty).toBeGreaterThan(scratch);
    expect(scratch).toBeGreaterThan(ace);
    // A clear, believable gradient (well above the ~0.25 stroke v5 gap).
    expect(rusty - ace).toBeGreaterThan(0.5);
    // Tendency is flavour, not skill: within Ace, tendencies stay tightly bunched.
    const aceTendencies = TENDENCIES.map((tendency) => corrected.means.get(`ace:${tendency}`) ?? 0);
    expect(Math.max(...aceTendencies) - Math.min(...aceTendencies)).toBeLessThan(0.35);
  });

  it("keeps error-rate sensitivity labelled, deterministic, and default-compatible", () => {
    const defaults = buildScoreBank("error-rate-defaults", 8, "error");
    const explicit = buildScoreBank("error-rate-defaults", 8, "error", {
      rusty: 0.42,
      scratch: 0.18,
      ace: 0.05,
    });
    expect(explicit).toEqual(defaults);

    const moderate = { rusty: 0.55, scratch: 0.16, ace: 0.03 };
    const first = buildScoreBank("error-rate-moderate", 16, "error", moderate);
    const second = buildScoreBank("error-rate-moderate", 16, "error", moderate);
    expect(second).toEqual(first);
    expect(first.errorRates).toEqual(moderate);
  });

  it("delays promotion until two consecutive qualifying seasons when required", () => {
    const base = {
      seed: "repeat-qualify",
      fieldSize: 20,
      humanRatio: 0.5,
      seasons: 8,
      scoreBank: fixedBank(),
    };
    const open = simulateCareerWorld(base);
    const gated = simulateCareerWorld({ ...base, requireRepeatQualification: true });

    const promotions = (world: ReturnType<typeof simulateCareerWorld>) =>
      world.careers.flatMap((career) => career.histories).filter((history) => history.movement === "promote").length;
    // Repeat-qualification can only remove promotions, never add them.
    expect(promotions(gated)).toBeLessThanOrEqual(promotions(open));
    // No competitor can promote in season 1 under the gate (no prior qualifier).
    const seasonOnePromotions = gated.careers
      .flatMap((career) => career.histories)
      .filter((history) => history.season === 1 && history.movement === "promote").length;
    expect(seasonOnePromotions).toBe(0);
  });

  it("keeps uniform bot assignment unchanged and tier-scales ability deterministically", () => {
    expect(Array.from({ length: 9 }, (_, index) => botAbilityForSlot("pro", index, "seed")))
      .toEqual(["rusty", "scratch", "ace", "rusty", "scratch", "ace", "rusty", "scratch", "ace"]);

    const counts = (tier: "local" | "challenger" | "pro") => {
      const result = { rusty: 0, scratch: 0, ace: 0 };
      for (let index = 0; index < 10_000; index++) {
        result[botAbilityForSlot(tier, index, "scaled-seed", "tier-scaled")]++;
      }
      return result;
    };
    const local = counts("local");
    const challenger = counts("challenger");
    const pro = counts("pro");
    expect(local.rusty).toBeGreaterThan(challenger.rusty);
    expect(challenger.rusty).toBeGreaterThan(pro.rusty);
    expect(pro.ace).toBeGreaterThan(challenger.ace);
    expect(challenger.ace).toBeGreaterThan(local.ace);
    for (const tier of ["local", "challenger", "pro"] as const) {
      const observed = counts(tier);
      for (const ability of ABILITY_BANDS) {
        expect(observed[ability] / 10_000).toBeCloseTo(TIER_SCALED_BOT_MIX[tier][ability], 1);
      }
    }
    expect(counts("pro")).toEqual(counts("pro"));
    const allAce = {
      local: { rusty: 0, scratch: 0, ace: 1 },
      challenger: { rusty: 0, scratch: 0, ace: 1 },
      pro: { rusty: 0, scratch: 0, ace: 1 },
    };
    expect(Array.from(
      { length: 100 },
      (_, index) => botAbilityForSlot("local", index, "custom-mix", "tier-scaled", allAce),
    ).every((ability) => ability === "ace")).toBe(true);
  });

  it("requires consecutive finishes on both boundaries under symmetric confirmation", () => {
    const firstPromotion = confirmMovementSlot("promote", "symmetric", 0, 0);
    expect(firstPromotion).toEqual({
      action: "hold",
      consecutiveQualifyingSeasons: 1,
      consecutiveRelegatingSeasons: 0,
    });
    expect(confirmMovementSlot(
      "promote",
      "symmetric",
      firstPromotion.consecutiveQualifyingSeasons,
      firstPromotion.consecutiveRelegatingSeasons,
    )).toEqual({
      action: "promote",
      consecutiveQualifyingSeasons: 0,
      consecutiveRelegatingSeasons: 0,
    });

    const firstRelegation = confirmMovementSlot("relegate", "symmetric", 0, 0);
    expect(firstRelegation).toEqual({
      action: "hold",
      consecutiveQualifyingSeasons: 0,
      consecutiveRelegatingSeasons: 1,
    });
    expect(confirmMovementSlot(
      "relegate",
      "symmetric",
      firstRelegation.consecutiveQualifyingSeasons,
      firstRelegation.consecutiveRelegatingSeasons,
    ).action).toBe("relegate");
    expect(confirmMovementSlot("hold", "symmetric", 1, 1)).toEqual({
      action: "hold",
      consecutiveQualifyingSeasons: 0,
      consecutiveRelegatingSeasons: 0,
    });
  });

  it("protects the first weak season while keeping promotion one-shot", () => {
    expect(confirmMovementSlot("promote", "relegation-protection", 0, 0)).toEqual({
      action: "promote",
      consecutiveQualifyingSeasons: 0,
      consecutiveRelegatingSeasons: 0,
    });
    const warning = confirmMovementSlot("relegate", "relegation-protection", 0, 0);
    expect(warning).toEqual({
      action: "hold",
      consecutiveQualifyingSeasons: 0,
      consecutiveRelegatingSeasons: 1,
    });
    expect(confirmMovementSlot(
      "relegate",
      "relegation-protection",
      warning.consecutiveQualifyingSeasons,
      warning.consecutiveRelegatingSeasons,
    ).action).toBe("relegate");
    expect(confirmMovementSlot("hold", "relegation-protection", 0, 1).consecutiveRelegatingSeasons).toBe(0);
  });

  it("evaluates rolling percentile thresholds and rolls the active-season window", () => {
    expect(activeSeasonPercentile(20, 1)).toBe(1);
    expect(activeSeasonPercentile(20, 20)).toBe(0);
    const options = { window: 2, minEntries: 2, promoteThreshold: 0.75, relegateThreshold: 0.25 };
    const first = rollingMovementForSeason([], 0.8, "local", options);
    expect(first).toEqual({ action: "hold", history: [0.8], average: null });
    expect(rollingMovementForSeason(first.history, 0.7, "local", options)).toEqual({
      action: "promote",
      history: [0.8, 0.7],
      average: 0.75,
    });
    expect(rollingMovementForSeason([0.9, 0.1], 0.2, "challenger", {
      ...options,
      window: 2,
    })).toMatchObject({
      action: "relegate",
      history: [0.1, 0.2],
      average: 0.15000000000000002,
    });
    expect(rollingMovementForSeason([0.9, 0.8, 0.1], 0.7, "challenger", {
      window: 3,
      minEntries: 3,
      promoteThreshold: 0.75,
      relegateThreshold: 0.25,
    })).toEqual({
      action: "hold",
      history: [0.8, 0.1, 0.7],
      average: 1.6 / 3,
    });
    expect(rollingMovementForSeason([1], 1, "pro", options).action).toBe("hold");
    expect(rollingMovementForSeason([0], 0, "local", options).action).toBe("hold");
  });

  it("freezes Candidate H's exact rolling boundaries, floor, and tier bounds", () => {
    const movement = CAREER_V1_FREEZE_CANDIDATE.movement;
    const options = {
      window: movement.rollingWindow,
      minEntries: movement.rollingMinEntries,
      promoteThreshold: movement.rollingPromoteThreshold,
      relegateThreshold: movement.rollingRelegateThreshold,
      promotionFloor: movement.rollingPromotionFloor,
    };

    const exactPromotion = rollingMovementForSeason([0.58], 0.72, "challenger", options);
    expect(exactPromotion.action).toBe("promote");
    expect(exactPromotion.average).toBeCloseTo(0.65);
    expect(rollingMovementForSeason([0.58], 0.719998, "challenger", options).action).toBe("hold");
    expect(rollingMovementForSeason([0.579999], 0.720001, "challenger", options).action).toBe("hold");
    expect(rollingMovementForSeason([0.2], 0.44, "pro", options))
      .toMatchObject({ action: "relegate", average: 0.32 });
    expect(rollingMovementForSeason([0.2], 0.440002, "pro", options).action).toBe("hold");
    expect(rollingMovementForSeason([0.8], 0.8, "pro", options).action).toBe("hold");
    expect(rollingMovementForSeason([0.1], 0.1, "local", options).action).toBe("hold");
  });

  it("can require sustained quality rather than one exceptional rolling result", () => {
    const guarded = {
      window: 2,
      minEntries: 2,
      promoteThreshold: 0.68,
      relegateThreshold: 0.32,
      promotionFloor: 0.55,
      relegationCeiling: 0.45,
    };
    expect(rollingMovementForSeason([0.95], 0.45, "challenger", guarded).action).toBe("hold");
    expect(rollingMovementForSeason([0.8], 0.6, "challenger", guarded).action).toBe("promote");
    expect(rollingMovementForSeason([0.05], 0.55, "pro", guarded).action).toBe("hold");
    expect(rollingMovementForSeason([0.2], 0.4, "pro", guarded).action).toBe("relegate");
  });

  it("transforms promotion evidence into a neutral or weighted tier prior", () => {
    expect(rollingHistoryAfterPromotion([0.8, 0.7], undefined)).toEqual([]);
    expect(rollingHistoryAfterPromotion([0.8, 0.7], 0)).toEqual([0.5]);
    expect(rollingHistoryAfterPromotion([0.8, 0.7], 0.5)).toEqual([0.625]);
    expect(rollingHistoryAfterPromotion([0.8, 0.7], 2)).toEqual([0.75]);
    expect(rollingHistoryAfterPromotion(
      [0.58, 0.72],
      CAREER_V1_FREEZE_CANDIDATE.movement.rollingPromotionCarryWeight,
    )).toEqual([0.5375]);
  });

  it("scales human movement limits sublinearly and respects configured bounds", () => {
    expect(humanMovementLimit(400, { model: "none" })).toBeNull();
    expect(humanMovementLimit(400, { model: "fixed", fixedCap: 12 })).toBe(12);
    expect(humanMovementLimit(4, { model: "sqrt", min: 4, scale: 2, max: 40 })).toBe(4);
    expect(humanMovementLimit(100, { model: "sqrt", min: 4, scale: 2, max: 40 })).toBe(20);
    expect(humanMovementLimit(400, { model: "sqrt", min: 4, scale: 2, max: 40 })).toBe(40);
    expect(humanMovementLimit(400, { model: "percentage-cap", min: 4, scale: 0.15, max: 32 })).toBe(32);
    const freezeLimit = {
      model: CAREER_V1_FREEZE_CANDIDATE.movement.humanMovementLimitModel,
      min: CAREER_V1_FREEZE_CANDIDATE.movement.humanMovementLimitMin,
      scale: CAREER_V1_FREEZE_CANDIDATE.movement.humanMovementLimitScale,
      max: CAREER_V1_FREEZE_CANDIDATE.movement.humanMovementLimitMax,
    };
    expect(humanMovementLimit(4, freezeLimit)).toBe(4);
    expect(humanMovementLimit(100, freezeLimit)).toBe(20);
    expect(humanMovementLimit(500, freezeLimit)).toBe(40);
  });

  it("soft-caps human movement without letting bots consume the cap", () => {
    const standing = (competitorId: string, points: number, fallbackDraw: number): SeasonStanding => ({
      competitorId,
      active: true,
      completedEvents: 4,
      seasonPoints: points,
      bestFinishes: [1, 1, 1],
      countingRelativeToPar: 0,
      bestCountingRelativeToPar: 0,
      fallbackDraw,
      countingEventIndexes: [0, 1, 2],
    });
    const standings = [
      standing("bot-top", 300, 0),
      standing("human-tied-a", 280, 0.1),
      standing("human-tied-b", 280, 0.2),
      standing("human-held", 260, 0.3),
      standing("human-bottom", 10, 0.4),
    ];
    const proposed = new Map([
      ["human-tied-a", "promote"],
      ["human-tied-b", "promote"],
      ["human-held", "promote"],
      ["human-bottom", "relegate"],
    ] as const);
    const bounded = boundHumanMovement(standings, proposed, 1);
    expect(bounded.promoted).toBe(2); // exact tie extends the soft cap
    expect(bounded.actions.get("human-tied-a")).toBe("promote");
    expect(bounded.actions.get("human-tied-b")).toBe("promote");
    expect(bounded.actions.get("human-held")).toBe("hold");
    expect(bounded.heldByCap.has("human-held")).toBe(true);
    expect(bounded.relegated).toBe(1);
    expect(bounded.actions.has("bot-top")).toBe(false);
  });

  it("skips inactive seasons in a rolling window", () => {
    const config = {
      seed: "rolling-inactivity",
      fieldSize: 50,
      humanRatio: 0.8,
      promotionModel: "rolling" as const,
      rollingWindow: 2,
      rollingPromoteThreshold: 2,
      rollingRelegateThreshold: -1,
      scoreBank: fixedBank(),
    };
    const afterFour = simulateCareerWorld({ ...config, seasons: 4 });
    const afterAbsence = simulateCareerWorld({ ...config, seasons: 6 });
    const returningFour = afterFour.careers.find((career) => career.activity === "returning");
    const returningSix = afterAbsence.careers.find((career) => career.competitorId === returningFour?.competitorId);
    expect(returningFour?.rollingPercentiles).toHaveLength(2);
    expect(returningSix?.rollingPercentiles).toEqual(returningFour?.rollingPercentiles);
  });

  it("keeps all new movement candidates byte-equivalent when explicitly disabled", () => {
    const base = {
      seed: "new-candidates-default-off",
      fieldSize: 30,
      humanRatio: 0.5,
      seasons: 8,
      scoreBank: fixedBank(),
    };
    const explicit = simulateCareerWorld({
      ...base,
      promotionModel: "slot",
      movementConfirmation: "none",
      humanMovementLimitModel: "none",
    });
    const implicit = simulateCareerWorld(base);
    expect(explicit.careers).toEqual(implicit.careers);
    expect(explicit.tierSnapshots).toEqual(implicit.tierSnapshots);
    expect(explicit.championships).toEqual(implicit.championships);
  });

  it("replays tier-scaled symmetric-confirmation worlds identically", () => {
    const config = {
      seed: "scaled-symmetric-repeatability",
      fieldSize: 30,
      humanRatio: 0.5,
      seasons: 8,
      botFieldModel: "tier-scaled" as const,
      movementConfirmation: "symmetric" as const,
      scoreBank: fixedBank(),
    };
    expect(simulateCareerWorld(config)).toEqual(simulateCareerWorld(config));
  });

  it("replays combined rolling and bounded-human movement identically", () => {
    const config = {
      seed: "rolling-bounded-repeatability",
      fieldSize: 50,
      humanRatio: 0.8,
      seasons: 8,
      botFieldModel: "tier-scaled" as const,
      promotionModel: "rolling" as const,
      rollingWindow: 2,
      rollingMinEntries: 2,
      rollingPromoteThreshold: 0.7,
      rollingRelegateThreshold: 0.3,
      humanMovementCap: 12,
      scoreBank: fixedBank(),
    };
    expect(simulateCareerWorld(config)).toEqual(simulateCareerWorld(config));
  });

  it("replays rolling carryover, quality guards, and adaptive limits identically", () => {
    const config = {
      seed: "rolling-carry-adaptive-repeatability",
      fieldSize: 100,
      humanRatio: 0.8,
      seasons: 8,
      botFieldModel: "tier-scaled" as const,
      promotionModel: "rolling" as const,
      rollingWindow: 2,
      rollingMinEntries: 2,
      rollingPromoteThreshold: 0.68,
      rollingRelegateThreshold: 0.32,
      rollingPromotionFloor: 0.55,
      rollingRelegationCeiling: 0.45,
      rollingPromotionCarryWeight: 0,
      humanMovementLimitModel: "sqrt" as const,
      humanMovementLimitMin: 4,
      humanMovementLimitScale: 2,
      humanMovementLimitMax: 40,
      scoreBank: fixedBank(),
    };
    expect(simulateCareerWorld(config)).toEqual(simulateCareerWorld(config));
  });

  it("packages Candidate H without changing the default v5 path and replays it exactly", () => {
    expect(CAREER_V1_FREEZE_CANDIDATE).toMatchObject({
      id: "career-v1-freeze-candidate",
      errorRates: { rusty: 0.65, scratch: 0.14, ace: 0.02 },
      botFieldModel: "tier-scaled",
      movement: {
        promotionModel: "rolling",
        rollingWindow: 2,
        rollingPromoteThreshold: 0.65,
        rollingPromotionFloor: 0.58,
        rollingRelegateThreshold: 0.32,
        rollingPromotionCarryWeight: 0.25,
        humanMovementLimitModel: "percentage-cap",
        humanMovementLimitMin: 4,
        humanMovementLimitScale: 0.2,
        humanMovementLimitMax: 40,
      },
    });
    const movement = CAREER_V1_FREEZE_CANDIDATE.movement;
    const config = {
      seed: "candidate-h-package-repeatability",
      fieldSize: 100,
      humanRatio: 0.8,
      seasons: 16,
      botFieldModel: CAREER_V1_FREEZE_CANDIDATE.botFieldModel,
      tierBotMix: CAREER_V1_FREEZE_CANDIDATE.tierBotMix,
      tierMultipliers: CAREER_V1_FREEZE_CANDIDATE.tierMultipliers,
      ...movement,
      scoreBank: fixedBank(),
    };
    const first = simulateCareerWorld(config);
    expect(simulateCareerWorld(config)).toEqual(first);
    expect(first.careers.every((career) =>
      legacyPoints(career.legacyAwards, CAREER_V1_LEGACY_POINTS) >= 0)).toBe(true);
    const qualifications = first.championships.reduce(
      (total, championship) => total + championship.humanQualifierIds.length,
      0,
    );
    expect(first.careers.reduce(
      (total, career) => total + career.legacyAwards.championshipQualification,
      0,
    )).toBe(qualifications);
    expect(first.careers.reduce(
      (total, career) => total + career.legacyAwards.championshipWin,
      0,
    )).toBe(first.championships.filter((championship) =>
      championship.winnerId?.startsWith("human-")).length);
  });

  it("keeps the configured field floor while allowing human-driven expansion", () => {
    const result = simulateCareerWorld({
      seed: "field-floor",
      fieldSize: 20,
      humanRatio: 1.5,
      seasons: 4,
      scoreBank: fixedBank(),
    });
    expect(result.careers).toHaveLength(30);
    expect(result.tierSnapshots.every((snapshot) => snapshot.fieldSize >= 20)).toBe(true);
    expect(result.tierSnapshots.some((snapshot) => snapshot.fieldSize > 20)).toBe(true);
  });
});
