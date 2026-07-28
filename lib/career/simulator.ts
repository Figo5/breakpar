/**
 * Standalone, deterministic Career Mode simulator.
 *
 * This is deliberately disconnected from Prisma, routes, clocks, and production
 * tournament state. Round score banks are generated through the real hole engine;
 * the meta-game then samples those banks deterministically so 500-player scenario
 * sweeps remain fast enough to run during calibration.
 */
import { COURSES, coursePar, type Course } from "@/data/courses";
import { AGGRESSIVE_BUDGET } from "@/lib/holeRead";
import {
  STANDARD_V2_RULESET,
  type GameplayRulesetVersion,
} from "@/lib/engine/rulesets";
import type { CareerSkillRanks } from "./development";
import { holeDifficulty, type Conditions, type HoleSpec } from "@/lib/engine/resolveHole";
import { hashSeed, mulberry32 } from "@/lib/engine/rng";
import { resolveHoleChain, type ChainResult, type Lie } from "@/lib/engine/shots";
import type { Decision, Outcome } from "@/lib/engine/probabilities";
import {
  BASELINE_MOVEMENT_RATE,
  BASELINE_TIER_MULTIPLIER,
  applyInactivity,
  blankLegacyAwardCounts,
  championshipField,
  movementForSeason,
  promoteTier,
  rankEvent,
  rankSeason,
  relegateTier,
  sameMovementPerformance,
  seasonRating,
  tourRating,
  type CareerTier,
  type ChampionshipSource,
  type LegacyAwardCounts,
  type LegacyPointSchedule,
  type MovementAction,
  type RatingSeason,
  type SeasonCompetitor,
  type SeasonEventResult,
  type SeasonStanding,
} from "./rules";

export const ABILITY_BANDS = ["rusty", "scratch", "ace"] as const;
export type AbilityBand = typeof ABILITY_BANDS[number];

export const TENDENCIES = ["conservative", "balanced", "aggressive", "situational"] as const;
export type Tendency = typeof TENDENCIES[number];

export const ACTIVITY_PATTERNS = ["full", "occasional", "returning"] as const;
export type ActivityPattern = typeof ACTIVITY_PATTERNS[number];

export interface CareerArchetype {
  ability: AbilityBand;
  tendency: Tendency;
}

/**
 * Which decision model the score bank was built with.
 *  - "v5": the original twelve hand-written ability/tendency policies
 *    (baseDecision). Preserved byte-for-byte as the locked baseline.
 *  - "error": the corrected candidate — one shared near-optimal reference
 *    policy plus a per-ability seeded DECISION-ERROR rate. See the report and
 *    referenceDecision/decisionWithError below.
 */
export type AbilityModel = "v5" | "error";
export type BotFieldModel = "uniform" | "tier-scaled";
export type TierBotMix = Record<CareerTier, Record<AbilityBand, number>>;
export type MovementConfirmation =
  | "none"
  | "promotion-only"
  | "symmetric"
  // Candidate B: promotion is one-shot, but the FIRST relegation-boundary season
  // is a protected "warning" — a just-promoted player who has one poor season is
  // held, not immediately reversed. Two consecutive weak seasons still relegate.
  | "relegation-protection";
/** Movement shape. "slot" = the v5 top/bottom-percentile rule (default, unchanged).
 * "rolling" = Candidate A: humans move on a rolling multi-season percentile so a
 * single lucky season rarely promotes and progression uses sustained form. */
export type PromotionModel = "slot" | "rolling";
export type HumanMovementLimitModel = "none" | "fixed" | "sqrt" | "percentage-cap";

/** Rolling-model defaults. Percentile is 0..1, 1 = best finish in the active field.
 * A promote threshold of 0.75 ≈ repeated top-quartile form; symmetric relegate at
 * 0.25. minEntries requires at least two active seasons of evidence, so one great
 * (or one lucky) season alone cannot move a competitor. */
export const ROLLING_DEFAULTS = {
  window: 2,
  promoteThreshold: 0.75,
  relegateThreshold: 0.25,
  minEntries: 2,
} as const;

export const TIER_SCALED_BOT_MIX: TierBotMix = {
  local: { rusty: 0.6, scratch: 0.35, ace: 0.05 },
  challenger: { rusty: 0.1, scratch: 0.45, ace: 0.45 },
  pro: { rusty: 0.02, scratch: 0.28, ace: 0.7 },
};

export const CAREER_V1_LEGACY_POINTS: LegacyPointSchedule = {
  eventCompletion: 1,
  eventTopFive: 5,
  eventWin: 15,
  activeSeasonCompletion: 3,
  promotion: 20,
  proSurvival: 12,
  seasonChampionship: 30,
  championshipQualification: 35,
  championshipWin: 100,
};

/**
 * Gate 3's versioned formula proposal. This package is simulator-only and does
 * not change the default v5 path when omitted from a simulation configuration.
 */
export const CAREER_V1_FREEZE_CANDIDATE = {
  id: "career-v1-freeze-candidate",
  abilityModel: "error" as const,
  errorRates: { rusty: 0.65, scratch: 0.14, ace: 0.02 } satisfies CareerErrorRates,
  botFieldModel: "tier-scaled" as const,
  tierBotMix: TIER_SCALED_BOT_MIX,
  movement: {
    promotionModel: "rolling" as const,
    rollingWindow: 2,
    rollingMinEntries: 2,
    rollingPromoteThreshold: 0.65,
    rollingPromotionFloor: 0.58,
    rollingRelegateThreshold: 0.32,
    rollingPromotionCarryWeight: 0.25,
    humanMovementLimitModel: "percentage-cap" as const,
    humanMovementLimitMin: 4,
    humanMovementLimitScale: 0.2,
    humanMovementLimitMax: 40,
  },
  tierMultipliers: BASELINE_TIER_MULTIPLIER,
  legacyPoints: CAREER_V1_LEGACY_POINTS,
} as const;

export interface ScoreBank {
  seed: string;
  samplesPerArchetype: number;
  scores: Map<string, number[]>;
  means: Map<string, number>;
  model?: AbilityModel;
  errorRates?: CareerErrorRates;
}

