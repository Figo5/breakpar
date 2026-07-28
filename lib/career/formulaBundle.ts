import {
  CAREER_V1_FREEZE_CANDIDATE,
  TENDENCIES,
  type AbilityBand,
  type Tendency,
} from "./simulator";
import { CAREER_CANONICAL_VERSION } from "./canonical";
import {
  STANDARD_V2_RULESET,
  STANDARD_V1_RULESET,
  type GameplayRulesetVersion,
} from "@/lib/engine/rulesets";
import {
  CAREER_FOUNDATION_POINT_CAP,
  CAREER_INITIAL_SKILL_RANK,
  CAREER_MAX_SKILL_RANK,
  CAREER_SKILL_STEP,
} from "./development";

/**
 * The historical synchronized-cadence package. It is FROZEN: never edit its
 * content. Snapshots published under it must keep resolving byte-identically.
 */
export const CAREER_V1_FORMULA_VERSION = CAREER_V1_FREEZE_CANDIDATE.id;

/**
 * The player-paced package (Career v1 product, formula package v2). Identical to
 * the frozen package except that the human movement cap is retired — with one
 * human per personal field, `humanMovementLimit` evaluated to 4 against a
 * population of 1 and could never bind — and Championship qualification becomes
 * a personal four-season cycle gated on Challenger/Pro.
 * See docs/career-player-paced-design.md §12 and §6.
 */
export const CAREER_V2_FORMULA_VERSION = "career-v2-player-paced";
export const CAREER_V3_FORMULA_VERSION = "career-v3-four-round-events";
export const CAREER_V4_FORMULA_VERSION = "career-v4-progression";

/** The version new settlements pin. */
export const CAREER_FORMULA_VERSION = CAREER_V4_FORMULA_VERSION;

export const CAREER_COMPONENT_VERSIONS = {
  canonicalSerialization: CAREER_CANONICAL_VERSION,
  eventPoints: "career-event-points-v1",
  seasonRanking: "career-season-ranking-v1",
  movement: "career-movement-candidate-h-v1",
  botRoster: "career-bot-roster-v1",
  botTierMix: "career-bot-tier-mix-v1",
  botPolicy: "career-bot-error-policy-v1",
  gameEngine: "breakpar-shot-engine-v1",
  scoring: "breakpar-scoring-events-v1",
  eventFormat: "career-event-format-v1-one-round",
  tourRating: "career-tour-rating-v1",
  legacy: "career-legacy-balanced-v1",
  championshipQualification: "career-championship-qualification-v1",
  championshipResult: "career-championship-result-v1",
  development: "career-development-none-v1",
} as const;

/** Movement rules. The cap fields are absent once the cap is retired (v2+). */
export interface CareerMovementRules {
  readonly promotionModel: "rolling";
  readonly rollingWindow: number;
  readonly rollingMinEntries: number;
  readonly rollingPromoteThreshold: number;
  readonly rollingPromotionFloor: number;
  readonly rollingRelegateThreshold: number;
  readonly rollingPromotionCarryWeight: number;
  readonly humanMovementLimitModel: "percentage-cap" | "none";
  readonly humanMovementLimitMin?: number;
  readonly humanMovementLimitScale?: number;
  readonly humanMovementLimitMax?: number;
  readonly tierThresholds?: Readonly<Record<
    "local" | "challenger" | "pro",
    {
      readonly promoteThreshold: number;
      readonly promotionFloor: number;
      readonly relegateThreshold: number;
    }
  >>;
}

export interface CareerDevelopmentRules {
  readonly model: "four-attribute-ranks";
  readonly initialRank: number;
  readonly maxRank: number;
  readonly upgradeCost: "current-rank";
  readonly completionFoundationCap: number;
  readonly topHalfPoints: number;
  readonly topQuarterBonus: number;
  readonly probabilitySteps: typeof CAREER_SKILL_STEP;
}

/** v1: shared population, cross-tier pass-down. Retired but preserved. */
export interface SharedTierChampionshipRules {
  readonly fieldSize: 20;
  readonly proTop: 6;
  readonly proEventWinnerSlots: 4;
  readonly challengerTop: 2;
  readonly duplicatePolicy: "pro-standings-passdown";
  readonly remainingSlots: "elite-bots";
  readonly affectsMovement: false;
  readonly affectsTourRating: false;
}

