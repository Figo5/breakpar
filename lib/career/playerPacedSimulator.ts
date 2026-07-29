/**
 * Long-horizon simulator for the exact player-paced Career progression model.
 *
 * Human cards use the same four rank modifiers as production. Bots continue to
 * use the immutable tier-scaled roster and the same real-engine score bank.
 * There is no database, clock, route, or UI dependency.
 */
import { COURSES } from "@/data/courses";
import { hashSeed } from "@/lib/engine/rng";

import {
  assignCareerBotSlots,
  generateCareerBotRoster,
  type CareerBotIdentity,
} from "./botRoster";
import { championshipUnlock } from "./championship";
import {
  rankChampionshipField,
  type ChampionshipSettlementCompetitor,
} from "./championshipSettlement";
import {
  CAREER_CURRENT_FORMULA_BUNDLE,
  type CareerFormulaBundle,
} from "./formulaBundle";
import {
  CAREER_INITIAL_SKILL_RANKS,
  CAREER_MAX_SKILL_RANK,
  CAREER_SKILLS,
  careerDevelopmentAward,
  careerSkillKey,
  careerSkillUpgradeCost,
  requireCareerSkillRanks,
  type CareerSkillRanks,
} from "./development";
import {
  blankLegacyAwardCounts,
  legacyPoints,
  promoteTier,
  rankEvent,
  rankSeason,
  relegateTier,
  seasonRating,
  tourRating,
  type CareerTier,
  type LegacyAwardCounts,
  type MovementAction,
  type RatingSeason,
  type SeasonCompetitor,
  type SeasonEventResult,
} from "./rules";
import {
  ABILITY_BANDS,
  TENDENCIES,
  activeSeasonPercentile,
  rollingHistoryAfterPromotion,
  rollingMovementForSeason,
  simulateArchetypeRound,
  type AbilityBand,
  type AbilityModel,
  type CareerArchetype,
  type CareerErrorRates,
  type ScoreBank,
  type Tendency,
} from "./simulator";

// This is a release gate, so it must follow the package new Career seasons
// actually pin. Historical packages remain reproducible from their frozen code
// and stored snapshots; silently testing the previous package here is unsafe.
const FORMULA = CAREER_CURRENT_FORMULA_BUNDLE;
const FIELD_SIZE = FORMULA.championship.fieldSize;
const EVENTS_PER_SEASON = FORMULA.eventPoints.scheduledEvents;

export interface CareerSkillScoreBank {
  readonly seed: string;
  readonly formulaVersion: string;
  readonly samplesPerArchetype: number;
  readonly base: ScoreBank;
  readonly skillScores: ReadonlyMap<string, readonly number[]>;
  readonly skillMeans: ReadonlyMap<string, number>;
  readonly rankVectors: readonly CareerSkillRanks[];
}

function skillBankKey(
  archetype: CareerArchetype,
  ranks: CareerSkillRanks,
): string {
  return `${archetype.ability}:${archetype.tendency}|${careerSkillKey(ranks)}`;
}

/**
 * The deterministic balanced allocation path used for calibration. Production
 * leaves allocation to the player; this path prevents the simulator from
 * quietly choosing the strongest single-stat build.
 */
export function balancedCareerSkillPath(): readonly CareerSkillRanks[] {
  const path: CareerSkillRanks[] = [{ ...CAREER_INITIAL_SKILL_RANKS }];
  const ranks = { ...CAREER_INITIAL_SKILL_RANKS };
  for (let target = 2; target <= CAREER_MAX_SKILL_RANK; target++) {
    for (const skill of CAREER_SKILLS) {
      ranks[skill] = target;
      path.push({ ...ranks });
    }
  }
  return path;
}

export function autoAllocateCareerSkills(
  current: CareerSkillRanks,
  availablePoints: number,
): {
  readonly ranks: CareerSkillRanks;
  readonly pointsRemaining: number;
  readonly pointsSpent: number;
} {
  const ranks = { ...requireCareerSkillRanks(current) };
  let pointsRemaining = Math.max(0, Math.floor(availablePoints));
  let pointsSpent = 0;
  while (true) {
    const skill = CAREER_SKILLS
      .filter((candidate) => ranks[candidate] < CAREER_MAX_SKILL_RANK)
      .sort((left, right) =>
        ranks[left] - ranks[right]
        || CAREER_SKILLS.indexOf(left) - CAREER_SKILLS.indexOf(right))
      .find((candidate) => {
        const cost = careerSkillUpgradeCost(ranks[candidate]);
        return cost != null && cost <= pointsRemaining;
      });
    if (!skill) break;
    const cost = careerSkillUpgradeCost(ranks[skill])!;
    ranks[skill]++;
    pointsRemaining -= cost;
    pointsSpent += cost;
  }
  return { ranks, pointsRemaining, pointsSpent };
}