export interface CareerSimulatorConfig {
  seed: string;
  fieldSize: number;
  humanRatio: number;
  seasons: number;
  movementRate?: number;
  tierMultipliers?: Record<CareerTier, number>;
  /** Candidate rule: a competitor must qualify (finish in the promotion slots)
   * in two consecutive active seasons before actually promoting. Dampens
   * variance-driven weak promotion; relegation stays immediate. */
  requireRepeatQualification?: boolean;
  /** Candidate dimension only. Uniform preserves the v5 simulator baseline;
   * tier-scaled makes higher-tier bot fields progressively stronger. */
  botFieldModel?: BotFieldModel;
  /** Labelled tier-mix sensitivity. Omitted uses the existing scaled mix. */
  tierBotMix?: TierBotMix;
  /** Candidate movement confirmation. "symmetric" requires two consecutive
   * qualifying finishes on both promotion and relegation boundaries. */
  movementConfirmation?: MovementConfirmation;
  /** Candidate A: replace one-season human slot movement with a rolling
   * active-season percentile. Inactive seasons are skipped, never scored zero. */
  promotionModel?: PromotionModel;
  rollingWindow?: number;
  rollingPromoteThreshold?: number;
  rollingRelegateThreshold?: number;
  rollingMinEntries?: number;
  /** Optional performance-quality guards for rolling movement. Promotion
   * requires every percentile in the window to meet the floor; relegation
   * requires every percentile to stay at or below the ceiling. */
  rollingPromotionFloor?: number;
  rollingRelegationCeiling?: number;
  /** On promotion, retain one transformed item of evidence:
   * 0 = neutral 0.5 prior, 1 = the raw prior-tier rolling average.
   * Omitted preserves the existing full reset. */
  rollingPromotionCarryWeight?: number;
  /** Candidate C: soft cap per direction on actual HUMAN movers in a cohort.
   * Exact performance ties at the cap boundary remain together. */
  humanMovementCap?: number;
  /** Adaptive alternatives to a fixed human cap. The computed cap is
   * clamp(ceil(scale × sqrt(activeHumans)) or ceil(scale × activeHumans),
   * min, max). All are default-off. */
  humanMovementLimitModel?: HumanMovementLimitModel;
  humanMovementLimitMin?: number;
  humanMovementLimitScale?: number;
  humanMovementLimitMax?: number;
  scoreBank: ScoreBank;
}

export interface CareerSeasonRecord {
  season: number;
  tier: CareerTier;
  nextTier: CareerTier;
  active: boolean;
  completedEvents: number;
  rank: number | null;
  activeFieldSize: number;
  seasonPoints: number;
  rating: number;
  tourRating: number;
  movement: MovementAction;
  movementState?: "relegation-warning" | "movement-cap";
}

export interface SimulatedCareer {
  competitorId: string;
  ability: AbilityBand;
  tendency: Tendency;
  activity: ActivityPattern;
  tier: CareerTier;
  consecutiveInactiveSeasons: number;
  consecutiveQualifyingSeasons: number;
  consecutiveRelegatingSeasons: number;
  rollingPercentiles?: number[];
  histories: CareerSeasonRecord[];
  ratingHistory: RatingSeason[];
  legacyAwards: LegacyAwardCounts;
  firstProSeason: number | null;
}

export interface TierSeasonSnapshot {
  season: number;
  tier: CareerTier;
  humanCount: number;
  fieldSize: number;
  activeCount: number;
  baseMovementSlots: number;
  promoted: number;
  relegated: number;
  promotionTieExpansion: number;
  relegationTieExpansion: number;
}

export interface ChampionshipSnapshot {
  season: number;
  qualifiersBySource: Record<ChampionshipSource, number>;
  humanQualifiersBySource: Record<ChampionshipSource, number>;
  humanQualifierIds: string[];
  winnerId: string | null;
  fieldSize: number;
}

export interface CareerSimulation {
  config: Omit<CareerSimulatorConfig, "scoreBank"> & { bankSeed: string };
  careers: SimulatedCareer[];
  tierSnapshots: TierSeasonSnapshot[];
  championships: ChampionshipSnapshot[];
}

interface PolicyState {
  rel: number;
  holesLeft: number;
  aggrLeft: number;
}

function archetypeKey(archetype: CareerArchetype): string {
  return `${archetype.ability}:${archetype.tendency}`;
}

function spend(decision: Decision, state: PolicyState): Decision {
  if (decision !== "aggressive") return decision;
  if (state.aggrLeft <= 0) return "normal";
  state.aggrLeft--;
  return decision;
}

