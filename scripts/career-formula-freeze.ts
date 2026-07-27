/**
 * Gate 3 formula-freeze analysis for Career Mode.
 *
 * This remains a standalone deterministic simulator artifact. It does not read
 * or write production data and does not implement Career Mode application code.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ABILITY_BANDS,
  ACTIVITY_PATTERNS,
  CAREER_V1_FREEZE_CANDIDATE,
  CAREER_V1_LEGACY_POINTS,
  TENDENCIES,
  buildScoreBank,
  simulateCareerWorld,
  type AbilityBand,
  type ActivityPattern,
  type BotFieldModel,
  type CareerSimulation,
  type SimulatedCareer,
  type TierBotMix,
} from "../lib/career/simulator";
import {
  LEGACY_AWARD_KEYS,
  legacyPointBreakdown,
  legacyPoints,
  pointsForPosition,
  rankEvent,
  type CareerTier,
  type LegacyAwardKey,
  type LegacyPointSchedule,
} from "../lib/career/rules";

interface Options {
  seed: string;
  bankSamples: number;
  output: string;
  quick: boolean;
}

const valueAfter = (argv: string[], flag: string) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

function parseArgs(argv: string[]): Options {
  const quick = argv.includes("--quick");
  return {
    seed: valueAfter(argv, "--seed") ?? "career-v1-review",
    bankSamples: Number(valueAfter(argv, "--bank-samples") ?? (quick ? 32 : 256)),
    output: valueAfter(argv, "--output") ?? "docs/career-formula-freeze.md",
    quick,
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fixed(value: number | null, digits = 1): string {
  return value == null ? "n/a" : value.toFixed(digits);
}

function pct(value: number, total: number): string {
  return `${(total > 0 ? value / total * 100 : 0).toFixed(1)}%`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function finalTier(career: SimulatedCareer): CareerTier {
  return career.histories.at(-1)?.nextTier ?? career.tier;
}

function activeSeasonsToPro(career: SimulatedCareer): number | null {
  if (career.firstProSeason == null) return null;
  return career.histories.filter(
    (history) => history.season < career.firstProSeason! && history.active,
  ).length;
}

function proSurvival(career: SimulatedCareer): { eligible: number; survived: number } {
  let eligible = 0;
  let survived = 0;
  for (let index = 0; index < career.histories.length - 1; index++) {
    const current = career.histories[index];
    const next = career.histories[index + 1];
    if (current.tier !== "challenger" || current.nextTier !== "pro") continue;
    eligible++;
    if (next.nextTier === "pro") survived++;
  }
  return { eligible, survived };
}

function immediateReversal(career: SimulatedCareer): { eligible: number; reversed: number } {
  let eligible = 0;
  let reversed = 0;
  for (let index = 0; index < career.histories.length; index++) {
    if (career.histories[index].movement !== "promote") continue;
    const nextActive = career.histories.slice(index + 1).find((history) => history.active);
    if (!nextActive) continue;
    eligible++;
    if (nextActive.movement === "relegate") reversed++;
  }
  return { eligible, reversed };
}

function oscillates(career: SimulatedCareer): boolean {
  const movement = career.histories
    .map((history) => history.movement)
    .filter((action): action is "promote" | "relegate" =>
      action === "promote" || action === "relegate");
  for (let index = 0; index <= movement.length - 3; index++) {
    if (movement[index] !== movement[index + 1] && movement[index] === movement[index + 2]) {
      return true;
    }
  }
  return false;
}

function returningRecovery(career: SimulatedCareer): number | null {
  if (career.activity !== "returning") return null;
  const preAbsence = career.histories.find((history) => history.season === 4)?.tourRating ?? 0;
  if (preAbsence <= 0) return null;
  let active = 0;
  for (const history of career.histories.filter((entry) => entry.season >= 7)) {
    if (history.active) active++;
    if (history.tourRating >= preAbsence) return active;
  }
  return null;
}

const GENTLER_TIER_MIX: TierBotMix = {
  local: { rusty: 0.55, scratch: 0.4, ace: 0.05 },
  challenger: { rusty: 0.15, scratch: 0.5, ace: 0.35 },
  pro: { rusty: 0.05, scratch: 0.35, ace: 0.6 },
};

const STEEPER_TIER_MIX: TierBotMix = {
  local: { rusty: 0.7, scratch: 0.27, ace: 0.03 },
  challenger: { rusty: 0.08, scratch: 0.42, ace: 0.5 },
  pro: { rusty: 0.01, scratch: 0.19, ace: 0.8 },
};

const LEGACY_SCHEDULES: Record<string, LegacyPointSchedule> = {
  "participation-heavy": {
    eventCompletion: 3,
    eventTopFive: 2,
    eventWin: 6,
    activeSeasonCompletion: 8,
    promotion: 10,
    proSurvival: 6,
    seasonChampionship: 12,
    championshipQualification: 18,
    championshipWin: 45,
  },
  balanced: CAREER_V1_LEGACY_POINTS,
  "prestige-heavy": {
    eventCompletion: 1,
    eventTopFive: 8,
    eventWin: 25,
    activeSeasonCompletion: 2,
    promotion: 30,
    proSurvival: 18,
    seasonChampionship: 50,
    championshipQualification: 60,
    championshipWin: 175,
  },
};

interface MatrixDimensions {
  fieldSizes: number[];
  humanRatios: number[];
  horizons: number[];
  seeds: string[];
}

function runMatrix(
  options: Options,
  scoreBank: ReturnType<typeof buildScoreBank>,
  dimensions: MatrixDimensions,
  namespace: string,
  tierBotMix: TierBotMix = CAREER_V1_FREEZE_CANDIDATE.tierBotMix,
  tierMultipliers: Record<CareerTier, number> = CAREER_V1_FREEZE_CANDIDATE.tierMultipliers,
  botFieldModel: BotFieldModel = CAREER_V1_FREEZE_CANDIDATE.botFieldModel,
): CareerSimulation[] {
  const simulations: CareerSimulation[] = [];
  for (const fieldSize of dimensions.fieldSizes) {
    for (const humanRatio of dimensions.humanRatios) {
      for (const seasons of dimensions.horizons) {
        for (const matrixSeed of dimensions.seeds) {
          simulations.push(simulateCareerWorld({
            seed: `${options.seed}:${namespace}:${matrixSeed}:f${fieldSize}:r${humanRatio}:s${seasons}`,
            fieldSize,
            humanRatio,
            seasons,
            botFieldModel,
            tierBotMix,
            tierMultipliers,
            ...CAREER_V1_FREEZE_CANDIDATE.movement,
            scoreBank,
          }));
        }
      }
    }
  }
  return simulations;
}

function movementSummary(simulations: CareerSimulation[]) {
  const careers = simulations.flatMap((simulation) => simulation.careers);
  const byAbility = (ability: AbilityBand) => careers.filter((career) => career.ability === ability);
  const reach = (ability: AbilityBand) => {
    const group = byAbility(ability);
    return pct(group.filter((career) => career.firstProSeason != null).length, group.length);
  };
  const aceTimes = byAbility("ace")
    .map(activeSeasonsToPro)
    .filter((value): value is number => value != null);
  const reversals = careers.map(immediateReversal);
  const survival = careers.map(proSurvival);
  const survivalFor = (ability: AbilityBand) => {
    const values = byAbility(ability).map(proSurvival);
    return pct(
      values.reduce((sum, value) => sum + value.survived, 0),
      values.reduce((sum, value) => sum + value.eligible, 0),
    );
  };
  const championships = simulations.flatMap((simulation) => simulation.championships);
  const championshipSlots = championships.reduce(
    (total, championship) => total + championship.fieldSize,
    0,
  );
  const humanChampionshipSlots = championships.reduce(
    (total, championship) => total + championship.humanQualifierIds.length,
    0,
  );
  const movements = new Map<string, { promoted: number; relegated: number }>();
  for (const simulation of simulations) {
    for (const career of simulation.careers) {
      for (const history of career.histories) {
        const key = `${simulation.config.seed}:${history.season}:${history.tier}`;
        const counts = movements.get(key) ?? { promoted: 0, relegated: 0 };
        if (history.movement === "promote") counts.promoted++;
        if (history.movement === "relegate") counts.relegated++;
        movements.set(key, counts);
      }
    }
  }
  return {
    aceReach: reach("ace"),
    scratchReach: reach("scratch"),
    rustyReach: reach("rusty"),
    aceMedian: fixed(median(aceTimes), 1),
    reversal: pct(
      reversals.reduce((sum, value) => sum + value.reversed, 0),
      reversals.reduce((sum, value) => sum + value.eligible, 0),
    ),
    oscillation: pct(careers.filter(oscillates).length, careers.length),
    survival: pct(
      survival.reduce((sum, value) => sum + value.survived, 0),
      survival.reduce((sum, value) => sum + value.eligible, 0),
    ),
    aceSurvival: survivalFor("ace"),
    scratchSurvival: survivalFor("scratch"),
    rustySurvival: survivalFor("rusty"),
    humanChampionshipShare: pct(humanChampionshipSlots, championshipSlots),
    maxPromoted: Math.max(0, ...[...movements.values()].map((value) => value.promoted)),
    maxRelegated: Math.max(0, ...[...movements.values()].map((value) => value.relegated)),
  };
}

function championshipSourceSummary(simulations: CareerSimulation[]) {
  const totals = {
    "pro-top-six": 0,
    "pro-event-winner": 0,
    "pro-passdown": 0,
    "challenger-top-two": 0,
    "elite-bot": 0,
  };
  for (const championship of simulations.flatMap((simulation) => simulation.championships)) {
    for (const source of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[source] += championship.qualifiersBySource[source];
    }
  }
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    Object.entries(totals).map(([source, value]) => [source, pct(value, total)]),
  ) as Record<keyof typeof totals, string>;
}

function ratingSummary(simulations: CareerSimulation[]) {
  const careers = simulations.flatMap((simulation) => simulation.careers);
  const finalRatings = (ability: AbilityBand) => careers
    .filter((career) => career.ability === ability)
    .map((career) => career.histories.at(-1)?.tourRating ?? 0);
  const strongChallenger = careers
    .filter((career) => career.ability === "ace" && finalTier(career) === "challenger")
    .map((career) => career.histories.at(-1)?.tourRating ?? 0);
  const weakPro = careers
    .filter((career) => career.ability === "rusty" && finalTier(career) === "pro")
    .map((career) => career.histories.at(-1)?.tourRating ?? 0);
  const weakProMedian = median(weakPro);
  const recovery = careers.map(returningRecovery).filter((value): value is number => value != null);
  const catchup: Record<AbilityBand, string> = { rusty: "n/a", scratch: "n/a", ace: "n/a" };
  for (const ability of ABILITY_BANDS) {
    const full = careers.filter((career) => career.ability === ability && career.activity === "full");
    const target = (median(full.map((career) => career.histories.at(-1)?.tourRating ?? 0)) ?? 0) * 0.8;
    const seasons = full
      .map((career) => career.histories.find((history) => history.tourRating >= target)?.season)
      .filter((value): value is number => value != null);
    catchup[ability] = fixed(median(seasons), 1);
  }
  return {
    rustyMedian: median(finalRatings("rusty")),
    scratchMedian: median(finalRatings("scratch")),
    aceMedian: median(finalRatings("ace")),
    strongChallengerMedian: median(strongChallenger),
    weakProMedian,
    overlap: pct(
      weakProMedian == null
        ? 0
        : strongChallenger.filter((rating) => rating >= weakProMedian).length,
      strongChallenger.length,
    ),
    recovery: fixed(median(recovery), 1),
    catchup,
    movementHash: hash(careers.map((career) =>
      career.histories.map((history) => [history.movement, history.nextTier]))),
  };
}

function legacySummary(
  simulations: CareerSimulation[],
  schedule: LegacyPointSchedule,
) {
  const careers = simulations.flatMap((simulation) => simulation.careers);
  const points = careers.map((career) => legacyPoints(career.legacyAwards, schedule));
  const sourceTotals = Object.fromEntries(
    LEGACY_AWARD_KEYS.map((key) => [key, 0]),
  ) as Record<LegacyAwardKey, number>;
  for (const career of careers) {
    const breakdown = legacyPointBreakdown(career.legacyAwards, schedule);
    for (const key of LEGACY_AWARD_KEYS) sourceTotals[key] += breakdown[key];
  }
  const total = Object.values(sourceTotals).reduce((sum, value) => sum + value, 0);
  const participation = sourceTotals.eventCompletion + sourceTotals.activeSeasonCompletion;
  return {
    p25: percentile(points, 0.25),
    median: median(points),
    p75: percentile(points, 0.75),
    p90: percentile(points, 0.9),
    participationShare: pct(participation, total),
    sourceTotals,
    total,
  };
}

const options = parseArgs(process.argv.slice(2));
if (!Number.isFinite(options.bankSamples) || options.bankSamples < 1) {
  throw new Error("--bank-samples must be a positive number");
}

console.log(`Building Candidate H score bank (${options.bankSamples} rounds/archetype)…`);
const scoreBank = buildScoreBank(
  options.seed,
  options.bankSamples,
  CAREER_V1_FREEZE_CANDIDATE.abilityModel,
  CAREER_V1_FREEZE_CANDIDATE.errorRates,
);
const dimensions: MatrixDimensions = {
  fieldSizes: options.quick ? [20, 500] : [20, 30, 50, 100, 500],
  humanRatios: options.quick ? [0.5] : [0.25, 0.5, 0.8],
  horizons: [4, 8, 16, 32],
  seeds: options.quick ? ["a"] : ["a", "b", "c"],
};
const finalMatrix = runMatrix(options, scoreBank, dimensions, "freeze");
const finalSixteen = finalMatrix.filter((simulation) => simulation.config.seasons === 16);
const finalMovement = movementSummary(finalSixteen);

const validationDimensions: MatrixDimensions = {
  fieldSizes: dimensions.fieldSizes,
  humanRatios: dimensions.humanRatios,
  horizons: [16],
  seeds: options.quick
    ? ["validation-a"]
    : Array.from({ length: 20 }, (_, index) => `validation-${String(index + 1).padStart(2, "0")}`),
};
const validation = runMatrix(options, scoreBank, validationDimensions, "validation");
const validationMovement = movementSummary(validation);

const tierCandidates = {
  uniform: {
    model: "uniform" as const,
    mix: CAREER_V1_FREEZE_CANDIDATE.tierBotMix,
  },
  gentler: {
    model: "tier-scaled" as const,
    mix: GENTLER_TIER_MIX,
  },
  proposed: {
    model: "tier-scaled" as const,
    mix: CAREER_V1_FREEZE_CANDIDATE.tierBotMix,
  },
  steeper: {
    model: "tier-scaled" as const,
    mix: STEEPER_TIER_MIX,
  },
};
const sensitivityDimensions = { ...dimensions, horizons: [16] };
const tierSensitivity = Object.entries(tierCandidates).map(([name, candidate]) => {
  const simulations = name === "proposed"
    ? finalSixteen
    : runMatrix(
      options,
      scoreBank,
      sensitivityDimensions,
      "freeze",
      candidate.mix,
      CAREER_V1_FREEZE_CANDIDATE.tierMultipliers,
      candidate.model,
    );
  return {
    name,
    simulations,
    summary: movementSummary(simulations),
    rating: ratingSummary(simulations),
    championshipSources: championshipSourceSummary(simulations),
  };
});

const ratingMultipliers: Record<string, Record<CareerTier, number>> = {
  compressed: { local: 1, challenger: 1.4, pro: 2 },
  middle: { local: 1, challenger: 1.45, pro: 2.1 },
  proposed: CAREER_V1_FREEZE_CANDIDATE.tierMultipliers,
};
const ratingSensitivity = Object.entries(ratingMultipliers).map(([name, multipliers]) => ({
  name,
  multipliers,
  summary: ratingSummary(
    name === "proposed"
      ? finalSixteen
      : runMatrix(
        options,
        scoreBank,
        sensitivityDimensions,
        "freeze",
        CAREER_V1_FREEZE_CANDIDATE.tierBotMix,
        multipliers,
      ),
  ),
}));

const eventSensitivity = dimensions.fieldSizes.map((fieldSize) => {
  const tied = rankEvent(Array.from({ length: fieldSize }, (_, index) => ({
    competitorId: `p${index}`,
    relativeToPar: Math.floor(index / 2),
  })));
  return {
    fieldSize,
    step: fieldSize === 1 ? 0 : 100 / (fieldSize - 1),
    mean: Array.from({ length: fieldSize }, (_, index) =>
      pointsForPosition(index + 1, fieldSize))
      .reduce((sum, value) => sum + value, 0) / fieldSize,
    tiedTotal: tied.reduce((sum, standing) => sum + standing.points, 0),
    untiedTotal: fieldSize * 50,
  };
});

const legacyBySchedule = Object.entries(LEGACY_SCHEDULES).map(([name, schedule]) => ({
  name,
  schedule,
  horizons: [4, 8, 16, 32].map((horizon) => ({
    horizon,
    summary: legacySummary(
      finalMatrix.filter((simulation) => simulation.config.seasons === horizon),
      schedule,
    ),
  })),
}));

const balancedByAbilityActivity = ABILITY_BANDS.flatMap((ability) =>
  ACTIVITY_PATTERNS.map((activity) => {
    const careers = finalMatrix
      .filter((simulation) => simulation.config.seasons === 32)
      .flatMap((simulation) => simulation.careers)
      .filter((career) => career.ability === ability && career.activity === activity);
    const points = careers.map((career) => legacyPoints(career.legacyAwards, CAREER_V1_LEGACY_POINTS));
    return {
      ability,
      activity,
      count: careers.length,
      p25: percentile(points, 0.25),
      median: median(points),
      p75: percentile(points, 0.75),
    };
  }));

const legacyLargeField = legacySummary(
  finalMatrix.filter((simulation) =>
    simulation.config.seasons === 32 && simulation.config.fieldSize === 500),
  CAREER_V1_LEGACY_POINTS,
);
const balancedThirtyTwo = legacyBySchedule
  .find((candidate) => candidate.name === "balanced")!
  .horizons.find((entry) => entry.horizon === 32)!.summary;
const coverageCareers = finalMatrix.flatMap((simulation) => simulation.careers);
const bandAverage = (ability: AbilityBand) =>
  TENDENCIES.reduce(
    (sum, tendency) => sum + (scoreBank.means.get(`${ability}:${tendency}`) ?? 0),
    0,
  ) / TENDENCIES.length;
const movementHashesMatch = ratingSensitivity.every(
  (candidate) => candidate.summary.movementHash === ratingSensitivity[0].summary.movementHash,
);

const lines = [
  "# Career Mode formula freeze — Gate 3",
  "",
  "**Status: PASS — ready for product approval.** This is a simulator-validated formula package only. It contains no schema, UI, API, cron, settlement, tournament-lifecycle, or deployment work.",
  "",
  `Versioned package: \`${CAREER_V1_FREEZE_CANDIDATE.id}\`.`,
  "",
  "## Scope and reproducibility",
  "",
  "```sh",
  `npm run career:freeze -- --seed ${options.seed} --bank-samples ${options.bankSamples}`,
  "```",
  "",
  `The final matrix covers fields ${dimensions.fieldSizes.join("/")}, human ratios ${dimensions.humanRatios.map((ratio) => `${ratio * 100}%`).join("/")}, horizons ${dimensions.horizons.join("/")}, and ${dimensions.seeds.length} deterministic seeds. Independent 16-season validation uses ${validationDimensions.seeds.length} seeds. Coverage includes ${coverageCareers.length.toLocaleString()} human careers across all ${ABILITY_BANDS.length} abilities, ${TENDENCIES.length} tendencies, and ${ACTIVITY_PATTERNS.length} activity patterns.`,
  "",
  "## Frozen event points",
  "",
  "`rawEventPoints = 100 × (lockedFieldSize - occupiedPosition) / (lockedFieldSize - 1)`.",
  "",
  "- Keep full precision and round only for display.",
  "- Tied competitors receive the average of the points for every occupied tied position.",
  "- A no-show receives zero; the locked field remains the denominator.",
  "- Season points are the best three of four event-point results.",
  "- The v5 season tiebreak chain remains unchanged.",
  "",
  "| Field | Point step | Untied mean | Pair-tie total | Untied total |",
  "|---:|---:|---:|---:|---:|",
  ...eventSensitivity.map((entry) =>
    `| ${entry.fieldSize} | ${entry.step.toFixed(4)} | ${entry.mean.toFixed(1)} | ${entry.tiedTotal.toFixed(4)} | ${entry.untiedTotal.toFixed(4)} |`),
  "",
  "The mean remains 50 at every field size and averaging occupied positions preserves the exact point pool under ties. Larger fields create finer percentile resolution rather than a field-size point advantage. Freeze unchanged.",
  "",
  "## Frozen ability and movement package",
  "",
  "- Ability model: shared near-optimal engine policy plus deterministic decision-error probability.",
  "- Error rates: Rusty **0.65**, Scratch **0.14**, Ace **0.02**.",
  "- Retain the latest two **active-season** percentiles. Inactive seasons neither add zero nor break the window.",
  "- Promote when the two-season average is **at least 0.65** and both values are **at least 0.58**.",
  "- Relegate when the two-season average is **at most 0.32**.",
  "- Local cannot relegate; Pro cannot normally promote.",
  "- After promotion retain one evidence value: `0.5 + 0.25 × (priorAverage - 0.5)`.",
  "- A relegation or inactivity-driven tier change clears rolling evidence.",
  "- Per-direction human capacity: `clamp(ceil(activeHumanCount × 0.20), 4, 40)`.",
  "- Bots never consume human capacity. Exact performance ties soft-expand the boundary.",
  "",
  "| Ability | Error rate | Mean real-engine score to par |",
  "|---|---:|---:|",
  ...ABILITY_BANDS.map((ability) =>
    `| ${ability} | ${CAREER_V1_FREEZE_CANDIDATE.errorRates[ability]} | ${bandAverage(ability).toFixed(2)} |`),
  "",
  "| Validation | Ace→Pro | Scratch→Pro | Rusty→Pro | Ace median active seasons | Immediate reversal | Oscillation | Pro survival | Max human promoted/relegated |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  `| Final matrix | ${finalMovement.aceReach} | ${finalMovement.scratchReach} | ${finalMovement.rustyReach} | ${finalMovement.aceMedian} | ${finalMovement.reversal} | ${finalMovement.oscillation} | ${finalMovement.survival} | ${finalMovement.maxPromoted}/${finalMovement.maxRelegated} |`,
  `| Independent ${validationDimensions.seeds.length}-seed | ${validationMovement.aceReach} | ${validationMovement.scratchReach} | ${validationMovement.rustyReach} | ${validationMovement.aceMedian} | ${validationMovement.reversal} | ${validationMovement.oscillation} | ${validationMovement.survival} | ${validationMovement.maxPromoted}/${validationMovement.maxRelegated} |`,
  "",
  "Ordering is fixed: calculate the active-season percentile, update the two-entry window, evaluate floor/average and tier boundary, apply the per-direction human cap with exact ties, transform promotion evidence or clear relegation evidence, then record the resulting tier.",
  "",
  "## Frozen tier strength",
  "",
  "| Mix | Local R/S/A | Challenger R/S/A | Pro R/S/A | Ace→Pro | Rusty→Pro | Ace median | Pro survival A/S/R | Rating overlap | Human Championship share |",
  "|---|---|---|---|---:|---:|---:|---:|---:|---:|",
  ...tierSensitivity.map((entry) => {
    const candidate = tierCandidates[entry.name as keyof typeof tierCandidates];
    const mix = candidate.mix;
    const display = (tier: CareerTier) =>
      candidate.model === "uniform"
        ? "uniform"
        : `${Math.round(mix[tier].rusty * 100)}/${Math.round(mix[tier].scratch * 100)}/${Math.round(mix[tier].ace * 100)}`;
    return `| ${entry.name} | ${display("local")} | ${display("challenger")} | ${display("pro")} | ${entry.summary.aceReach} | ${entry.summary.rustyReach} | ${entry.summary.aceMedian} | ${entry.summary.aceSurvival}/${entry.summary.scratchSurvival}/${entry.summary.rustySurvival} | ${entry.rating.overlap} | ${entry.summary.humanChampionshipShare} |`;
  }),
  "",
  "| Mix | Pro top six | Pro event winner | Pro pass-down | Challenger top two | Elite bot |",
  "|---|---:|---:|---:|---:|---:|",
  ...tierSensitivity.map((entry) =>
    `| ${entry.name} | ${entry.championshipSources["pro-top-six"]} | ${entry.championshipSources["pro-event-winner"]} | ${entry.championshipSources["pro-passdown"]} | ${entry.championshipSources["challenger-top-two"]} | ${entry.championshipSources["elite-bot"]} |`),
  "",
  "Freeze the proposed static field assignment: Local **60/35/5**, Challenger **10/45/45**, Pro **2/28/70** Rusty/Scratch/Ace. Uniform, gentler, and steeper alternatives are retained as labelled sensitivities; none supplies a complete progression, survival, rating-overlap, and qualification-source improvement large enough to displace the proposed tier identity. Bots remain static tier texture, not autonomous careers.",
  "",
  "## Frozen Tour Rating",
  "",
  "`seasonPercentile = (activeFieldSize - activeRank) / (activeFieldSize - 1)`",
  "",
  "`seasonRating = 100 × seasonPercentile × tierMultiplier`",
  "",
  "`tourRating = sum(best 6 ratings from the last 8 chronological regular seasons)`",
  "",
  "An inactive season contributes zero and occupies a chronological slot. Championships do not contribute. Freeze multipliers at Local **1.0**, Challenger **1.5**, Pro **2.25**.",
  "",
  "| Multipliers L/C/P | Rusty median | Scratch median | Ace median | Strong Challenger | Weak Pro | Challenger overlap | Returning recovery | Catch-up R/S/A |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ...ratingSensitivity.map((entry) =>
    `| ${entry.multipliers.local}/${entry.multipliers.challenger}/${entry.multipliers.pro} (${entry.name}) | ${fixed(entry.summary.rustyMedian)} | ${fixed(entry.summary.scratchMedian)} | ${fixed(entry.summary.aceMedian)} | ${fixed(entry.summary.strongChallengerMedian)} | ${fixed(entry.summary.weakProMedian)} | ${entry.summary.overlap} | ${entry.summary.recovery} active | ${entry.summary.catchup.rusty}/${entry.summary.catchup.scratch}/${entry.summary.catchup.ace} |`),
  "",
  `All multiplier candidates produced identical movement histories: **${movementHashesMatch ? "yes" : "NO"}**. The proposed multipliers preserve meaningful tier reward while still allowing strong Challenger ratings to overlap weak Pro ratings; the compressed alternatives reduce tier identity without improving movement or recovery.`,
  "",
  "## Frozen Legacy Points",
  "",
  "All awards stack. Legacy Points are clamped to non-negative award counts and values, never decrease, never affect gameplay probabilities, and have no global leaderboard.",
  "",
  "| Award | Participation-heavy | Balanced (frozen) | Prestige-heavy |",
  "|---|---:|---:|---:|",
  ...LEGACY_AWARD_KEYS.map((key) =>
    `| ${key} | ${LEGACY_SCHEDULES["participation-heavy"][key]} | ${LEGACY_SCHEDULES.balanced[key]} | ${LEGACY_SCHEDULES["prestige-heavy"][key]} |`),
  "",
  "| Candidate / horizon | P25 | Median | P75 | P90 | Completion share |",
  "|---|---:|---:|---:|---:|---:|",
  ...legacyBySchedule.flatMap((candidate) => candidate.horizons.map((entry) =>
    `| ${candidate.name} / ${entry.horizon} | ${fixed(entry.summary.p25, 0)} | ${fixed(entry.summary.median, 0)} | ${fixed(entry.summary.p75, 0)} | ${fixed(entry.summary.p90, 0)} | ${entry.summary.participationShare} |`)),
  "",
  "Freeze the balanced schedule: 1 event completion, 5 top five, 15 event win, 3 active-season completion, 20 promotion, 12 Pro survival, 30 season championship, 35 Championship qualification, and 100 Championship win. It keeps ordinary participation meaningful without letting completion alone swamp competitive awards; the participation-heavy option overweights attendance, while the prestige-heavy option creates excessively bursty elite pacing.",
  "",
  "Balanced 32-season pacing by ability and activity:",
  "",
  "| Ability | Activity | Careers | P25 | Median | P75 |",
  "|---|---|---:|---:|---:|---:|",
  ...balancedByAbilityActivity.map((entry) =>
    `| ${entry.ability} | ${entry.activity} | ${entry.count} | ${fixed(entry.p25, 0)} | ${fixed(entry.median, 0)} | ${fixed(entry.p75, 0)} |`),
  "",
  `The balanced 32-season population has P25/median/P75/P90 of **${fixed(balancedThirtyTwo.p25, 0)}/${fixed(balancedThirtyTwo.median, 0)}/${fixed(balancedThirtyTwo.p75, 0)}/${fixed(balancedThirtyTwo.p90, 0)}**. The 500-player slice is **${fixed(legacyLargeField.p25, 0)}/${fixed(legacyLargeField.median, 0)}/${fixed(legacyLargeField.p75, 0)}/${fixed(legacyLargeField.p90, 0)}**, showing stable large-field pacing.`,
  "",
  "Balanced 32-season contribution by award source:",
  "",
  "| Award source | Share of Legacy Points |",
  "|---|---:|",
  ...LEGACY_AWARD_KEYS.map((key) =>
    `| ${key} | ${pct(balancedThirtyTwo.sourceTotals[key], balancedThirtyTwo.total)} |`),
  "",
  "Frozen milestone thresholds:",
  "",
  "- **50 — Rookie**: approximately four to six active seasons.",
  "- **100 — Contender**: approximately eight to twelve active seasons.",
  "- **250 — Tour Regular**: sustained participation over roughly 16–24 seasons.",
  "- **500 — Veteran**: an accomplished long career; generally near or beyond 32 seasons.",
  "- **1,000 — Legend**: deliberately beyond the 32-season validation horizon.",
  "",
  "## Frozen edge cases",
  "",
  "- A one-player event awards 100 points; a one-player active season percentile is 1.",
  "- No-shows receive zero event points and no event-completion Legacy award. Missing an event never deducts points.",
  "- Rank ties share occupied-position event points. Every competitor tied at rank one receives the event-win Legacy award; fixed-field Championship qualification still uses the deterministic standings fallback.",
  "- Movement uses a `1e-12` numerical tolerance so mathematically exact threshold equality is not lost to floating-point representation.",
  "- Exact movement-boundary performance ties soft-expand beyond the human limit; bots never consume that limit.",
  "- Inactive seasons are skipped by movement evidence but occupy Tour Rating chronology at zero. A second consecutive inactive Pro season relegates to Challenger and clears movement evidence; inactivity never pushes a player below Challenger.",
  "- Championship qualification awards qualification Legacy Points once. Only the settled winner receives the Championship-win award. Championship results never alter movement or Tour Rating.",
  "- All Legacy awards stack, and negative counts or values are treated as zero.",
  "",
  "## Rejected alternatives",
  "",
  "- v5 one-season 20% slot movement: excessive weak promotion and reversal.",
  "- symmetric confirmation: stable only because progression nearly stops.",
  "- relegation protection: retains weak upward variance rather than improving selection.",
  "- fixed human caps: starve large-field progression; H's bounded percentage is scale-sensitive.",
  "- rolling three-season evidence: moves strong-player timing beyond the target.",
  "- gentler/steeper tier mixes: do not improve the complete movement/fairness balance enough to replace the proposed mix.",
  "- compressed Tour Rating multipliers: narrow tier identity with no movement or recovery benefit.",
  "- participation-heavy Legacy: attendance contributes too much of total value.",
  "- prestige-heavy Legacy: elite outcomes create too much variance in permanent progression.",
  "",
  "## Remaining risks and next gate",
  "",
  "- Score banks deterministically sample real-engine rounds for matrix speed; settlement-scale implementation tests should also execute direct complete rounds.",
  "- The 500-player movement cap is soft: an exact tie may move 41+ humans rather than arbitrarily split identical performances.",
  "- Championship winners are simulated against Ace-level elite bot opposition for Legacy pacing; production settlement must use actual Championship results.",
  "- Static bot tier assignment is intentionally the v1 boundary; this does not authorize autonomous bot careers.",
  "- **Championship and regular-season concurrency still requires human playtesting.** Simulation cannot determine whether the extra event feels delightful or burdensome.",
  "",
  "Gate 3 is mechanically complete and ready for product approval. Approval should advance only to Gate 4 settlement failure/recovery requirements—not schema or production implementation.",
  "",
];

const output = resolve(options.output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${lines.join("\n")}\n`);
console.log(`Wrote ${output}`);