/** Build common-random-number score banks from the production engine. */
export function buildCareerSkillScoreBank(
  seed: string,
  samplesPerArchetype = 128,
  model: AbilityModel = FORMULA.ability.model,
  errorRates: CareerErrorRates = { ...FORMULA.ability.errorRates },
): CareerSkillScoreBank {
  if (!Number.isSafeInteger(samplesPerArchetype) || samplesPerArchetype < 1) {
    throw new TypeError("Career skill score-bank samples must be a positive safe integer");
  }
  const baseScores = new Map<string, number[]>();
  const baseMeans = new Map<string, number>();
  for (const ability of ABILITY_BANDS) {
    for (const tendency of TENDENCIES) {
      const archetype = { ability, tendency };
      const values = Array.from({ length: samplesPerArchetype }, (_, sample) => {
        // Stratify by course so a finite calibration bank cannot become
        // materially easier or harder merely because its seed over-sampled a
        // particular course. Outcome streams remain seeded and deterministic.
        const sampleSeed = `${seed}:sample:${sample}`;
        const course = COURSES[sample % COURSES.length];
        return simulateArchetypeRound(
          sampleSeed,
          course,
          archetype,
          model,
          errorRates,
          FORMULA.gameplayRulesetVersion,
        );
      });
      const key = `${ability}:${tendency}`;
      baseScores.set(key, values);
      baseMeans.set(key, values.reduce((sum, value) => sum + value, 0) / values.length);
    }
  }
  const base: ScoreBank = {
    seed,
    samplesPerArchetype,
    scores: baseScores,
    means: baseMeans,
    model,
    ...(model === "error" ? { errorRates: { ...errorRates } } : {}),
  };
  const rankVectors = balancedCareerSkillPath();
  const skillScores = new Map<string, readonly number[]>();
  const skillMeans = new Map<string, number>();
  for (const ability of ABILITY_BANDS) {
    for (const tendency of TENDENCIES) {
      const archetype = { ability, tendency };
      for (const ranks of rankVectors) {
        const key = skillBankKey(archetype, ranks);
        const isNeutral = careerSkillKey(ranks)
          === careerSkillKey(CAREER_INITIAL_SKILL_RANKS);
        const values = isNeutral
          ? [...(base.scores.get(`${ability}:${tendency}`) ?? [])]
          : Array.from({ length: samplesPerArchetype }, (_, sample) => {
            const sampleSeed = `${seed}:sample:${sample}`;
            const course = COURSES[sample % COURSES.length];
            return simulateArchetypeRound(
              sampleSeed,
              course,
              archetype,
              model,
              errorRates,
              FORMULA.gameplayRulesetVersion,
              ranks,
            );
          });
        if (!values.length) {
          throw new Error(`Career skill score bank is missing neutral ${key}`);
        }
        skillScores.set(key, values);
        skillMeans.set(
          key,
          values.reduce((sum, value) => sum + value, 0) / values.length,
        );
      }
    }
  }
  return {
    seed,
    formulaVersion: FORMULA.id,
    samplesPerArchetype,
    base,
    skillScores,
    skillMeans,
    rankVectors,
  };
}

export interface PlayerPacedCareerConfig {
  readonly seed: string;
  readonly seasons: number;
  readonly ability: AbilityBand;
  readonly tendency?: Tendency;
  readonly scoreBank: CareerSkillScoreBank;
  /** Unplayed Championships remain available in the product. Calibration
   * defaults to playing each one immediately to exercise its Legacy curve. */
  readonly playChampionships?: boolean;
  /** Calibration-only override. Production omits this and reads the immutable
   * formula package pinned to the season. */
  readonly movementThresholds?: Readonly<Record<CareerTier, {
    readonly promoteThreshold: number;
    readonly promotionFloor: number;
    readonly relegateThreshold: number;
  }>>;
}