function baseDecision(
  archetype: CareerArchetype,
  stage: "tee" | "approach" | "putt" | "scramble",
  hole: HoleSpec,
  difficulty: number,
  lie: Lie | null,
  bucket: "short" | "long" | null,
  state: PolicyState,
): Decision {
  const { ability, tendency } = archetype;

  if (ability === "rusty") {
    if (tendency === "conservative") return stage === "putt" && bucket === "short" ? "normal" : "safe";
    if (tendency === "aggressive") return "aggressive";
    if (tendency === "situational") {
      if (lie === "trouble" || bucket === "long" || difficulty > 0.68) return "safe";
      return state.rel >= 1 && state.holesLeft <= 6 ? "aggressive" : "normal";
    }
    return "normal";
  }

  if (tendency === "conservative") {
    if (stage === "putt" && bucket === "short") return "normal";
    if (stage === "approach" && hole.par === 5 && (lie === "dialed" || lie === "fairway") && ability === "ace") {
      return difficulty < 0.38 ? "aggressive" : "normal";
    }
    return difficulty > 0.42 || lie === "trouble" || bucket === "long" ? "safe" : "normal";
  }
  if (tendency === "aggressive") {
    if (stage === "putt" && bucket === "long" && ability === "scratch") return "normal";
    if (lie === "trouble" && ability === "scratch") return "safe";
    return "aggressive";
  }

  if (ability === "scratch") {
    const situational = tendency === "situational";
    if (stage === "tee") {
      const chaseBonus = situational && state.rel >= 0 && state.holesLeft <= 6 ? 0.16 : 0;
      return difficulty < 0.34 + chaseBonus ? "aggressive" : difficulty > 0.62 ? "safe" : "normal";
    }
    if (stage === "approach") {
      if (lie === "trouble") {
        return situational && state.rel >= 2 && state.holesLeft <= 3 ? "aggressive" : "safe";
      }
      if (hole.par === 5 && (lie === "dialed" || lie === "fairway")) return "aggressive";
      if (situational && state.rel >= 0 && state.holesLeft <= 7 && lie === "rough") return "aggressive";
      return lie === "dialed" || lie === "fairway" ? "aggressive" : "normal";
    }
    if (stage === "putt") {
      return bucket === "long" && !(situational && state.rel >= 2 && state.holesLeft <= 3) ? "safe" : "normal";
    }
    return situational && state.rel >= 1 && state.holesLeft <= 5 ? "aggressive" : "normal";
  }

  // Ace/Balanced and Ace/Situational both read game state. Situational pushes
  // the late-round adjustment farther; Balanced stays closer to the Scratch
  // policy while retaining better trouble management.
  const situational = tendency === "situational";
  if (stage === "tee") {
    let attackBelow = situational ? 0.34 : 0.3;
    if (state.rel >= 0 && state.holesLeft <= 9) attackBelow += situational ? 0.18 : 0.1;
    if (state.rel <= -2 && state.holesLeft <= 6) attackBelow -= 0.14;
    if (difficulty < attackBelow) return "aggressive";
    return difficulty > 0.62 && !(state.rel >= 0 && state.holesLeft <= 4) ? "safe" : "normal";
  }
  if (stage === "approach") {
    if (lie === "trouble") {
      return situational && state.rel >= 1 && state.holesLeft <= 3 ? "aggressive" : "safe";
    }
    if (hole.par === 5 && (lie === "dialed" || lie === "fairway") && difficulty < 0.58) return "aggressive";
    if (lie === "rough") {
      return situational && state.rel >= 0 && state.holesLeft <= 8 ? "aggressive" : "normal";
    }
    return difficulty < (situational ? 0.52 : 0.46) ? "aggressive" : "normal";
  }
  if (stage === "putt") {
    if (bucket === "long") return situational && state.rel >= 2 && state.holesLeft <= 3 ? "normal" : "safe";
    return situational && state.rel >= 0 && state.holesLeft <= 8 ? "aggressive" : "normal";
  }
  return situational && state.rel >= 1 && state.holesLeft <= 6 ? "aggressive" : "normal";
}

// --- corrected ability model: shared reference policy + decision error --------
//
// WHY THIS EXISTS: the engine probe (docs/career-simulator-report.md) shows the
// score-minimising constant decision is "normal" (+1.54/round), with "safe"
// (+2.92) and "aggressive" (+2.26) both worse. So there is almost no headroom
// for "better tactical aggression" to separate ability bands, and the v5 policies
// invert (Ace chases with EV-negative aggression and scores worse than Scratch).
//
// The engine-consistent skill signal that DOES exist is how often a competitor
// deviates from a near-optimal decision. Every competitor runs the same reference
// policy; ability is the probability of a seeded deviation to a worse choice.
// Because every deviation is EV-negative here, a higher error rate strictly raises
// expected score — a monotonic skill lever, resolved through the same engine with
// no hidden bonus, no arbitrary strokes, and full deterministic replay.

/** Per-ability probability of a decision error under the "error" model. */
export const CAREER_ERROR_RATE: Record<AbilityBand, number> = {
  rusty: 0.42,
  scratch: 0.18,
  ace: 0.05,
};
export type CareerErrorRates = Record<AbilityBand, number>;

const DECISION_ORDER: Decision[] = ["safe", "normal", "aggressive"];

/** Near-optimal, stroke-minimising reference policy — no game-state chasing,
 * because chasing (aggression when at/above par) is EV-negative here. */
function referenceDecision(
  stage: "tee" | "approach" | "putt" | "scramble",
  hole: HoleSpec,
  difficulty: number,
  lie: Lie | null,
  bucket: "short" | "long" | null,
): Decision {
  if (stage === "tee") {
    if (difficulty < 0.32) return "aggressive";
    if (difficulty > 0.66) return "safe";
    return "normal";
  }
  if (stage === "approach") {
    if (lie === "trouble") return "safe";
    const goodLie = lie === "dialed" || lie === "fairway";
    if (hole.par === 5 && goodLie && difficulty < 0.5) return "aggressive";
    if (goodLie && difficulty < 0.4) return "aggressive";
    return "normal";
  }
  if (stage === "putt") return bucket === "long" ? "safe" : "normal";
  return "normal"; // scramble
}

/** Apply the seeded decision error. Tendency only skews WHICH wrong decision is
 * chosen (identity flavour), never the error RATE, so it cannot invert ability
 * ordering. */
function decisionWithError(
  reference: Decision,
  archetype: CareerArchetype,
  errRoll: number,
  pickRoll: number,
  errorRates: CareerErrorRates = CAREER_ERROR_RATE,
): Decision {
  const rate = errorRates[archetype.ability];
  if (rate <= 0 || errRoll >= rate) return reference;
  const refIndex = DECISION_ORDER.indexOf(reference);
  const others = DECISION_ORDER.filter((decision) => decision !== reference);
  if (others.length === 0) return reference;
  const bolder = others.filter((decision) => DECISION_ORDER.indexOf(decision) > refIndex);
  const safer = others.filter((decision) => DECISION_ORDER.indexOf(decision) < refIndex);
  if (bolder.length && safer.length) {
    let boldBias = 0.5;
    if (archetype.tendency === "conservative") boldBias = 0.25;
    else if (archetype.tendency === "aggressive") boldBias = 0.75;
    return pickRoll < boldBias ? bolder[0] : safer[0];
  }
  return others[Math.floor(pickRoll * others.length) % others.length];
}

