import type {
  GreenResult,
  PuttResult,
  ScrambleResult,
} from "@/lib/engine/putting";
import type { Lie } from "@/lib/engine/shots";

export const CAREER_SKILLS = [
  "driving",
  "approach",
  "shortGame",
  "putting",
] as const;

export type CareerSkill = typeof CAREER_SKILLS[number];

export interface CareerSkillRanks {
  readonly driving: number;
  readonly approach: number;
  readonly shortGame: number;
  readonly putting: number;
}

export const CAREER_INITIAL_SKILL_RANK = 1;
export const CAREER_MAX_SKILL_RANK = 5;
export const CAREER_FOUNDATION_POINT_CAP = 4;

export const CAREER_INITIAL_SKILL_RANKS: CareerSkillRanks = Object.freeze({
  driving: CAREER_INITIAL_SKILL_RANK,
  approach: CAREER_INITIAL_SKILL_RANK,
  shortGame: CAREER_INITIAL_SKILL_RANK,
  putting: CAREER_INITIAL_SKILL_RANK,
});

export const CAREER_SKILL_LABELS: Readonly<Record<CareerSkill, string>> = {
  driving: "Driving",
  approach: "Approach",
  shortGame: "Short Game",
  putting: "Putting",
};

export const CAREER_SKILL_EFFECT_COPY: Readonly<Record<CareerSkill, string>> = {
  driving: "More short grass and fewer trouble lies from the tee.",
  approach: "More quality birdie looks and fewer missed greens.",
  shortGame: "More up-and-downs with fewer costly recovery mistakes.",
  putting: "More one-putts and fewer three-putts.",
};

/**
 * Exact, immutable per-rank probability multipliers for Career v4.
 *
 * Rank 1 is neutral. Each additional rank applies one restrained step to the
 * real stage weights. The engine still normalizes the complete table and rolls
 * the same seeded outcome, so a rank never guarantees a result or subtracts a
 * stroke directly.
 */
export const CAREER_SKILL_STEP = Object.freeze({
  driving: {
    dialed: 0.03,
    fairway: 0.015,
    rough: -0.015,
    trouble: -0.04,
  } satisfies Record<Lie, number>,
  approach: {
    kickin: 0.025,
    makeable: 0.02,
    lag: -0.015,
    scramble: -0.035,
  } satisfies Record<GreenResult, number>,
  shortGame: {
    updown: 0.035,
    twochip: 0,
    blowup: -0.05,
    disaster: -0.07,
  } satisfies Record<ScrambleResult, number>,
  putting: {
    oneputt: 0.035,
    twoputt: 0,
    threeputt: -0.06,
  } satisfies Record<PuttResult, number>,
});

function validRank(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= CAREER_INITIAL_SKILL_RANK
    && (value as number) <= CAREER_MAX_SKILL_RANK;
}

export function isCareerSkill(value: unknown): value is CareerSkill {
  return typeof value === "string"
    && (CAREER_SKILLS as readonly string[]).includes(value);
}

export function isCareerSkillRanks(value: unknown): value is CareerSkillRanks {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return CAREER_SKILLS.every((skill) => validRank(candidate[skill]));
}

export function requireCareerSkillRanks(value: unknown): CareerSkillRanks {
  if (!isCareerSkillRanks(value)) {
    throw new TypeError("Career skill snapshot is invalid");
  }
  return {
    driving: value.driving,
    approach: value.approach,
    shortGame: value.shortGame,
    putting: value.putting,
  };
}

export function careerSkillKey(ranks: CareerSkillRanks): string {
  return CAREER_SKILLS.map((skill) => `${skill}:${ranks[skill]}`).join("|");
}

function applyRankStep<T extends string>(
  weights: Record<T, number>,
  rank: number,
  steps: Record<T, number>,
): Record<T, number> {
  const boundedRank = Math.max(
    CAREER_INITIAL_SKILL_RANK,
    Math.min(CAREER_MAX_SKILL_RANK, Math.floor(rank)),
  );
  const stepCount = boundedRank - CAREER_INITIAL_SKILL_RANK;
  if (stepCount === 0) return weights;
  const adjusted = { ...weights };
  for (const key of Object.keys(adjusted) as T[]) {
    adjusted[key] *= Math.max(0, 1 + steps[key] * stepCount);
  }
  return adjusted;
}

export function applyCareerDrivingRank(
  weights: Record<Lie, number>,
  rank: number,
): Record<Lie, number> {
  return applyRankStep(weights, rank, CAREER_SKILL_STEP.driving);
}

export function applyCareerApproachRank(
  weights: Record<GreenResult, number>,
  rank: number,
): Record<GreenResult, number> {
  return applyRankStep(weights, rank, CAREER_SKILL_STEP.approach);
}

export function applyCareerShortGameRank(
  weights: Record<ScrambleResult, number>,
  rank: number,
): Record<ScrambleResult, number> {
  return applyRankStep(weights, rank, CAREER_SKILL_STEP.shortGame);
}

export function applyCareerPuttingRank(
  weights: Record<PuttResult, number>,
  rank: number,
): Record<PuttResult, number> {
  return applyRankStep(weights, rank, CAREER_SKILL_STEP.putting);
}

/** The cost to move from the current rank to the next rank. */
export function careerSkillUpgradeCost(currentRank: number): number | null {
  if (!validRank(currentRank)) throw new TypeError("Career skill rank is invalid");
  return currentRank >= CAREER_MAX_SKILL_RANK ? null : currentRank;
}

export interface CareerDevelopmentAward {
  readonly foundation: number;
  readonly performance: number;
  readonly total: number;
  readonly reasons: readonly string[];
}

/**
 * A completed season can establish only a four-point foundation. Every point
 * beyond that requires top-half or top-quarter performance, so grinding
 * bottom-half seasons can never maximize the player.
 */
export function careerDevelopmentAward(
  seasonPercentile: number,
  foundationPointsEarned: number,
): CareerDevelopmentAward {
  const percentile = Math.max(0, Math.min(1, seasonPercentile));
  const foundation = foundationPointsEarned < CAREER_FOUNDATION_POINT_CAP ? 1 : 0;
  const topHalf = percentile >= 0.5 ? 1 : 0;
  const topQuarter = percentile >= 0.75 ? 1 : 0;
  const performance = topHalf + topQuarter;
  const reasons = [
    ...(foundation ? ["Season completion foundation"] : []),
    ...(topHalf ? ["Top-half season"] : []),
    ...(topQuarter ? ["Top-quarter season"] : []),
  ];
  return {
    foundation,
    performance,
    total: foundation + performance,
    reasons,
  };
}

export function totalCareerSkillRanks(ranks: CareerSkillRanks): number {
  return CAREER_SKILLS.reduce((sum, skill) => sum + ranks[skill], 0);
}