export interface PlayerPacedSeasonRecord {
  readonly season: number;
  readonly tier: CareerTier;
  readonly nextTier: CareerTier;
  readonly rank: number;
  readonly percentile: number;
  readonly movement: MovementAction;
  readonly seasonRating: number;
  readonly tourRating: number;
  readonly legacyEarned: number;
  readonly legacyTotal: number;
  readonly championshipQualified: boolean;
  readonly championshipWon: boolean;
  /** Unspent points after deterministic balanced allocation. */
  readonly developmentPoints: number;
  readonly developmentEarned: number;
  readonly developmentSpent: number;
  readonly foundationPointsEarned: number;
  /** Ranks available for the next season (and an immediately played Championship). */
  readonly skills: CareerSkillRanks;
}

export interface PlayerPacedCareerSimulation {
  readonly seed: string;
  readonly formulaVersion: string;
  readonly ability: AbilityBand;
  readonly tendency: Tendency;
  readonly histories: readonly PlayerPacedSeasonRecord[];
  readonly firstProSeason: number | null;
  readonly firstChampionshipSeason: number | null;
  readonly relegations: number;
  readonly proSeasons: number;
  readonly proSeasonsSurvived: number;
}

interface CompetitorArchetype {
  readonly competitorId: string;
  readonly archetype: CareerArchetype;
  readonly skills?: CareerSkillRanks;
}

function sampleScore(
  bank: CareerSkillScoreBank,
  competitor: CompetitorArchetype,
  namespace: string,
): number {
  const values = competitor.skills
    ? bank.skillScores.get(skillBankKey(competitor.archetype, competitor.skills))
    : bank.base.scores.get(
      `${competitor.archetype.ability}:${competitor.archetype.tendency}`,
    );
  if (!values?.length) {
    throw new Error(
      `Player-paced simulator score bank is missing ${competitor.archetype.ability}:`
      + `${competitor.archetype.tendency}${competitor.skills ? ` ${careerSkillKey(competitor.skills)}` : ""}`,
    );
  }
  return values[hashSeed(`${bank.seed}:${namespace}`) % values.length];
}

function fallbackDraw(namespace: string): number {
  return hashSeed(namespace);
}

function dbTier(tier: CareerTier): "LOCAL" | "CHALLENGER" | "PRO" {
  return tier.toUpperCase() as "LOCAL" | "CHALLENGER" | "PRO";
}

function seasonField(
  seed: string,
  season: number,
  tier: CareerTier,
  human: CareerArchetype,
  skills: CareerSkillRanks,
  roster: readonly CareerBotIdentity[],
): readonly CompetitorArchetype[] {
  const worldKey = `simulation:${seed}`;
  const assignments = assignCareerBotSlots({
    worldKey,
    seasonNumber: season,
    tier,
    eventNumber: 1,
    slots: Array.from({ length: FIELD_SIZE - 1 }, (_, index) => ({
      slotId: index + 2,
      slotIndex: index,
    })),
    roster,
  });
  return [
    { competitorId: "human:player", archetype: human, skills },
    ...assignments.map((assignment) => ({
      competitorId: `bot:${assignment.identity.botKey}`,
      archetype: {
        ability: assignment.abilityBand,
        tendency: assignment.tendency,
      },
    })),
  ];
}

function simulateSeasonEvents(
  seed: string,
  season: number,
  tier: CareerTier,
  field: readonly CompetitorArchetype[],
  bank: CareerSkillScoreBank,
): Map<string, SeasonEventResult[]> {
  const eventsByCompetitor = new Map<string, SeasonEventResult[]>(
    field.map((competitor) => [competitor.competitorId, []]),
  );
  for (let eventIndex = 0; eventIndex < EVENTS_PER_SEASON; eventIndex++) {
    const standings = rankEvent(field.map((competitor) => ({
      competitorId: competitor.competitorId,
      relativeToPar: Array.from({ length: 4 }, (_, roundIndex) =>
        sampleScore(
          bank,
          competitor,
          `${seed}:season:${season}:${tier}:event:${eventIndex}`
          + `:round:${roundIndex}:${competitor.competitorId}`,
        )).reduce((sum, score) => sum + score, 0),
    })));
    for (const standing of standings) {
      eventsByCompetitor.get(standing.competitorId)!.push({
        ...standing,
        eventIndex,
      });
    }
  }
  return eventsByCompetitor;
}