/** One real-engine round for an archetype; exported for focused verification. */
export function simulateArchetypeRound(
  seed: string,
  course: Course,
  archetype: CareerArchetype,
  model: AbilityModel = "v5",
  errorRates: CareerErrorRates = CAREER_ERROR_RATE,
  rulesetVersion: GameplayRulesetVersion = STANDARD_V2_RULESET,
  careerSkills?: CareerSkillRanks,
): number {
  const conditions: Conditions = { difficulty: course.difficulty, wind: course.wind };
  const state: PolicyState = { rel: 0, holesLeft: course.holes.length, aggrLeft: AGGRESSIVE_BUDGET };
  const recent: Outcome[] = [];
  let total = 0;

  for (let holeIndex = 0; holeIndex < course.holes.length; holeIndex++) {
    const sourceHole = course.holes[holeIndex];
    const hole: HoleSpec = {
      number: sourceHole.number,
      par: sourceHole.par,
      strokeIndex: sourceHole.strokeIndex,
      yardage: sourceHole.yardage,
    };
    const difficulty = holeDifficulty(hole, conditions);
    state.holesLeft = course.holes.length - holeIndex;
    const namespace = `${seed}:${course.slug}:h${sourceHole.number}`;
    const opts = {
      shotSeed: (shotIndex: number) => hashSeed(`${namespace}:shot:${shotIndex}`),
      eventSeed: (shotIndex: number) => hashSeed(`${namespace}:event:${shotIndex}`),
      hazardSeed: (shotIndex: number) => hashSeed(`${namespace}:hazard:${shotIndex}`),
      scoringEventSeed: (shotIndex: number) => hashSeed(`${namespace}:scoring:${shotIndex}`),
      greens: course.greens,
      recent,
      narration: false as const,
      holeContext: { hazard: sourceHole.hazard, signature: sourceHole.signature },
      rulesetVersion,
      careerSkills,
    };
    const decisions: Decision[] = [];
    let result: ChainResult = resolveHoleChain(decisions, hole, conditions, opts);
    let guard = 0;
    let decisionIndex = 0;
    while (!result.complete && guard++ < 6) {
      const stage = result.next;
      if (stage !== "tee" && stage !== "approach" && stage !== "putt" && stage !== "scramble") {
        throw new Error(`Unexpected Career simulator decision stage: ${String(stage)}`);
      }
      const lie = result.lie ?? null;
      const bucket = stage === "putt" ? result.putt!.bucket : null;
      let decision: Decision;
      if (model === "error") {
        decision = decisionWithError(
          referenceDecision(stage, hole, difficulty, lie, bucket),
          archetype,
          mulberry32(hashSeed(`${namespace}:err:${decisionIndex}`))(),
          mulberry32(hashSeed(`${namespace}:errpick:${decisionIndex}`))(),
          errorRates,
        );
      } else {
        decision = baseDecision(archetype, stage, hole, difficulty, lie, bucket, state);
      }
      if (stage === "tee" || stage === "approach") decision = spend(decision, state);
      decisions.push(decision);
      decisionIndex++;
      result = resolveHoleChain(decisions, hole, conditions, opts);
    }
    if (!result.complete) throw new Error(`Career simulator failed to complete ${course.slug} hole ${sourceHole.number}`);
    const relative = result.scoreDelta ?? 0;
    total += sourceHole.par + relative;
    state.rel += relative;
    recent.push(result.outcome as Outcome);
  }

  return total - coursePar(course);
}

export function buildScoreBank(
  seed: string,
  samplesPerArchetype = 128,
  model: AbilityModel = "v5",
  errorRates: CareerErrorRates = CAREER_ERROR_RATE,
): ScoreBank {
  const scores = new Map<string, number[]>();
  const means = new Map<string, number>();
  for (const ability of ABILITY_BANDS) {
    for (const tendency of TENDENCIES) {
      const archetype = { ability, tendency };
      const values: number[] = [];
      for (let sample = 0; sample < samplesPerArchetype; sample++) {
        // Common courses and outcome streams make policy comparisons much less
        // noisy: score differences come from decisions, not a luckier seed bank.
        const sampleSeed = `${seed}:sample:${sample}`;
        const course = COURSES[hashSeed(`${sampleSeed}:course`) % COURSES.length];
        values.push(simulateArchetypeRound(sampleSeed, course, archetype, model, errorRates));
      }
      scores.set(archetypeKey(archetype), values);
      means.set(archetypeKey(archetype), values.reduce((sum, value) => sum + value, 0) / values.length);
    }
  }
  return {
    seed,
    samplesPerArchetype,
    scores,
    means,
    model,
    ...(model === "error" ? { errorRates: { ...errorRates } } : {}),
  };
}

function sampleScore(bank: ScoreBank, archetype: CareerArchetype, key: string): number {
  const scores = bank.scores.get(archetypeKey(archetype));
  if (!scores?.length) throw new Error(`Missing score bank for ${archetypeKey(archetype)}`);
  return scores[hashSeed(`${bank.seed}:${key}`) % scores.length];
}

/** Pure deterministic bot-ability selection. The uniform path intentionally
 * preserves the original index cycle byte-for-byte. */
export function botAbilityForSlot(
  tier: CareerTier,
  index: number,
  seed: string,
  model: BotFieldModel = "uniform",
  tierMix: TierBotMix = TIER_SCALED_BOT_MIX,
): AbilityBand {
  if (model === "uniform") return ABILITY_BANDS[index % ABILITY_BANDS.length];
  const roll = mulberry32(hashSeed(`${seed}:tier-scaled:${tier}:bot:${index}`))();
  const mix = tierMix[tier];
  if (roll < mix.rusty) return "rusty";
  if (roll < mix.rusty + mix.scratch) return "scratch";
  return "ace";
}

export interface ConfirmedMovement {
  action: MovementAction;
  consecutiveQualifyingSeasons: number;
  consecutiveRelegatingSeasons: number;
}