/** v2: one human per personal field; qualification is a personal cycle. */
export interface PersonalCycleChampionshipRules {
  readonly fieldSize: 20;
  readonly qualification: "personal-cycle";
  readonly seasonsPerCycle: 4;
  readonly minimumTier: "challenger";
  readonly humanSlots: 1;
  readonly remainingSlots: "elite-bots";
  readonly affectsMovement: false;
  readonly affectsTourRating: false;
}

export interface CareerFormulaBundle {
  readonly id: string;
  /** Gameplay engine pinned for every human and bot card in this package. */
  readonly gameplayRulesetVersion: GameplayRulesetVersion;
  readonly componentVersions: Readonly<Record<keyof typeof CAREER_COMPONENT_VERSIONS, string>>;
  readonly ability: {
    readonly model: "error";
    readonly errorRates: Readonly<Record<AbilityBand, number>>;
    readonly tendencies: readonly Tendency[];
  };
  readonly bots: {
    readonly fieldModel: "tier-scaled";
    readonly identitiesPerWorld: 30;
    readonly recurringIdentities: 8;
    readonly tierMix: {
      readonly local: Readonly<Record<AbilityBand, number>>;
      readonly challenger: Readonly<Record<AbilityBand, number>>;
      readonly pro: Readonly<Record<AbilityBand, number>>;
    };
  };
  readonly eventPoints: {
    readonly formula: "100 * (lockedFieldSize - occupiedPosition) / (lockedFieldSize - 1)";
    readonly tiedPositions: "average";
    readonly noShowPoints: 0;
    readonly onePlayerPoints: 100;
    readonly countingEvents: 3;
    readonly scheduledEvents: 4;
  };
  readonly movement: CareerMovementRules;
  readonly tourRating: {
    readonly chronologicalWindow: 8;
    readonly countingRatings: 6;
    readonly inactiveRating: 0;
    readonly tierMultipliers: typeof CAREER_V1_FREEZE_CANDIDATE.tierMultipliers;
  };
  readonly legacyPoints: typeof CAREER_V1_FREEZE_CANDIDATE.legacyPoints;
  readonly championship: SharedTierChampionshipRules | PersonalCycleChampionshipRules;
  readonly development?: CareerDevelopmentRules;
}