function regularSeasonLegacy(
  humanEvents: readonly SeasonEventResult[],
  movement: MovementAction,
  tier: CareerTier,
  isSeasonChampion: boolean,
  championshipQualified: boolean,
): LegacyAwardCounts {
  const awards = blankLegacyAwardCounts();
  awards.eventCompletion = humanEvents.filter((event) => event.completed).length;
  awards.eventTopFive = humanEvents.filter(
    (event) => event.completed && event.rank != null && event.rank <= 5,
  ).length;
  awards.eventWin = humanEvents.filter(
    (event) => event.completed && event.rank === 1,
  ).length;
  awards.activeSeasonCompletion = 1;
  if (movement === "promote") awards.promotion = 1;
  if (tier === "pro" && movement !== "relegate") awards.proSurvival = 1;
  if (isSeasonChampion) awards.seasonChampionship = 1;
  if (championshipQualified) awards.championshipQualification = 1;
  return awards;
}

function simulateChampionshipWin(
  seed: string,
  cycleNumber: number,
  human: CareerArchetype,
  skills: CareerSkillRanks,
  roster: readonly CareerBotIdentity[],
  bank: CareerSkillScoreBank,
): boolean {
  const competitors: ChampionshipSettlementCompetitor[] = [
    {
      slotNumber: 1,
      competitorId: "human:player",
      competitorType: "HUMAN",
      profileId: "player",
      botIdentityId: null,
      relativeToPar: sampleScore(
        bank,
        { competitorId: "human:player", archetype: human, skills },
        `${seed}:championship:${cycleNumber}:human`,
      ),
      fallbackDraw: fallbackDraw(`${seed}:championship:${cycleNumber}:human:fallback`),
    },
    ...roster.slice(0, FIELD_SIZE - 1).map((identity, index) => ({
      slotNumber: index + 2,
      competitorId: `bot:${identity.botKey}`,
      competitorType: "BOT" as const,
      profileId: null,
      botIdentityId: identity.botKey,
      relativeToPar: sampleScore(
        bank,
        {
          competitorId: `bot:${identity.botKey}`,
          archetype: { ability: "ace", tendency: identity.tendency },
        },
        `${seed}:championship:${cycleNumber}:bot:${identity.botKey}`,
      ),
      fallbackDraw: fallbackDraw(
        `${seed}:championship:${cycleNumber}:bot:${identity.botKey}:fallback`,
      ),
    })),
  ];
  return rankChampionshipField(
    `simulation:${seed}:championship:${cycleNumber}`,
    competitors,
    FORMULA.id,
  ).winnerCompetitorId === "human:player";
}

function movementOptions(
  formula: CareerFormulaBundle,
  tier: CareerTier,
  override?: PlayerPacedCareerConfig["movementThresholds"],
) {
  const thresholds = override?.[tier] ?? formula.movement.tierThresholds?.[tier];
  return {
    window: formula.movement.rollingWindow,
    minEntries: formula.movement.rollingMinEntries,
    promoteThreshold: thresholds?.promoteThreshold
      ?? formula.movement.rollingPromoteThreshold,
    promotionFloor: thresholds?.promotionFloor
      ?? formula.movement.rollingPromotionFloor,
    relegateThreshold: thresholds?.relegateThreshold
      ?? formula.movement.rollingRelegateThreshold,
  };
}