/** Candidate-only confirmation layer applied after the unchanged v5 slot rule. */
export function confirmMovementSlot(
  slot: MovementAction,
  confirmation: MovementConfirmation,
  priorQualifyingSeasons: number,
  priorRelegatingSeasons: number,
): ConfirmedMovement {
  if (slot === "inactive") {
    return {
      action: "inactive",
      consecutiveQualifyingSeasons: 0,
      consecutiveRelegatingSeasons: 0,
    };
  }
  if (slot === "hold") {
    return {
      action: "hold",
      consecutiveQualifyingSeasons: 0,
      consecutiveRelegatingSeasons: 0,
    };
  }
  if (slot === "promote") {
    const consecutiveQualifyingSeasons = priorQualifyingSeasons + 1;
    const needsRepeat = confirmation === "promotion-only" || confirmation === "symmetric";
    const action = !needsRepeat || consecutiveQualifyingSeasons >= 2 ? "promote" : "hold";
    return {
      action,
      consecutiveQualifyingSeasons: action === "promote" ? 0 : consecutiveQualifyingSeasons,
      consecutiveRelegatingSeasons: 0,
    };
  }
  const consecutiveRelegatingSeasons = priorRelegatingSeasons + 1;
  const needsRepeat = confirmation === "symmetric" || confirmation === "relegation-protection";
  const action = !needsRepeat || consecutiveRelegatingSeasons >= 2 ? "relegate" : "hold";
  return {
    action,
    consecutiveQualifyingSeasons: 0,
    consecutiveRelegatingSeasons: action === "relegate" ? 0 : consecutiveRelegatingSeasons,
  };
}

export interface RollingMovementOptions {
  window: number;
  promoteThreshold: number;
  relegateThreshold: number;
  minEntries: number;
  promotionFloor?: number;
  relegationCeiling?: number;
}

export interface RollingMovementResult {
  action: MovementAction;
  history: number[];
  average: number | null;
}

export function activeSeasonPercentile(activeFieldSize: number, activeRank: number): number {
  if (activeFieldSize <= 0 || activeRank <= 0 || activeRank > activeFieldSize) return 0;
  return activeFieldSize === 1
    ? 1
    : (activeFieldSize - activeRank) / (activeFieldSize - 1);
}

/** Candidate A's pure rolling movement rule. The caller invokes this only for
 * active seasons, so inactivity neither adds a zero nor breaks the window. */
export function rollingMovementForSeason(
  priorHistory: number[],
  currentPercentile: number,
  tier: CareerTier,
  options: RollingMovementOptions = ROLLING_DEFAULTS,
): RollingMovementResult {
  const window = Math.max(1, Math.floor(options.window));
  const minEntries = Math.max(1, Math.min(window, Math.floor(options.minEntries)));
  const history = [...priorHistory, Math.max(0, Math.min(1, currentPercentile))].slice(-window);
  if (history.length < minEntries) return { action: "hold", history, average: null };
  const average = history.reduce((sum, value) => sum + value, 0) / history.length;
  const thresholdTolerance = 1e-12;
  const clearsPromotionFloor = options.promotionFloor == null
    || history.every((percentile) => percentile + thresholdTolerance >= options.promotionFloor!);
  const clearsRelegationCeiling = options.relegationCeiling == null
    || history.every((percentile) => percentile - thresholdTolerance <= options.relegationCeiling!);
  if (
    tier !== "pro"
    && average + thresholdTolerance >= options.promoteThreshold
    && clearsPromotionFloor
  ) {
    return { action: "promote", history, average };
  }
  if (
    tier !== "local"
    && average - thresholdTolerance <= options.relegateThreshold
    && clearsRelegationCeiling
  ) {
    return { action: "relegate", history, average };
  }
  return { action: "hold", history, average };
}

/** Convert prior-tier form into one bounded item of evidence for the promoted
 * tier. This removes the structural empty-window immunity without treating a
 * Local/Challenger percentile as directly equivalent to a Pro percentile. */
export function rollingHistoryAfterPromotion(
  history: number[],
  carryWeight: number | undefined,
): number[] {
  if (carryWeight == null || history.length === 0) return [];
  const weight = Math.max(0, Math.min(1, carryWeight));
  const average = history.reduce((sum, value) => sum + value, 0) / history.length;
  return [0.5 + (average - 0.5) * weight];
}

export interface HumanMovementLimitOptions {
  model: HumanMovementLimitModel;
  fixedCap?: number;
  min?: number;
  scale?: number;
  max?: number;
}

/** Derive a per-direction human movement limit from the ACTIVE human cohort.
 * `none` returns null, leaving movement untouched. */
export function humanMovementLimit(
  activeHumanCount: number,
  options: HumanMovementLimitOptions,
): number | null {
  if (options.model === "none") return null;
  const active = Math.max(0, Math.floor(activeHumanCount));
  if (options.model === "fixed") return Math.max(0, Math.floor(options.fixedCap ?? 0));
  const minimum = Math.max(0, Math.floor(options.min ?? 0));
  const maximum = Math.max(minimum, Math.floor(options.max ?? Number.MAX_SAFE_INTEGER));
  const scale = Math.max(0, options.scale ?? 1);
  const raw = options.model === "sqrt"
    ? Math.ceil(scale * Math.sqrt(active))
    : Math.ceil(scale * active);
  return Math.min(maximum, Math.max(minimum, raw));
}

export interface BoundedHumanMovementResult {
  actions: Map<string, MovementAction>;
  promoted: number;
  relegated: number;
  heldByCap: Set<string>;
}

/** Candidate C's pure human cap. Full-field standings still determine who is
 * eligible; bots do not consume the human cap. Exact human ties at the cap
 * boundary move together, making this a soft rather than arbitrary hard cap. */