export interface PinnedCareerFormulaBundle {
  readonly formulaPackageVersion: string;
  readonly runtimeRevision: string;
  readonly bundle: CareerFormulaBundle;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const careerV1FreezeCandidate: CareerFormulaBundle = deepFreeze({
  id: CAREER_V1_FORMULA_VERSION,
  gameplayRulesetVersion: STANDARD_V1_RULESET,
  componentVersions: { ...CAREER_COMPONENT_VERSIONS },
  ability: {
    model: CAREER_V1_FREEZE_CANDIDATE.abilityModel,
    errorRates: { ...CAREER_V1_FREEZE_CANDIDATE.errorRates },
    tendencies: [...TENDENCIES],
  },
  bots: {
    fieldModel: CAREER_V1_FREEZE_CANDIDATE.botFieldModel,
    identitiesPerWorld: 30,
    recurringIdentities: 8,
    tierMix: {
      local: { ...CAREER_V1_FREEZE_CANDIDATE.tierBotMix.local },
      challenger: { ...CAREER_V1_FREEZE_CANDIDATE.tierBotMix.challenger },
      pro: { ...CAREER_V1_FREEZE_CANDIDATE.tierBotMix.pro },
    },
  },
  eventPoints: {
    formula: "100 * (lockedFieldSize - occupiedPosition) / (lockedFieldSize - 1)",
    tiedPositions: "average",
    noShowPoints: 0,
    onePlayerPoints: 100,
    countingEvents: 3,
    scheduledEvents: 4,
  },
  movement: { ...CAREER_V1_FREEZE_CANDIDATE.movement },
  tourRating: {
    chronologicalWindow: 8,
    countingRatings: 6,
    inactiveRating: 0,
    tierMultipliers: { ...CAREER_V1_FREEZE_CANDIDATE.tierMultipliers },
  },
  legacyPoints: { ...CAREER_V1_FREEZE_CANDIDATE.legacyPoints },
  championship: {
    fieldSize: 20,
    proTop: 6,
    proEventWinnerSlots: 4,
    challengerTop: 2,
    duplicatePolicy: "pro-standings-passdown",
    remainingSlots: "elite-bots",
    affectsMovement: false,
    affectsTourRating: false,
  },
});

/**
 * Player-paced package. Derived from the frozen package so every calibrated
 * value (ability, tier mix, event points, Tour Rating, Legacy awards) stays
 * byte-identical; only movement and Championship qualification differ.
 */
const careerV2PlayerPaced: CareerFormulaBundle = deepFreeze({
  id: CAREER_V2_FORMULA_VERSION,
  gameplayRulesetVersion: STANDARD_V1_RULESET,
  componentVersions: {
    ...CAREER_COMPONENT_VERSIONS,
    // The human movement cap is retired; qualification is a personal cycle.
    movement: "career-movement-candidate-h-v2-uncapped",
    championshipQualification: "career-championship-qualification-v2-personal-cycle",
  },
  ability: {
    model: CAREER_V1_FREEZE_CANDIDATE.abilityModel,
    errorRates: { ...CAREER_V1_FREEZE_CANDIDATE.errorRates },
    tendencies: [...TENDENCIES],
  },
  bots: {
    fieldModel: CAREER_V1_FREEZE_CANDIDATE.botFieldModel,
    identitiesPerWorld: 30,
    recurringIdentities: 8,
    tierMix: {
      local: { ...CAREER_V1_FREEZE_CANDIDATE.tierBotMix.local },
      challenger: { ...CAREER_V1_FREEZE_CANDIDATE.tierBotMix.challenger },
      pro: { ...CAREER_V1_FREEZE_CANDIDATE.tierBotMix.pro },
    },
  },
  eventPoints: {
    formula: "100 * (lockedFieldSize - occupiedPosition) / (lockedFieldSize - 1)",
    tiedPositions: "average",
    noShowPoints: 0,
    onePlayerPoints: 100,
    countingEvents: 3,
    scheduledEvents: 4,
  },
  movement: {
    promotionModel: CAREER_V1_FREEZE_CANDIDATE.movement.promotionModel,
    rollingWindow: CAREER_V1_FREEZE_CANDIDATE.movement.rollingWindow,
    rollingMinEntries: CAREER_V1_FREEZE_CANDIDATE.movement.rollingMinEntries,
    rollingPromoteThreshold: CAREER_V1_FREEZE_CANDIDATE.movement.rollingPromoteThreshold,
    rollingPromotionFloor: CAREER_V1_FREEZE_CANDIDATE.movement.rollingPromotionFloor,
    rollingRelegateThreshold: CAREER_V1_FREEZE_CANDIDATE.movement.rollingRelegateThreshold,
    rollingPromotionCarryWeight: CAREER_V1_FREEZE_CANDIDATE.movement.rollingPromotionCarryWeight,
    // Retired: with exactly one human per field the cap could never bind.
    humanMovementLimitModel: "none",
  },
  tourRating: {
    chronologicalWindow: 8,
    countingRatings: 6,
    inactiveRating: 0,
    tierMultipliers: { ...CAREER_V1_FREEZE_CANDIDATE.tierMultipliers },
  },
  legacyPoints: { ...CAREER_V1_FREEZE_CANDIDATE.legacyPoints },
  championship: {
    fieldSize: 20,
    qualification: "personal-cycle",
    seasonsPerCycle: 4,
    minimumTier: "challenger",
    humanSlots: 1,
    remainingSlots: "elite-bots",
    affectsMovement: false,
    affectsTourRating: false,
  },
});

/** Four-round event package. All movement, points, rating, Legacy, and
 * Championship rules remain v2-identical; only the event score becomes the
 * cumulative total of four deterministic cards. */
const careerV3FourRoundEvents: CareerFormulaBundle = deepFreeze({
  ...careerV2PlayerPaced,
  id: CAREER_V3_FORMULA_VERSION,
  gameplayRulesetVersion: STANDARD_V1_RULESET,
  componentVersions: {
    ...careerV2PlayerPaced.componentVersions,
    eventFormat: "career-event-format-v2-four-round-cumulative",
  },
});

/**
 * Career progression package. Historical v1-v3 packages remain byte-identical.
 * v4 changes only future-season movement thresholds, pins the casual scoring
 * engine, and introduces bounded player attributes whose exact modifiers are
 * part of the immutable formula payload.
 */
const careerV4Progression: CareerFormulaBundle = deepFreeze({
  ...careerV3FourRoundEvents,
  id: CAREER_V4_FORMULA_VERSION,
  gameplayRulesetVersion: STANDARD_V2_RULESET,
  componentVersions: {
    ...careerV3FourRoundEvents.componentVersions,
    movement: "career-movement-candidate-exact-ranks-v2",
    development: "career-development-four-attribute-v1",
  },
  movement: {
    ...careerV3FourRoundEvents.movement,
    tierThresholds: {
      local: {
        promoteThreshold: 0.72,
        promotionFloor: 0.60,
        relegateThreshold: 0.40,
      },
      challenger: {
        promoteThreshold: 0.75,
        promotionFloor: 0.62,
        relegateThreshold: 0.40,
      },
      pro: {
        promoteThreshold: 1,
        promotionFloor: 1,
        relegateThreshold: 0.40,
      },
    },
  },
  development: {
    model: "four-attribute-ranks",
    initialRank: CAREER_INITIAL_SKILL_RANK,
    maxRank: CAREER_MAX_SKILL_RANK,
    upgradeCost: "current-rank",
    completionFoundationCap: CAREER_FOUNDATION_POINT_CAP,
    topHalfPoints: 1,
    topQuarterBonus: 1,
    probabilitySteps: CAREER_SKILL_STEP,
  },
});

const FORMULA_REGISTRY = new Map<string, CareerFormulaBundle>([
  [careerV1FreezeCandidate.id, careerV1FreezeCandidate],
  [careerV2PlayerPaced.id, careerV2PlayerPaced],
  [careerV3FourRoundEvents.id, careerV3FourRoundEvents],
  [careerV4Progression.id, careerV4Progression],
]);

export function getCareerFormulaBundle(version: string): CareerFormulaBundle | undefined {
  return FORMULA_REGISTRY.get(version);
}

export function requireCareerFormulaBundle(version: string): CareerFormulaBundle {
  const bundle = getCareerFormulaBundle(version);
  if (!bundle) {
    throw new Error(`Career formula bundle "${version}" is unavailable; settlement requires manual review`);
  }
  return bundle;
}

export function listCareerFormulaVersions(): readonly string[] {
  return Object.freeze([...FORMULA_REGISTRY.keys()]);
}

/**
 * The immutable payload persisted with each lock/input snapshot. Runtime
 * revision is diagnostic only; all calculation behavior comes from `bundle`.
 */
export function pinCareerFormulaBundle(
  version: string,
  runtimeRevision: string,
): PinnedCareerFormulaBundle {
  if (runtimeRevision.trim().length === 0) {
    throw new TypeError("Career formula runtime revision must not be empty");
  }
  return deepFreeze({
    formulaPackageVersion: version,
    runtimeRevision,
    bundle: requireCareerFormulaBundle(version),
  });
}

/** Historical, frozen. Retained so old snapshots keep resolving. */
export const CAREER_V1_FORMULA_BUNDLE = careerV1FreezeCandidate;

/** The player-paced package. */
export const CAREER_V2_FORMULA_BUNDLE = careerV2PlayerPaced;

/** The four-round player-paced package. */
export const CAREER_V3_FORMULA_BUNDLE = careerV3FourRoundEvents;

/** The bounded player-progression package. */
export const CAREER_V4_FORMULA_BUNDLE = careerV4Progression;

/** What new settlements should read. */
export const CAREER_CURRENT_FORMULA_BUNDLE = careerV4Progression;
