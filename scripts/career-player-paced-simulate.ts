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
  simulatePlayerPacedCareer,
  type PlayerPacedCareerSimulation,
} from "../lib/career/playerPacedSimulator";
import { CAREER_V3_FORMULA_BUNDLE } from "../lib/career/formulaBundle";
import { tourRating, type RatingSeason } from "../lib/career/rules";
import {
  ABILITY_BANDS,
  buildScoreBank,
  type AbilityBand,
} from "../lib/career/simulator";

interface Options {
  seed: string;
  bankSamples: number;
  careersPerAbility: number;
  seasons: number;
  output: string;
  quick: boolean;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv: string[]): Options {
  const quick = argv.includes("--quick");
  return {
    seed: valueAfter(argv, "--seed") ?? "career-player-paced-v1",
    bankSamples: Number(valueAfter(argv, "--bank-samples") ?? (quick ? 32 : 256)),
    careersPerAbility: Number(valueAfter(argv, "--careers-per-ability") ?? (quick ? 20 : 200)),
    seasons: Number(valueAfter(argv, "--seasons") ?? (quick ? 100 : 500)),
    output: valueAfter(argv, "--output") ?? "docs/career-player-paced-simulator-report.md",
    quick,
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
  `Building ${CAREER_V3_FORMULA_BUNDLE.id} real-engine score bank `
  + `(${options.bankSamples} rounds/archetype)…`,
);
const bank = buildScoreBank(
  options.seed,
  options.bankSamples,
  CAREER_V3_FORMULA_BUNDLE.ability.model,
  { ...CAREER_V3_FORMULA_BUNDLE.ability.errorRates },
);

const simulations = new Map<AbilityBand, PlayerPacedCareerSimulation[]>();
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

const horizons = requiredHorizons.filter((horizon) => horizon <= options.seasons);
const lines: string[] = [
  "# Player-paced Career long-horizon simulation",
  "",
  `Formula package: \`${CAREER_V3_FORMULA_BUNDLE.id}\`.`,
  "",
  "This analysis models one player plus nineteen tier-scaled named bots, four immediately playable events per season, best three counting, Candidate-H rolling movement without a human cap, a Championship check every fourth settled season gated on Challenger/Pro, and no inactivity. Every unlocked Championship is played immediately for the Legacy curve; qualification points are earned at season settlement either way.",
  "",
  "## Reproduction",
  "",
  "```sh",
  `npm run career:simulate:player-paced -- --seed ${options.seed} --bank-samples ${options.bankSamples} --careers-per-ability ${options.careersPerAbility} --seasons ${options.seasons}`,
  "```",
  "",
  `The run contains ${options.careersPerAbility * ABILITY_BANDS.length} deterministic careers and ${(options.careersPerAbility * ABILITY_BANDS.length * options.seasons).toLocaleString()} settled seasons. Human tendency is held at Balanced to isolate skill; bot tendencies remain their persistent roster identities.`,
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
  "## Tour Rating volume-neutrality",
  "",
  `A 10-season-or-shorter history represented by the same final eight ratings yields **${shortRating.toFixed(2)}**. A 200-season history with those identical final eight ratings yields **${longRating.toFixed(2)}**. Difference: **${Math.abs(shortRating - longRating).toFixed(2)}**.`,
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