export function boundHumanMovement(
  standings: SeasonStanding[],
  proposedActions: Map<string, MovementAction>,
  cap: number,
): BoundedHumanMovementResult {
  const boundedCap = Math.max(0, Math.floor(cap));
  const actions = new Map<string, MovementAction>();
  const heldByCap = new Set<string>();
  for (const [competitorId, action] of proposedActions) {
    actions.set(competitorId, action === "inactive" ? "inactive" : "hold");
  }

  const select = (action: "promote" | "relegate") => {
    const candidates = standings.filter((standing) => proposedActions.get(standing.competitorId) === action);
    if (action === "relegate") candidates.reverse();
    if (boundedCap === 0 || candidates.length === 0) {
      for (const candidate of candidates) heldByCap.add(candidate.competitorId);
      return 0;
    }
    const boundary = candidates[Math.min(boundedCap, candidates.length) - 1];
    let moved = 0;
    for (const candidate of candidates) {
      if (moved < boundedCap || sameMovementPerformance(candidate, boundary)) {
        actions.set(candidate.competitorId, action);
        moved++;
      } else {
        heldByCap.add(candidate.competitorId);
      }
    }
    return moved;
  };

  return {
    actions,
    promoted: select("promote"),
    relegated: select("relegate"),
    heldByCap,
  };
}

function completedEventCount(profile: SimulatedCareer, season: number, seed: string): number {
  if (profile.activity === "full") return 4;
  if (profile.activity === "returning") {
    // A fixed two-season absence, then a clean return. Season 5/6 makes the
    // 8- and 16-season horizons directly comparable.
    return season === 5 || season === 6 ? 0 : 4;
  }
  const draw = mulberry32(hashSeed(`${seed}:${profile.competitorId}:activity:${season}`))();
  if (draw < 0.18) return 2;
  if (draw < 0.5) return 3;
  return 4;
}

function createCareers(config: CareerSimulatorConfig): SimulatedCareer[] {
  const count = Math.max(1, Math.round(config.fieldSize * config.humanRatio));
  const careers: SimulatedCareer[] = [];
  for (let index = 0; index < count; index++) {
    careers.push({
      competitorId: `human-${index + 1}`,
      ability: ABILITY_BANDS[index % ABILITY_BANDS.length],
      tendency: TENDENCIES[Math.floor(index / ABILITY_BANDS.length) % TENDENCIES.length],
      activity: ACTIVITY_PATTERNS[Math.floor(index / (ABILITY_BANDS.length * TENDENCIES.length)) % ACTIVITY_PATTERNS.length],
      tier: "local",
      consecutiveInactiveSeasons: 0,
      consecutiveQualifyingSeasons: 0,
      consecutiveRelegatingSeasons: 0,
      histories: [],
      ratingHistory: [],
      legacyAwards: blankLegacyAwardCounts(),
      firstProSeason: null,
    });
  }
  return careers;
}

interface CohortResult {
  standings: SeasonStanding[];
  eventWinners: string[];
  humanEvents: Map<string, SeasonEventResult[]>;
  movement: ReturnType<typeof movementForSeason>;
}

function simulateCohort(
  config: CareerSimulatorConfig,
  season: number,
  tier: CareerTier,
  humans: SimulatedCareer[],
): CohortResult {
  const botCount = Math.max(0, config.fieldSize - humans.length);
  const competitors: Array<{ id: string; archetype: CareerArchetype; completed: number; human: boolean }> = [
    ...humans.map((profile) => ({
      id: profile.competitorId,
      archetype: { ability: profile.ability, tendency: profile.tendency },
      completed: completedEventCount(profile, season, config.seed),
      human: true,
    })),
  ];
  for (let index = 0; index < botCount; index++) {
    competitors.push({
      id: `bot:${season}:${tier}:${index}`,
      archetype: {
        ability: botAbilityForSlot(
          tier,
          index,
          `${config.seed}:s${season}`,
          config.botFieldModel ?? "uniform",
          config.tierBotMix ?? TIER_SCALED_BOT_MIX,
        ),
        tendency: TENDENCIES[Math.floor(index / ABILITY_BANDS.length) % TENDENCIES.length],
      },
      completed: 4,
      human: false,
    });
  }

  const seasonEvents = new Map<string, SeasonEventResult[]>();
  const eventWinners: string[] = [];
  for (let eventIndex = 0; eventIndex < 4; eventIndex++) {
    const entries = competitors.map((competitor) => ({
      competitorId: competitor.id,
      relativeToPar: eventIndex < competitor.completed
        ? sampleScore(
          config.scoreBank,
          competitor.archetype,
          `${config.seed}:s${season}:${tier}:e${eventIndex}:${competitor.id}`,
        )
        : null,
    }));
    const standings = rankEvent(entries);
    const winner = [...standings]
      .filter((standing) => standing.completed)
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.competitorId.localeCompare(b.competitorId))[0];
    if (winner) eventWinners.push(winner.competitorId);
    for (const standing of standings) {
      const current = seasonEvents.get(standing.competitorId) ?? [];
      current.push({ ...standing, eventIndex });
      seasonEvents.set(standing.competitorId, current);
    }
  }

  const competitorsForSeason: SeasonCompetitor[] = competitors.map((competitor) => ({
    competitorId: competitor.id,
    events: seasonEvents.get(competitor.id) ?? [],
    fallbackDraw: mulberry32(hashSeed(`${config.seed}:s${season}:${tier}:${competitor.id}:fallback`))(),
  }));
  const standings = rankSeason(competitorsForSeason);
  return {
    standings,
    eventWinners,
    humanEvents: new Map(
      humans.map((profile) => [profile.competitorId, seasonEvents.get(profile.competitorId) ?? []]),
    ),
    movement: movementForSeason(standings, tier, config.movementRate ?? BASELINE_MOVEMENT_RATE),
  };
}

function blankSourceCounts(): Record<ChampionshipSource, number> {
  return {
    "pro-top-six": 0,
    "pro-event-winner": 0,
    "pro-passdown": 0,
    "challenger-top-two": 0,
    "elite-bot": 0,
  };
}