export function simulatePlayerPacedCareer(
  config: PlayerPacedCareerConfig,
): PlayerPacedCareerSimulation {
  if (!Number.isSafeInteger(config.seasons) || config.seasons < 1) {
    throw new TypeError("Player-paced simulation seasons must be a positive safe integer");
  }
  if (
    config.scoreBank.formulaVersion !== FORMULA.id
    || config.scoreBank.base.model !== FORMULA.ability.model
    || JSON.stringify(config.scoreBank.base.errorRates)
      !== JSON.stringify(FORMULA.ability.errorRates)
  ) {
    throw new Error(
      `Player-paced simulation requires a ${FORMULA.id} real-engine score bank`,
    );
  }

  const tendency = config.tendency ?? "balanced";
  const roster = generateCareerBotRoster(`simulation:${config.seed}`);
  const histories: PlayerPacedSeasonRecord[] = [];
  const ratingHistory: RatingSeason[] = [];
  let tier: CareerTier = "local";
  let movementEvidence: number[] = [];
  let legacyTotal = 0;
  let firstProSeason: number | null = null;
  let firstChampionshipSeason: number | null = null;
  let relegations = 0;
  let proSeasons = 0;
  let proSeasonsSurvived = 0;
  let developmentPoints = 0;
  let developmentEarned = 0;
  let developmentSpent = 0;
  let foundationPointsEarned = 0;
  let skills: CareerSkillRanks = { ...CAREER_INITIAL_SKILL_RANKS };

  for (let season = 1; season <= config.seasons; season++) {
    const human: CareerArchetype = { ability: config.ability, tendency };
    const field = seasonField(config.seed, season, tier, human, skills, roster);
    const eventsByCompetitor = simulateSeasonEvents(
      config.seed,
      season,
      tier,
      field,
      config.scoreBank,
    );
    const standings = rankSeason(field.map((competitor): SeasonCompetitor => ({
      competitorId: competitor.competitorId,
      events: eventsByCompetitor.get(competitor.competitorId)!,
      fallbackDraw: fallbackDraw(
        `${config.seed}:season:${season}:${tier}:${competitor.competitorId}:fallback`,
      ),
    })));
    const humanRank = standings.findIndex(
      (standing) => standing.competitorId === "human:player",
    ) + 1;
    const percentile = activeSeasonPercentile(standings.length, humanRank);
    const rolling = rollingMovementForSeason(
      movementEvidence,
      percentile,
      tier,
      movementOptions(FORMULA, tier, config.movementThresholds),
    );
    const movement = rolling.action;
    let nextTier: CareerTier = tier;
    if (movement === "promote") nextTier = promoteTier(tier);
    if (movement === "relegate") nextTier = relegateTier(tier);
    movementEvidence = rolling.history;
    if (nextTier !== tier) {
      movementEvidence = movement === "promote"
        ? rollingHistoryAfterPromotion(
          movementEvidence,
          FORMULA.movement.rollingPromotionCarryWeight,
        )
        : [];
    }

    const rating = seasonRating(
      standings.length,
      humanRank,
      tier,
      FORMULA.tourRating.tierMultipliers,
    );
    ratingHistory.push({ rating, active: true });
    const currentTourRating = tourRating(ratingHistory);

    const award = careerDevelopmentAward(percentile, foundationPointsEarned);
    foundationPointsEarned += award.foundation;
    developmentEarned += award.total;
    developmentPoints += award.total;
    const allocation = autoAllocateCareerSkills(skills, developmentPoints);
    skills = allocation.ranks;
    developmentPoints = allocation.pointsRemaining;
    developmentSpent += allocation.pointsSpent;

    const unlock = championshipUnlock(season, dbTier(nextTier));
    const championshipQualified = unlock.unlocked;
    const championshipWon = Boolean(
      championshipQualified
      && (config.playChampionships ?? true)
      && simulateChampionshipWin(
        config.seed,
        unlock.cycleNumber!,
        human,
        skills,
        roster,
        config.scoreBank,
      ),
    );
    const humanEvents = eventsByCompetitor.get("human:player")!;
    const awards = regularSeasonLegacy(
      humanEvents,
      movement,
      tier,
      standings[0]?.competitorId === "human:player",
      championshipQualified,
    );
    if (championshipWon) awards.championshipWin = 1;
    const legacyEarned = legacyPoints(awards, FORMULA.legacyPoints);
    legacyTotal += legacyEarned;

    if (movement === "relegate") relegations++;
    if (tier === "pro") {
      proSeasons++;
      if (nextTier === "pro") proSeasonsSurvived++;
    }
    if (firstProSeason == null && nextTier === "pro") firstProSeason = season + 1;
    if (firstChampionshipSeason == null && championshipQualified) {
      firstChampionshipSeason = season;
    }
    histories.push({
      season,
      tier,
      nextTier,
      rank: humanRank,
      percentile,
      movement,
      seasonRating: rating,
      tourRating: currentTourRating,
      legacyEarned,
      legacyTotal,
      championshipQualified,
      championshipWon,
      developmentPoints,
      developmentEarned,
      developmentSpent,
      foundationPointsEarned,
      skills: { ...skills },
    });
    tier = nextTier;
  }

  return {
    seed: config.seed,
    formulaVersion: FORMULA.id,
    ability: config.ability,
    tendency,
    histories,
    firstProSeason,
    firstChampionshipSeason,
    relegations,
    proSeasons,
    proSeasonsSurvived,
  };
}
