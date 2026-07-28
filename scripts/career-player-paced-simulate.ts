/**
 * Reproducible long-horizon calibration for player-paced Career Mode.
 *
 * Usage:
 *   npm run career:simulate:player-paced
 *   npm run career:simulate:player-paced -- --quick
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  autoAllocateCareerSkills,
  balancedCareerSkillPath,
  buildCareerSkillScoreBank,
  simulatePlayerPacedCareer,
  type PlayerPacedCareerSimulation,
} from "../lib/career/playerPacedSimulator";
import { CAREER_V4_FORMULA_BUNDLE } from "../lib/career/formulaBundle";
import { careerSkillKey } from "../lib/career/development";
import { tourRating, type RatingSeason } from "../lib/career/rules";
import {
  ABILITY_BANDS,
  type AbilityBand,
} from "../lib/career/simulator";

interface Options {
  seed: string;
  bankSamples: number;
  careersPerAbility: number;
  seasons: number;
  output: string;
  quick: boolean;
  localPromote?: number;
  localFloor?: number;
  challengerPromote?: number;
  challengerFloor?: number;
  relegate?: number;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv: string[]): Options {
  const quick = argv.includes("--quick");
  const optionalNumber = (flag: string) => {
    const value = valueAfter(argv, flag);
    return value == null ? undefined : Number(value);
  };
  return {
    seed: valueAfter(argv, "--seed") ?? "career-player-paced-v1",
    bankSamples: Number(valueAfter(argv, "--bank-samples") ?? (quick ? 32 : 256)),
    careersPerAbility: Number(valueAfter(argv, "--careers-per-ability") ?? (quick ? 20 : 200)),
    seasons: Number(valueAfter(argv, "--seasons") ?? (quick ? 100 : 500)),
    output: valueAfter(argv, "--output") ?? "docs/career-player-paced-simulator-report.md",
    quick,
    localPromote: optionalNumber("--local-promote"),
    localFloor: optionalNumber("--local-floor"),
    challengerPromote: optionalNumber("--challenger-promote"),
    challengerFloor: optionalNumber("--challenger-floor"),
    relegate: optionalNumber("--relegate"),
  };
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * proportion)),
  );
  return sorted[index];
}

function average(values: readonly number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function fixed(value: number | null, digits = 0): string {
  return value == null ? "n/a" : value.toFixed(digits);
}

function percent(value: number, total: number): string {
  return `${(total ? value / total * 100 : 0).toFixed(1)}%`;
}

function distribution(values: readonly number[]): string[] {
  return [0.1, 0.25, 0.5, 0.75, 0.9].map((point) =>
    fixed(percentile(values, point)));
}

function historiesAt(
  simulations: readonly PlayerPacedCareerSimulation[],
  season: number,
): number[] {
  return simulations.map((simulation) =>
    simulation.histories[Math.min(season, simulation.histories.length) - 1]?.legacyTotal ?? 0);
}

const options = parseArgs(process.argv.slice(2));
for (const [label, value] of [
  ["bank samples", options.bankSamples],
  ["careers per ability", options.careersPerAbility],
  ["seasons", options.seasons],
] as const) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

const requiredHorizons = [10, 25, 50, 100, 250];
const provisionalMilestones = [250, 1_000, 2_500, 5_000, 10_000, 25_000];
if (!options.quick && options.seasons < Math.max(...requiredHorizons)) {
  throw new Error("Full player-paced calibration requires at least 250 seasons");
}

console.log(
  `Building ${CAREER_V4_FORMULA_BUNDLE.id} exact-rank real-engine score bank `
  + `(${options.bankSamples} rounds/archetype/rank vector)…`,
);
const bank = buildCareerSkillScoreBank(
  options.seed,
  options.bankSamples,
  CAREER_V4_FORMULA_BUNDLE.ability.model,
  { ...CAREER_V4_FORMULA_BUNDLE.ability.errorRates },
);

const simulations = new Map<AbilityBand, PlayerPacedCareerSimulation[]>();
const formulaMovement = CAREER_V4_FORMULA_BUNDLE.movement.tierThresholds!;
const movementThresholds = options.localPromote == null
  ? undefined
  : {
    local: {
      promoteThreshold: options.localPromote,
      promotionFloor: options.localFloor ?? options.localPromote,
      relegateThreshold: options.relegate ?? 0.28,
    },
    challenger: {
      promoteThreshold: options.challengerPromote ?? options.localPromote,
      promotionFloor: options.challengerFloor
        ?? options.localFloor
        ?? options.localPromote,
      relegateThreshold: options.relegate ?? 0.28,
    },
    pro: {
      promoteThreshold: 1,
      promotionFloor: 1,
      relegateThreshold: options.relegate ?? 0.28,
    },
  } as const;
for (const ability of ABILITY_BANDS) {
  const careers: PlayerPacedCareerSimulation[] = [];
  for (let index = 0; index < options.careersPerAbility; index++) {
    careers.push(simulatePlayerPacedCareer({
      seed: `${options.seed}:${ability}:${index + 1}`,
      seasons: options.seasons,
      ability,
      tendency: "balanced",
      scoreBank: bank,
      playChampionships: true,
      movementThresholds,
    }));
  }
  simulations.set(ability, careers);
  console.log(`Simulated ${careers.length} ${ability} careers × ${options.seasons} seasons`);
}

const shortRecent: RatingSeason[] = [
  95, 120, 80, 150, 110, 140, 100, 130,
].map((rating) => ({ rating, active: true }));
const longHistory: RatingSeason[] = [
  ...Array.from({ length: 192 }, (_, index) => ({
    rating: (index * 37) % 226,
    active: true,
  })),
  ...shortRecent,
];
const shortRating = tourRating(shortRecent);
const longRating = tourRating(longHistory);
const allHistories = [...simulations.values()]
  .flatMap((careers) => careers)
  .flatMap((career) => career.histories);
const challengerRatings = allHistories
  .filter((history) => history.tier === "challenger")
  .map((history) => history.tourRating);
const proRatings = allHistories
  .filter((history) => history.tier === "pro")
  .map((history) => history.tourRating);
const strongChallengerRating = percentile(challengerRatings, 0.75);
const weakProRating = percentile(proRatings, 0.25);
const tierRatingGap = strongChallengerRating != null && weakProRating != null
  ? weakProRating - strongChallengerRating
  : null;
const challengerProOverlap = strongChallengerRating == null
  ? null
  : proRatings.filter((rating) => rating <= strongChallengerRating).length / proRatings.length;

const horizons = requiredHorizons.filter((horizon) => horizon <= options.seasons);
const rankPath = balancedCareerSkillPath();
const initialRanks = rankPath[0];
const maxRanks = rankPath.at(-1)!;
const skillMean = (
  ability: AbilityBand,
  ranks: typeof initialRanks,
) => bank.skillMeans.get(
  `${ability}:balanced|${careerSkillKey(ranks)}`,
) ?? Number.NaN;
const bottomHalfRanks = autoAllocateCareerSkills(initialRanks, 4).ranks;
const bottomHalfCeiling = Object.values(bottomHalfRanks)
  .reduce((sum, rank) => sum + rank, 0);
const cohortProgression = new Map(ABILITY_BANDS.map((ability) => {
  const careers = simulations.get(ability)!;
  const proSeasons = careers
    .map((career) => career.firstProSeason)
    .filter((season): season is number => season != null);
  return [ability, {
    by10: proSeasons.filter((season) => season <= 10).length / careers.length,
    by25: proSeasons.filter((season) => season <= 25).length / careers.length,
    median: percentile(proSeasons, 0.5),
    relegations: careers.reduce((sum, career) => sum + career.relegations, 0),
  }] as const;
}));
const rankEffectsPositive = ABILITY_BANDS.every((ability) =>
  skillMean(ability, initialRanks) > skillMean(ability, maxRanks));
const allRanksBounded = allHistories.every((history) =>
  Object.values(history.skills).every((rank) => rank >= 1 && rank <= 5));
const lines: string[] = [
  "# Player-paced Career long-horizon simulation",
  "",
  `Formula package: \`${CAREER_V4_FORMULA_BUNDLE.id}\`.`,
  movementThresholds
    ? `Calibration movement override: Local ${(movementThresholds.local.promoteThreshold * 100).toFixed(0)}%/${(movementThresholds.local.promotionFloor * 100).toFixed(0)}% floor, Challenger ${(movementThresholds.challenger.promoteThreshold * 100).toFixed(0)}%/${(movementThresholds.challenger.promotionFloor * 100).toFixed(0)}% floor, and ${(movementThresholds.pro.relegateThreshold * 100).toFixed(0)}% relegation.`
    : `Movement: Local ${(formulaMovement.local.promoteThreshold * 100).toFixed(0)}%/${(formulaMovement.local.promotionFloor * 100).toFixed(0)}% floor, Challenger ${(formulaMovement.challenger.promoteThreshold * 100).toFixed(0)}%/${(formulaMovement.challenger.promotionFloor * 100).toFixed(0)}% floor, and ${(formulaMovement.pro.relegateThreshold * 100).toFixed(0)}% relegation.`,
  "Development: exact Driving, Approach, Short Game, and Putting ranks (1–5) applied to the production stage probability tables. The simulator spends points along a deterministic balanced path; it never substitutes a higher ability band.",
  "",
  "This analysis models one player plus nineteen tier-scaled named bots, four four-round events per season, best three counting, two-season rolling movement, a Championship check every fourth settled season gated on Challenger/Pro, and no inactivity. Every unlocked Championship is played immediately for the Legacy curve.",
  "",
  "## Reproduction",
  "",
  "```sh",
  `npm run career:simulate:player-paced -- --seed ${options.seed} --bank-samples ${options.bankSamples} --careers-per-ability ${options.careersPerAbility} --seasons ${options.seasons}${movementThresholds ? ` --local-promote ${movementThresholds.local.promoteThreshold} --local-floor ${movementThresholds.local.promotionFloor} --challenger-promote ${movementThresholds.challenger.promoteThreshold} --challenger-floor ${movementThresholds.challenger.promotionFloor} --relegate ${movementThresholds.pro.relegateThreshold}` : ""}`,
  "```",
  "",
  `The run contains ${options.careersPerAbility * ABILITY_BANDS.length} deterministic careers and ${(options.careersPerAbility * ABILITY_BANDS.length * options.seasons).toLocaleString()} settled seasons. Human tendency is held at Balanced to isolate skill; bot tendencies remain their persistent roster identities.`,
  "",
  "## Exact rank effect",
  "",
  "| Starting decision quality | Rank 1 mean | All-rank-5 mean | Improvement |",
  "|---|---:|---:|---:|",
  ...ABILITY_BANDS.map((ability) => {
    const start = skillMean(ability, initialRanks);
    const max = skillMean(ability, maxRanks);
    return `| ${ability} | ${fixed(start, 2)} | ${fixed(max, 2)} | ${fixed(start - max, 2)} strokes |`;
  }),
  "",
  `A career that never finishes in the top half can earn only the four foundation points. Its theoretical balanced-build ceiling is ${bottomHalfCeiling} total rank levels out of 20, so volume alone cannot maximize the player.`,
  "",
  "## Legacy curve",
  "",
  "| Ability | Season | P10 | P25 | Median | P75 | P90 |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...ABILITY_BANDS.flatMap((ability) => horizons.map((horizon) => {
    const values = historiesAt(simulations.get(ability)!, horizon);
    return `| ${ability} | ${horizon} | ${distribution(values).join(" | ")} |`;
  })),
  "",
  "## Progression and Championships",
  "",
  "| Ability | Pro by S10 | Pro by S25 | Median seasons to Pro | First Championship reached | Mean / median first Championship | Relegations / season | Pro survival |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...ABILITY_BANDS.map((ability) => {
    const careers = simulations.get(ability)!;
    const proSeasons = careers
      .map((career) => career.firstProSeason)
      .filter((season): season is number => season != null);
    const championships = careers
      .map((career) => career.firstChampionshipSeason)
      .filter((season): season is number => season != null);
    const relegations = careers.reduce((sum, career) => sum + career.relegations, 0);
    const proAttempts = careers.reduce((sum, career) => sum + career.proSeasons, 0);
    const proSurvived = careers.reduce((sum, career) => sum + career.proSeasonsSurvived, 0);
    return `| ${ability} | ${
      percent(proSeasons.filter((season) => season <= 10).length, careers.length)
    } | ${
      percent(proSeasons.filter((season) => season <= 25).length, careers.length)
    } | ${fixed(percentile(proSeasons, 0.5), 1)} | ${
      percent(championships.length, careers.length)
    } | ${fixed(average(championships), 1)} / ${fixed(percentile(championships, 0.5), 1)} | ${
      fixed(relegations / (careers.length * options.seasons), 3)
    } | ${percent(proSurvived, proAttempts)} |`;
  }),
  "",
  "## Gate verdicts",
  "",
  "| Gate | Result | Verdict |",
  "|---|---:|---|",
  `| Rank modifiers improve the real engine | ${rankEffectsPositive ? "all 3 cohorts" : "failed"} | ${rankEffectsPositive ? "Pass" : "Fail"} |`,
  `| Rusty path to Pro by Season 25 | ${percent(Math.round(cohortProgression.get("rusty")!.by25 * options.careersPerAbility), options.careersPerAbility)} | ${cohortProgression.get("rusty")!.by25 >= 0.5 ? "Pass" : "Fail"} |`,
  `| Rusty Pro not automatic by Season 10 | ${percent(Math.round(cohortProgression.get("rusty")!.by10 * options.careersPerAbility), options.careersPerAbility)} | ${cohortProgression.get("rusty")!.by10 < 0.5 ? "Pass" : "Fail"} |`,
  `| Scratch/Ace remain separated | median ${fixed(cohortProgression.get("scratch")!.median, 1)} / ${fixed(cohortProgression.get("ace")!.median, 1)} | ${cohortProgression.get("scratch")!.median !== cohortProgression.get("ace")!.median ? "Pass" : "Fail"} |`,
  `| Relegation remains possible | ${[...cohortProgression.values()].reduce((sum, value) => sum + value.relegations, 0)} observed | ${[...cohortProgression.values()].some((value) => value.relegations > 0) ? "Pass" : "Fail"} |`,
  `| Tour Rating volume-neutral | ${Math.abs(shortRating - longRating).toFixed(2)} difference | ${shortRating === longRating ? "Pass" : "Fail"} |`,
  `| Challenger/Pro overlap remains | ${challengerProOverlap == null ? "n/a" : (challengerProOverlap * 100).toFixed(1) + "%"} | ${challengerProOverlap != null && challengerProOverlap > 0 ? "Pass" : "Fail"} |`,
  `| Ranks cap at 1–5 | ${allRanksBounded ? "bounded" : "out of range"} | ${allRanksBounded ? "Pass" : "Fail"} |`,
  `| Bottom-half volume cannot max | ${bottomHalfCeiling}/20 rank levels | ${bottomHalfCeiling < 20 ? "Pass" : "Fail"} |`,
  "",
  "## Tour Rating volume-neutrality",
  "",
  `A 10-season-or-shorter history represented by the same final eight ratings yields **${shortRating.toFixed(2)}**. A 200-season history with those identical final eight ratings yields **${longRating.toFixed(2)}**. Difference: **${Math.abs(shortRating - longRating).toFixed(2)}**.`,
  "",
  "## Tier-rating boundary",
  "",
  `The strong-Challenger checkpoint (75th-percentile Tour Rating) is **${fixed(strongChallengerRating, 2)}**. The weak-Pro checkpoint (25th percentile) is **${fixed(weakProRating, 2)}**. The Pro-minus-Challenger boundary is **${fixed(tierRatingGap, 2)}**. **${challengerProOverlap == null ? "n/a" : (challengerProOverlap * 100).toFixed(1) + "%"}** of Pro-season ratings fall at or below that strong-Challenger checkpoint, recording the intentional overlap without removing the tier reward.`,
  "",
  "## Milestone observations",
  "",
  "Current provisional ladder: 250 / 1,000 / 2,500 / 5,000 / 10,000 / 25,000.",
  "",
  "| Ability | Milestone | Reached in horizon | P25 seasons | Median seasons | P75 seasons |",
  "|---|---:|---:|---:|---:|---:|",
  ...ABILITY_BANDS.flatMap((ability) => provisionalMilestones.map((milestone) => {
    const careers = simulations.get(ability)!;
    const reached = careers
      .map((career) =>
        career.histories.find((history) => history.legacyTotal >= milestone)?.season)
      .filter((season): season is number => season != null);
    return `| ${ability} | ${milestone.toLocaleString()} | ${
      percent(reached.length, careers.length)
    } | ${fixed(percentile(reached, 0.25), 1)} | ${
      fixed(percentile(reached, 0.5), 1)
    } | ${fixed(percentile(reached, 0.75), 1)} |`;
  })),
  "",
  ...ABILITY_BANDS.map((ability) => {
    const careers = simulations.get(ability)!;
    const final = careers.map((career) => career.histories.at(-1)!.legacyTotal);
    return `- ${ability}: season-${options.seasons} Legacy median ${fixed(percentile(final, 0.5))} (P25 ${fixed(percentile(final, 0.25))}, P75 ${fixed(percentile(final, 0.75))}); mean ${fixed(average(final))}.`;
  }),
  "",
  "The design document records the product recommendation derived from these values.",
];

const output = resolve(options.output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${lines.join("\n")}\n`);
console.log(`Wrote ${output}`);