function championshipWinner(
  field: ReturnType<typeof championshipField>,
  careers: SimulatedCareer[],
  scoreBank: ScoreBank,
  seed: string,
  season: number,
): string | null {
  if (field.length === 0) return null;
  const humanById = new Map(careers.map((career) => [career.competitorId, career]));
  const scored = field.map((qualifier) => {
    const human = humanById.get(qualifier.competitorId);
    const tendency = human?.tendency
      ?? TENDENCIES[hashSeed(`${seed}:championship:${season}:${qualifier.competitorId}:tendency`) % TENDENCIES.length];
    const archetype: CareerArchetype = human
      ? { ability: human.ability, tendency }
      : { ability: "ace", tendency };
    return {
      competitorId: qualifier.competitorId,
      score: sampleScore(
        scoreBank,
        archetype,
        `${seed}:championship:${season}:${qualifier.competitorId}`,
      ),
      fallback: mulberry32(
        hashSeed(`${seed}:championship:${season}:${qualifier.competitorId}:fallback`),
      )(),
    };
  });
  scored.sort((a, b) =>
    a.score - b.score
    || a.fallback - b.fallback
    || a.competitorId.localeCompare(b.competitorId));
  return scored[0]?.competitorId ?? null;
}

export function simulateCareerWorld(config: CareerSimulatorConfig): CareerSimulation {
  const careers = createCareers(config);
  const tierSnapshots: TierSeasonSnapshot[] = [];
  const championships: ChampionshipSnapshot[] = [];

  for (let season = 1; season <= config.seasons; season++) {
    const cohortResults = new Map<CareerTier, CohortResult>();
    for (const tier of ["local", "challenger", "pro"] as const) {
      const humans = careers.filter((profile) => profile.tier === tier);
      if (humans.length === 0) continue;
      const cohort = simulateCohort(config, season, tier, humans);
      cohortResults.set(tier, cohort);
      tierSnapshots.push({
        season,
        tier,
        humanCount: humans.length,
        fieldSize: cohort.standings.length,
        activeCount: cohort.movement.activeCount,
        baseMovementSlots: cohort.movement.baseSlots,
        promoted: cohort.movement.promoted,
        relegated: cohort.movement.relegated,
        promotionTieExpansion: cohort.movement.promotionTieExpansion,
        relegationTieExpansion: cohort.movement.relegationTieExpansion,
      });
    }

    const proposedMovement = new Map<string, MovementAction>();
    const nextRollingHistory = new Map<string, number[]>();
    const heldByHumanCap = new Set<string>();
    for (const tier of ["local", "challenger", "pro"] as const) {
      const cohort = cohortResults.get(tier);
      if (!cohort) continue;
      const humans = careers.filter((profile) => profile.tier === tier);
      const activeStandings = cohort.standings.filter((entry) => entry.active);
      for (const profile of humans) {
        const standing = cohort.standings.find((entry) => entry.competitorId === profile.competitorId);
        if (!standing?.active) {
          proposedMovement.set(profile.competitorId, "inactive");
          continue;
        }
        if ((config.promotionModel ?? "slot") === "rolling") {
          const activeRank = activeStandings.findIndex((entry) => entry.competitorId === profile.competitorId) + 1;
          const rolling = rollingMovementForSeason(
            profile.rollingPercentiles ?? [],
            activeSeasonPercentile(activeStandings.length, activeRank),
            tier,
            {
              window: config.rollingWindow ?? ROLLING_DEFAULTS.window,
              promoteThreshold: config.rollingPromoteThreshold ?? ROLLING_DEFAULTS.promoteThreshold,
              relegateThreshold: config.rollingRelegateThreshold ?? ROLLING_DEFAULTS.relegateThreshold,
              minEntries: config.rollingMinEntries ?? ROLLING_DEFAULTS.minEntries,
              promotionFloor: config.rollingPromotionFloor,
              relegationCeiling: config.rollingRelegationCeiling,
            },
          );
          proposedMovement.set(profile.competitorId, rolling.action);
          nextRollingHistory.set(profile.competitorId, rolling.history);
        } else {
          proposedMovement.set(
            profile.competitorId,
            cohort.movement.actions.get(profile.competitorId) ?? "hold",
          );
        }
      }
      const activeHumanCount = humans.reduce(
        (count, profile) => count + (proposedMovement.get(profile.competitorId) === "inactive" ? 0 : 1),
        0,
      );
      const configuredLimitModel = config.humanMovementLimitModel
        ?? (config.humanMovementCap != null ? "fixed" : "none");
      const movementLimit = humanMovementLimit(activeHumanCount, {
        model: configuredLimitModel,
        fixedCap: config.humanMovementCap,
        min: config.humanMovementLimitMin,
        scale: config.humanMovementLimitScale,
        max: config.humanMovementLimitMax,
      });
      if (movementLimit != null) {
        const bounded = boundHumanMovement(
          cohort.standings,
          new Map(humans.map((profile) => [
            profile.competitorId,
            proposedMovement.get(profile.competitorId) ?? "inactive",
          ])),
          movementLimit,
        );
        for (const [competitorId, action] of bounded.actions) proposedMovement.set(competitorId, action);
        for (const competitorId of bounded.heldByCap) heldByHumanCap.add(competitorId);
      }
    }

    for (const profile of careers) {
      const tier = profile.tier;
      const cohort = cohortResults.get(tier);
      if (!cohort) continue;
      const standing = cohort.standings.find((entry) => entry.competitorId === profile.competitorId);
      if (!standing) throw new Error(`Missing standing for ${profile.competitorId}`);
      const activeStandings = cohort.standings.filter((entry) => entry.active);
      const activeRank = standing.active
        ? activeStandings.findIndex((entry) => entry.competitorId === profile.competitorId) + 1
        : null;
      // The raw slot outcome from the standings; `movement` below is the ACTUAL
      // applied action recorded in history so every downstream metric stays
      // consistent with the tier the profile really moves to.
      const slot = proposedMovement.get(profile.competitorId) ?? "inactive";
      let movement: MovementAction = slot;
      let movementState: CareerSeasonRecord["movementState"];
      let nextTier = tier;
      if (standing.active) {
        profile.consecutiveInactiveSeasons = 0;
        if ((config.promotionModel ?? "slot") === "rolling") {
          profile.rollingPercentiles = nextRollingHistory.get(profile.competitorId) ?? profile.rollingPercentiles ?? [];
        }
        const confirmation = config.movementConfirmation
          ?? (config.requireRepeatQualification ? "promotion-only" : "none");
        const confirmed = confirmMovementSlot(
          slot,
          confirmation,
          profile.consecutiveQualifyingSeasons,
          profile.consecutiveRelegatingSeasons,
        );
        profile.consecutiveQualifyingSeasons = confirmed.consecutiveQualifyingSeasons;
        profile.consecutiveRelegatingSeasons = confirmed.consecutiveRelegatingSeasons;
        movement = confirmed.action;
        if (
          confirmation === "relegation-protection"
          && slot === "relegate"
          && movement === "hold"
        ) {
          movementState = "relegation-warning";
        } else if (heldByHumanCap.has(profile.competitorId)) {
          movementState = "movement-cap";
        }
        if (movement === "promote") {
          nextTier = promoteTier(tier);
        } else if (movement === "relegate") {
          nextTier = relegateTier(tier);
        }
        if (nextTier !== tier && profile.rollingPercentiles) {
          profile.rollingPercentiles = movement === "promote"
            ? rollingHistoryAfterPromotion(
              profile.rollingPercentiles,
              config.rollingPromotionCarryWeight,
            )
            : [];
        }
      } else {
        profile.consecutiveQualifyingSeasons = 0;
        profile.consecutiveRelegatingSeasons = 0;
        const inactivity = applyInactivity(tier, profile.consecutiveInactiveSeasons, false);
        nextTier = inactivity.tier;
        profile.consecutiveInactiveSeasons = inactivity.consecutiveInactiveSeasons;
        if (nextTier !== tier && profile.rollingPercentiles) profile.rollingPercentiles = [];
      }
      const rating = activeRank == null
        ? 0
        : seasonRating(
          activeStandings.length,
          activeRank,
          tier,
          config.tierMultipliers ?? BASELINE_TIER_MULTIPLIER,
        );
      const humanEvents = cohort.humanEvents.get(profile.competitorId) ?? [];
      profile.legacyAwards.eventCompletion += humanEvents.filter((event) => event.completed).length;
      profile.legacyAwards.eventTopFive += humanEvents.filter(
        (event) => event.completed && event.rank != null && event.rank <= 5,
      ).length;
      profile.legacyAwards.eventWin += humanEvents.filter(
        (event) => event.completed && event.rank === 1,
      ).length;
      if (standing.active) profile.legacyAwards.activeSeasonCompletion++;
      if (movement === "promote") profile.legacyAwards.promotion++;
      if (tier === "pro" && standing.active && nextTier === "pro") {
        profile.legacyAwards.proSurvival++;
      }
      if (standing.active && activeRank === 1) profile.legacyAwards.seasonChampionship++;
      profile.ratingHistory.push({ rating, active: standing.active });
      profile.histories.push({
        season,
        tier,
        nextTier,
        active: standing.active,
        completedEvents: standing.completedEvents,
        rank: activeRank,
        activeFieldSize: activeStandings.length,
        seasonPoints: standing.seasonPoints,
        rating,
        tourRating: tourRating(profile.ratingHistory),
        movement,
        ...(movementState ? { movementState } : {}),
      });
      profile.tier = nextTier;
      if (nextTier === "pro" && profile.firstProSeason == null) profile.firstProSeason = season + 1;
    }

    if (season % 4 === 0) {
      const pro = cohortResults.get("pro");
      const challenger = cohortResults.get("challenger");
      const field = championshipField(
        pro?.standings.map((standing) => standing.competitorId) ?? [],
        pro?.eventWinners ?? [],
        challenger?.standings.map((standing) => standing.competitorId) ?? [],
        Array.from({ length: 20 }, (_, index) => `elite:${season}:${index}`),
        20,
      );
      const qualifiersBySource = blankSourceCounts();
      const humanQualifiersBySource = blankSourceCounts();
      const humanQualifierIds: string[] = [];
      for (const qualifier of field) {
        qualifiersBySource[qualifier.source]++;
        if (qualifier.competitorId.startsWith("human-")) {
          humanQualifiersBySource[qualifier.source]++;
          humanQualifierIds.push(qualifier.competitorId);
          const profile = careers.find((career) => career.competitorId === qualifier.competitorId);
          if (profile) profile.legacyAwards.championshipQualification++;
        }
      }
      const winnerId = championshipWinner(field, careers, config.scoreBank, config.seed, season);
      const humanWinner = careers.find((career) => career.competitorId === winnerId);
      if (humanWinner) humanWinner.legacyAwards.championshipWin++;
      championships.push({
        season,
        qualifiersBySource,
        humanQualifiersBySource,
        humanQualifierIds,
        winnerId,
        fieldSize: field.length,
      });
    }
  }

  return {
    config: {
      seed: config.seed,
      fieldSize: config.fieldSize,
      humanRatio: config.humanRatio,
      seasons: config.seasons,
      movementRate: config.movementRate,
      tierMultipliers: config.tierMultipliers,
      requireRepeatQualification: config.requireRepeatQualification,
      botFieldModel: config.botFieldModel,
      tierBotMix: config.tierBotMix,
      movementConfirmation: config.movementConfirmation,
      promotionModel: config.promotionModel,
      rollingWindow: config.rollingWindow,
      rollingPromoteThreshold: config.rollingPromoteThreshold,
      rollingRelegateThreshold: config.rollingRelegateThreshold,
      rollingMinEntries: config.rollingMinEntries,
      rollingPromotionFloor: config.rollingPromotionFloor,
      rollingRelegationCeiling: config.rollingRelegationCeiling,
      rollingPromotionCarryWeight: config.rollingPromotionCarryWeight,
      humanMovementCap: config.humanMovementCap,
      humanMovementLimitModel: config.humanMovementLimitModel,
      humanMovementLimitMin: config.humanMovementLimitMin,
      humanMovementLimitScale: config.humanMovementLimitScale,
      humanMovementLimitMax: config.humanMovementLimitMax,
      bankSeed: config.scoreBank.seed,
    },
    careers,
    tierSnapshots,
    championships,
  };
}
