/**
 * Reproducible Career Mode formula calibration.
 *
 * Usage:
 *   npm run career:simulate
 *   npm run career:simulate -- --seed career-v1-review --bank-samples 256
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ABILITY_BANDS,
  TENDENCIES,
  buildScoreBank,
  simulateCareerWorld,
  type AbilityBand,
  type AbilityModel,
  type BotFieldModel,
  type CareerErrorRates,
  type CareerSimulation,
  type MovementConfirmation,
  type PromotionModel,
  type ScoreBank,
  type SimulatedCareer,
} from "../lib/career/simulator";
import {
  BASELINE_TIER_MULTIPLIER,
  type CareerTier,
  type ChampionshipSource,
} from "../lib/career/rules";

interface CliOptions {
  seed: string;
  bankSamples: number;
  output: string;
  quick: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const valueAfter = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    seed: valueAfter("--seed") ?? "career-v1-baseline",
    bankSamples: Number(valueAfter("--bank-samples") ?? (argv.includes("--quick") ? 32 : 256)),
    output: valueAfter("--output") ?? "docs/career-simulator-report.md",
    quick: argv.includes("--quick"),
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pct(value: number, total: number): string {
  return `${(total ? value / total * 100 : 0).toFixed(1)}%`;
}

function fixed(value: number | null, digits = 1): string {
  return value == null ? "n/a" : value.toFixed(digits);
}

function activeSeasonsToPro(career: SimulatedCareer): number | null {
  if (career.firstProSeason == null) return null;
  return career.histories.filter((history) => history.season < career.firstProSeason! && history.active).length;
}

function finalTier(career: SimulatedCareer): CareerTier {
  return career.histories.at(-1)?.nextTier ?? career.tier;
}

function transitionSequence(career: SimulatedCareer): Array<"promote" | "relegate"> {
  return career.histories
    .map((history) => history.movement)
    .filter((movement): movement is "promote" | "relegate" =>
      movement === "promote" || movement === "relegate");
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

function hasLongOscillation(career: SimulatedCareer): boolean {
  const sequence = transitionSequence(career);
  for (let index = 0; index <= sequence.length - 3; index++) {
    if (sequence[index] !== sequence[index + 1] && sequence[index] === sequence[index + 2]) return true;
  }
  return false;
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

function returningRecovery(career: SimulatedCareer): number | null {
  if (career.activity !== "returning" || career.histories.length < 8) return null;
  const preAbsence = career.histories.find((history) => history.season === 4)?.tourRating ?? 0;
  if (preAbsence <= 0) return null;
  let activeSeasons = 0;
  for (const history of career.histories.filter((entry) => entry.season >= 7)) {
    if (history.active) activeSeasons++;
    if (history.tourRating >= preAbsence) return activeSeasons;
  }
  return null;
}

function tierDistribution(
  simulations: CareerSimulation[],
  horizon: number,
  ability: AbilityBand,
): Record<CareerTier, number> {
  const counts: Record<CareerTier, number> = { local: 0, challenger: 0, pro: 0 };
  for (const simulation of simulations.filter((entry) => entry.config.seasons === horizon)) {
    for (const career of simulation.careers.filter((entry) => entry.ability === ability)) {
      counts[finalTier(career)]++;
    }
  }
  return counts;
}

function allCareers(simulations: CareerSimulation[]): SimulatedCareer[] {
  return simulations.flatMap((simulation) => simulation.careers);
}

function sourceRow(
  simulations: CareerSimulation[],
  selector: "qualifiersBySource" | "humanQualifiersBySource",
): Record<ChampionshipSource, number> {
  const result: Record<ChampionshipSource, number> = {
    "pro-top-six": 0,
    "pro-event-winner": 0,
    "pro-passdown": 0,
    "challenger-top-two": 0,
    "elite-bot": 0,
  };
  for (const championship of simulations.flatMap((simulation) => simulation.championships)) {
    for (const source of Object.keys(result) as ChampionshipSource[]) {
      result[source] += championship[selector][source];
    }
  }
  return result;
}

function movementSummary(simulations: CareerSimulation[]) {
  const snapshots = simulations.flatMap((simulation) => simulation.tierSnapshots);
  const expanded = snapshots.filter((snapshot) =>
    snapshot.promotionTieExpansion > 0 || snapshot.relegationTieExpansion > 0);
  const extra = expanded.reduce(
    (sum, snapshot) => sum + snapshot.promotionTieExpansion + snapshot.relegationTieExpansion,
    0,
  );
  return {
    snapshots: snapshots.length,
    expanded: expanded.length,
    rate: pct(expanded.length, snapshots.length),
    averageExtra: expanded.length ? extra / expanded.length : 0,
  };
}

interface Candidate {
  name: string;
  model: AbilityModel;
  botFieldModel: BotFieldModel;
  movementConfirmation?: MovementConfirmation;
  promotionModel?: PromotionModel;
  rollingWindow?: number;
  rollingPromoteThreshold?: number;
  rollingRelegateThreshold?: number;
  rollingMinEntries?: number;
  rollingPromotionFloor?: number;
  rollingRelegationCeiling?: number;
  rollingPromotionCarryWeight?: number;
  humanMovementCap?: number;
  humanMovementLimitModel?: "none" | "fixed" | "sqrt" | "percentage-cap";
  humanMovementLimitMin?: number;
  humanMovementLimitScale?: number;
  humanMovementLimitMax?: number;
  movementRate: number;
  multipliers: Record<CareerTier, number>;
  requireRepeatQualification?: boolean;
  errorProfile?: "standard" | "moderate" | "wide";
}

interface CandidateSummary {
  name: string;
  model: AbilityModel;
  botFieldModel: BotFieldModel;
  movementConfirmation: MovementConfirmation;
  movementShape: string;
  aceProc: string;
  scratchPro: string;
  rustyPro: string;
  aceMedianToPro: string;
  medianToPro: Record<AbilityBand, string>;
  reversal: string;
  oscillation: string;
  survival: string;
  aceSurvival: string;
  scratchSurvival: string;
  rustySurvival: string;
  newCatchup: Record<AbilityBand, string>;
  returnRecovery: string;
  tieExpansion: string;
  humanChampionshipShare: string;
  maxFiveHundredSlots: number;
  maxHumanPromoted: number;
  maxHumanRelegated: number;
  warningFrequency: string;
  capHoldFrequency: string;
  tierDistributions: Record<number, Record<AbilityBand, Record<CareerTier, string>>>;
  championshipSources: Record<ChampionshipSource, string>;
  strongChallengerMedian: number | null;
  weakProMedian: number | null;
  overlap: string;
  fieldSensitivity: string;
  ratioSensitivity: string;
  activitySensitivity: string;
}

function summarizeCandidate(candidate: Candidate, simulations: CareerSimulation[]): CandidateSummary {
  const evaluation = simulations.filter((simulation) => simulation.config.seasons === 16);
  const careers = allCareers(evaluation);
  const reversals = careers.map(immediateReversal);
  const survival = careers.map(proSurvival);
  const byAbility = (ability: AbilityBand) => careers.filter((career) => career.ability === ability);
  const ace = byAbility("ace");
  const scratch = byAbility("scratch");
  const rusty = byAbility("rusty");
  const strongChallenger = ace
    .filter((career) => finalTier(career) === "challenger")
    .map((career) => career.histories.at(-1)?.tourRating ?? 0);
  const weakPro = rusty
    .filter((career) => finalTier(career) === "pro")
    .map((career) => career.histories.at(-1)?.tourRating ?? 0);
  const weakProMedian = median(weakPro);
  const overlapCount = weakProMedian == null
    ? 0
    : strongChallenger.filter((rating) => rating >= weakProMedian).length;
  const reach = (group: SimulatedCareer[]) => pct(group.filter((career) => career.firstProSeason != null).length, group.length);
  const survivalFor = (group: SimulatedCareer[]) => {
    const values = group.map(proSurvival);
    return pct(
      values.reduce((sum, value) => sum + value.survived, 0),
      values.reduce((sum, value) => sum + value.eligible, 0),
    );
  };
  const candidateMovement = movementSummary(simulations);
  const championships = simulations.flatMap((simulation) => simulation.championships);
  const championshipSlots = championships.reduce((sum, championship) => sum + championship.fieldSize, 0);
  const humanChampionshipSlots = championships.reduce(
    (sum, championship) =>
      sum + Object.values(championship.humanQualifiersBySource).reduce((inner, value) => inner + value, 0),
    0,
  );
  const fiveHundredSnapshots = simulations
    .filter((simulation) => simulation.config.fieldSize === 500)
    .flatMap((simulation) => simulation.tierSnapshots);
  let maxHumanPromoted = 0;
  let maxHumanRelegated = 0;
  for (const simulation of simulations) {
    const movements = new Map<string, { promoted: number; relegated: number }>();
    for (const career of simulation.careers) {
      for (const history of career.histories) {
        const key = `${history.season}:${history.tier}`;
        const counts = movements.get(key) ?? { promoted: 0, relegated: 0 };
        if (history.movement === "promote") counts.promoted++;
        if (history.movement === "relegate") counts.relegated++;
        movements.set(key, counts);
      }
    }
    for (const counts of movements.values()) {
      maxHumanPromoted = Math.max(maxHumanPromoted, counts.promoted);
      maxHumanRelegated = Math.max(maxHumanRelegated, counts.relegated);
    }
  }
  const activeHistories = careers.flatMap((career) => career.histories).filter((history) => history.active);
  const warningCount = activeHistories.filter((history) => history.movementState === "relegation-warning").length;
  const capHoldCount = activeHistories.filter((history) => history.movementState === "movement-cap").length;
  const medianToPro = Object.fromEntries(ABILITY_BANDS.map((ability) => {
    const group = byAbility(ability);
    return [
      ability,
      fixed(median(group.map(activeSeasonsToPro).filter((value): value is number => value != null)), 1),
    ];
  })) as Record<AbilityBand, string>;
  const benchmark = Object.fromEntries(ABILITY_BANDS.map((ability) => [
    ability,
    median(byAbility(ability)
      .filter((career) => career.activity === "full")
      .map((career) => career.histories.at(-1)?.tourRating ?? 0)) ?? 0,
  ])) as Record<AbilityBand, number>;
  const newCatchup = Object.fromEntries(ABILITY_BANDS.map((ability) => {
    const target = benchmark[ability] * 0.8;
    const seasons = byAbility(ability)
      .filter((career) => career.activity === "full")
      .map((career) => career.histories.find((history) => history.tourRating >= target)?.season)
      .filter((value): value is number => value != null);
    return [ability, fixed(median(seasons), 1)];
  })) as Record<AbilityBand, string>;
  const tierDistributions = Object.fromEntries([4, 8, 16].map((horizon) => [
    horizon,
    Object.fromEntries(ABILITY_BANDS.map((ability) => {
      const counts = tierDistribution(simulations, horizon, ability);
      const total = counts.local + counts.challenger + counts.pro;
      return [ability, {
        local: pct(counts.local, total),
        challenger: pct(counts.challenger, total),
        pro: pct(counts.pro, total),
      }];
    })),
  ])) as Record<number, Record<AbilityBand, Record<CareerTier, string>>>;
  const sourceCounts = sourceRow(simulations, "qualifiersBySource");
  const sourceTotal = Object.values(sourceCounts).reduce((sum, value) => sum + value, 0);
  const championshipSources = Object.fromEntries(
    (Object.keys(sourceCounts) as ChampionshipSource[])
      .map((source) => [source, pct(sourceCounts[source], sourceTotal)]),
  ) as Record<ChampionshipSource, string>;
  const reachFor = (group: SimulatedCareer[], ability: AbilityBand) => {
    const band = group.filter((career) => career.ability === ability);
    return pct(band.filter((career) => career.firstProSeason != null).length, band.length);
  };
  const medianAceFor = (group: SimulatedCareer[]) => fixed(median(
    group
      .filter((career) => career.ability === "ace")
      .map(activeSeasonsToPro)
      .filter((value): value is number => value != null),
  ), 1);
  const fieldSensitivity = [20, 30, 50, 100, 500].map((fieldSize) => {
    const group = allCareers(evaluation.filter((simulation) => simulation.config.fieldSize === fieldSize));
    return `${fieldSize}: Ace ${reachFor(group, "ace")}, Rusty ${reachFor(group, "rusty")}, Ace median ${medianAceFor(group)}`;
  }).join("; ");
  const ratioSensitivity = [0.25, 0.5, 0.8].map((ratio) => {
    const group = allCareers(evaluation.filter((simulation) => simulation.config.humanRatio === ratio));
    return `${Math.round(ratio * 100)}% humans: Ace ${reachFor(group, "ace")}, Rusty ${reachFor(group, "rusty")}, Ace median ${medianAceFor(group)}`;
  }).join("; ");
  const activitySensitivity = (["full", "occasional", "returning"] as const).map((activity) => {
    const group = careers.filter((career) => career.activity === activity);
    return `${activity}: Ace ${reachFor(group, "ace")}, Rusty ${reachFor(group, "rusty")}, Ace median ${medianAceFor(group)}`;
  }).join("; ");
  return {
    name: candidate.name,
    model: candidate.model,
    botFieldModel: candidate.botFieldModel,
    movementConfirmation: candidate.movementConfirmation ?? "none",
    movementShape: candidate.promotionModel === "rolling"
      ? [
        `rolling-${candidate.rollingWindow ?? 2}`,
        candidate.rollingPromotionFloor != null ? `floor-${candidate.rollingPromotionFloor}` : null,
        candidate.rollingPromotionCarryWeight != null ? `carry-${candidate.rollingPromotionCarryWeight}` : null,
        candidate.humanMovementLimitModel && candidate.humanMovementLimitModel !== "none"
          ? candidate.humanMovementLimitModel
          : candidate.humanMovementCap != null
            ? `cap-${candidate.humanMovementCap}`
            : null,
      ].filter(Boolean).join("+")
      : candidate.humanMovementCap != null
        ? `slot-cap-${candidate.humanMovementCap}`
        : "slot",
    aceProc: reach(ace),
    scratchPro: reach(scratch),
    rustyPro: reach(rusty),
    aceMedianToPro: fixed(median(ace.map(activeSeasonsToPro).filter((value): value is number => value != null)), 1),
    medianToPro,
    reversal: pct(
      reversals.reduce((sum, value) => sum + value.reversed, 0),
      reversals.reduce((sum, value) => sum + value.eligible, 0),
    ),
    oscillation: pct(careers.filter(hasLongOscillation).length, careers.length),
    survival: pct(
      survival.reduce((sum, value) => sum + value.survived, 0),
      survival.reduce((sum, value) => sum + value.eligible, 0),
    ),
    aceSurvival: survivalFor(ace),
    scratchSurvival: survivalFor(scratch),
    rustySurvival: survivalFor(rusty),
    newCatchup,
    returnRecovery: fixed(median(
      careers.map(returningRecovery).filter((value): value is number => value != null),
    ), 1),
    tieExpansion: candidateMovement.rate,
    humanChampionshipShare: pct(humanChampionshipSlots, championshipSlots),
    maxFiveHundredSlots: Math.max(...fiveHundredSnapshots.map((snapshot) => snapshot.baseMovementSlots)),
    maxHumanPromoted,
    maxHumanRelegated,
    warningFrequency: pct(warningCount, activeHistories.length),
    capHoldFrequency: pct(capHoldCount, activeHistories.length),
    tierDistributions,
    championshipSources,
    strongChallengerMedian: median(strongChallenger),
    weakProMedian,
    overlap: pct(overlapCount, strongChallenger.length),
    fieldSensitivity,
    ratioSensitivity,
    activitySensitivity,
  };
}

function bandAverage(bank: ScoreBank, ability: AbilityBand): number {
  return TENDENCIES.reduce((sum, tendency) => sum + (bank.means.get(`${ability}:${tendency}`) ?? 0), 0) / TENDENCIES.length;
}

function buildReport(
  options: CliOptions,
  bank: ReturnType<typeof buildScoreBank>,
  correctedBank: ReturnType<typeof buildScoreBank>,
  moderateCorrectedBank: ReturnType<typeof buildScoreBank>,
  wideCorrectedBank: ReturnType<typeof buildScoreBank>,
  baseline: CareerSimulation[],
  candidates: CandidateSummary[],
  finalistValidations: CandidateSummary[],
): string {
  const careers = allCareers(baseline);
  const sixteen = baseline.filter((simulation) => simulation.config.seasons === 16);
  const sixteenCareers = allCareers(sixteen);
  const movement = movementSummary(baseline);
  const reversals = careers.map(immediateReversal);
  const survival = careers.map(proSurvival);
  const weak = sixteenCareers.filter((career) => career.ability === "rusty");
  const returnRecovery = sixteenCareers.map(returningRecovery).filter((value): value is number => value != null);
  const oscillators = careers.filter(hasLongOscillation);
  const sources = sourceRow(baseline, "qualifiersBySource");
  const humanSources = sourceRow(baseline, "humanQualifiersBySource");

  const strongChallenger = sixteenCareers
    .filter((career) => career.ability === "ace" && finalTier(career) === "challenger")
    .map((career) => career.histories.at(-1)?.tourRating ?? 0);
  const weakPro = sixteenCareers
    .filter((career) => career.ability === "rusty" && finalTier(career) === "pro")
    .map((career) => career.histories.at(-1)?.tourRating ?? 0);
  const weakProMedian = median(weakPro);
  const challengerOverlap = weakProMedian == null
    ? 0
    : strongChallenger.filter((rating) => rating >= weakProMedian).length;

  const benchmarkByAbility = new Map<AbilityBand, number>();
  for (const ability of ABILITY_BANDS) {
    const finals = sixteenCareers
      .filter((career) => career.ability === ability && career.activity === "full")
      .map((career) => career.histories.at(-1)?.tourRating ?? 0);
    benchmarkByAbility.set(ability, median(finals) ?? 0);
  }
  const catchupByAbility = new Map<AbilityBand, number[]>();
  for (const ability of ABILITY_BANDS) {
    const target = (benchmarkByAbility.get(ability) ?? 0) * 0.8;
    const values = sixteenCareers
      .filter((career) => career.ability === ability && career.activity === "full")
      .map((career) => career.histories.find((history) => history.tourRating >= target)?.season)
      .filter((value): value is number => value != null);
    catchupByAbility.set(ability, values);
  }

  const spike = baseline.filter((simulation) => simulation.config.fieldSize === 500);
  const spikeSnapshots = spike.flatMap((simulation) => simulation.tierSnapshots);
  const spikeSlots = spikeSnapshots.map((snapshot) => snapshot.baseMovementSlots);
  const spikeMaxHumans = Math.max(...spikeSnapshots.map((snapshot) => snapshot.humanCount));
  const spikeMaxField = Math.max(...spikeSnapshots.map((snapshot) => snapshot.fieldSize));
  const policyGap = (bank.means.get("rusty:balanced") ?? 0) - (bank.means.get("ace:situational") ?? 0);
  const baselineWeakReach = weak.length
    ? weak.filter((career) => career.firstProSeason != null).length / weak.length
    : 0;
  const fieldBehavior = [20, 30, 50, 100, 500].map((fieldSize) => {
    const simulations = sixteen.filter((simulation) => simulation.config.fieldSize === fieldSize);
    const fieldCareers = allCareers(simulations);
    const counts: Record<CareerTier, number> = { local: 0, challenger: 0, pro: 0 };
    for (const career of fieldCareers) counts[finalTier(career)]++;
    const snapshots = simulations.flatMap((simulation) => simulation.tierSnapshots);
    return {
      fieldSize,
      total: fieldCareers.length,
      counts,
      maxSlots: Math.max(...snapshots.map((snapshot) => snapshot.baseMovementSlots)),
      maxCohort: Math.max(...snapshots.map((snapshot) => snapshot.fieldSize)),
    };
  });
  const totalChampionshipQualifiers = Object.values(sources).reduce((sum, value) => sum + value, 0);
  const moderateAdaptive = candidates.find((candidate) =>
    candidate.name === "E moderate signal + D3 adaptive · scaled");

  const lines: string[] = [
    "# Career Mode simulator report",
    "",
    "Status: simulator/formula gate only. No production Career Mode schema, API, UI, cron, or deployment is included.",
    "",
    "Gate 3 follow-up: the product owner subsequently approved Candidate H's wide 0.65/0.14/0.02 ability calibration. The complete five-part freeze proposal and later sensitivity evidence are in [`career-formula-freeze.md`](./career-formula-freeze.md). Historical conditional language below is preserved as evidence of the decision that was pending when this report was generated.",
    "",
    "## Reproduction",
    "",
    "```sh",
    `npm run career:simulate -- --seed ${options.seed} --bank-samples ${options.bankSamples}`,
    "```",
    "",
    options.quick
      ? `This smoke report uses explicit seed \`${options.seed}\`, ${options.bankSamples} real-engine rounds per archetype, field sizes 20/500, a 50% human ratio, horizons 4/16, and one deterministic world seed. Run without \`--quick\` for the required matrix.`
      : `The report uses explicit seed \`${options.seed}\`, ${options.bankSamples} real-engine rounds per ability/tendency archetype, field sizes 20/30/50/100/500, human ratios 25%/50%/80%, horizons 4/8/16, and 3 deterministic world seeds.`,
    "",
    "## Engine-backed policy score bank",
    "",
    "| Ability | Conservative | Balanced | Aggressive | Situational |",
    "|---|---:|---:|---:|---:|",
    ...ABILITY_BANDS.map((ability) =>
      `| ${ability} | ${TENDENCIES.map((tendency) => fixed(bank.means.get(`${ability}:${tendency}`) ?? null, 2)).join(" | ")} |`),
    "",
    `Naive-to-strong policy gap (Rusty/Balanced minus Ace/Situational): **${fixed(policyGap, 2)} strokes/round**. Lower scores are better.`,
    "",
    `Ability-ordering check: Scratch/Balanced averages **${fixed(bank.means.get("scratch:balanced") ?? null, 2)}**, while Ace/Balanced averages **${fixed(bank.means.get("ace:balanced") ?? null, 2)}**. A non-positive Ace advantage is a failed ordering check, not something tier multipliers can repair.`,
    "",
    "### Why v5 fails: the engine's decision-EV curve",
    "",
    "A direct engine probe (2,000 rounds/decision, random course+seed) forcing every decision to a single level:",
    "",
    "| Forced decision | Mean rel-to-par | Std | Break-par |",
    "|---|---:|---:|---:|",
    "| all-safe | +2.92 | 2.85 | 11.5% |",
    "| all-normal | +1.54 | 3.56 | 28.4% |",
    "| all-aggressive | +2.26 | 4.12 | 25.9% |",
    "",
    "`normal` is the score-minimising decision; both `safe` (+1.38) and `aggressive` (+0.72) deviations are EV-negative. There is almost no headroom for \"better tactical aggression\" to separate ability bands, and the v5 Ace policy chases (adds aggression when at/above par) — EV-negative — so it scores WORSE than the calmer Scratch. This is an engine truth, not a coding bug: the same effect appears in `scripts/calibrate.ts`, where the strong `good` and `skilled` policies post near-identical average scores.",
    "",
    "### Corrected candidate ability model (error-model)",
    "",
    "One shared near-optimal reference policy (no chasing); ability = a per-band seeded probability of deviating to a worse, EV-negative decision, resolved through the same engine. Tendency only skews WHICH wrong decision is chosen, never the rate.",
    "",
    "| Ability | Conservative | Balanced | Aggressive | Situational |",
    "|---|---:|---:|---:|---:|",
    ...ABILITY_BANDS.map((ability) =>
      `| ${ability} | ${TENDENCIES.map((tendency) => fixed(correctedBank.means.get(`${ability}:${tendency}`) ?? null, 2)).join(" | ")} |`),
    "",
    `Corrected band averages: Rusty **${fixed(bandAverage(correctedBank, "rusty"), 2)}**, Scratch **${fixed(bandAverage(correctedBank, "scratch"), 2)}**, Ace **${fixed(bandAverage(correctedBank, "ace"), 2)}** — monotonic, with an Ace-over-Rusty gap of **${fixed(bandAverage(correctedBank, "rusty") - bandAverage(correctedBank, "ace"), 2)} strokes/round** (v5: ${fixed(bandAverage(bank, "rusty") - bandAverage(bank, "ace"), 2)}, non-monotonic). Within-band tendency spread stays below 0.1 strokes, so tendency is flavour rather than a second skill axis — matching v5's "identity remains separate from decision policy".`,
    "",
    "### Corrected-model signal sensitivity",
    "",
    "These are labelled calibrations of the same decision-error model, not movement rules keyed to hidden cohorts. Movement sees only completed season results.",
    "",
    "| Profile | Rusty errors | Scratch errors | Ace errors | Rusty mean | Scratch mean | Ace mean | Ace–Rusty gap |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    `| standard | 0.42 | 0.18 | 0.05 | ${fixed(bandAverage(correctedBank, "rusty"), 2)} | ${fixed(bandAverage(correctedBank, "scratch"), 2)} | ${fixed(bandAverage(correctedBank, "ace"), 2)} | ${fixed(bandAverage(correctedBank, "rusty") - bandAverage(correctedBank, "ace"), 2)} |`,
    `| moderate | 0.55 | 0.16 | 0.03 | ${fixed(bandAverage(moderateCorrectedBank, "rusty"), 2)} | ${fixed(bandAverage(moderateCorrectedBank, "scratch"), 2)} | ${fixed(bandAverage(moderateCorrectedBank, "ace"), 2)} | ${fixed(bandAverage(moderateCorrectedBank, "rusty") - bandAverage(moderateCorrectedBank, "ace"), 2)} |`,
    `| wide | 0.65 | 0.14 | 0.02 | ${fixed(bandAverage(wideCorrectedBank, "rusty"), 2)} | ${fixed(bandAverage(wideCorrectedBank, "scratch"), 2)} | ${fixed(bandAverage(wideCorrectedBank, "ace"), 2)} | ${fixed(bandAverage(wideCorrectedBank, "rusty") - bandAverage(wideCorrectedBank, "ace"), 2)} |`,
    "",
    "## Baseline progression",
    "",
    "Median active seasons to reach Pro (only careers that reached Pro):",
    "",
    "| Ability / tendency | Conservative | Balanced | Aggressive | Situational |",
    "|---|---:|---:|---:|---:|",
    ...ABILITY_BANDS.map((ability) =>
      `| ${ability} | ${TENDENCIES.map((tendency) => fixed(median(careers
        .filter((career) => career.ability === ability && career.tendency === tendency)
        .map(activeSeasonsToPro)
        .filter((value): value is number => value != null)), 1)).join(" | ")} |`),
    "",
    "Final human tier distribution by ability:",
    "",
    "| Horizon | Ability | Local | Challenger | Pro |",
    "|---:|---|---:|---:|---:|",
    ...[4, 8, 16].flatMap((horizon) => ABILITY_BANDS.map((ability) => {
      const distribution = tierDistribution(baseline, horizon, ability);
      const total = distribution.local + distribution.challenger + distribution.pro;
      return `| ${horizon} | ${ability} | ${pct(distribution.local, total)} | ${pct(distribution.challenger, total)} | ${pct(distribution.pro, total)} |`;
    })),
    "",
    "Pro reach rate within 16 seasons by policy archetype:",
    "",
    "| Ability / tendency | Conservative | Balanced | Aggressive | Situational |",
    "|---|---:|---:|---:|---:|",
    ...ABILITY_BANDS.map((ability) =>
      `| ${ability} | ${TENDENCIES.map((tendency) => {
        const group = sixteenCareers.filter((career) => career.ability === ability && career.tendency === tendency);
        return pct(group.filter((career) => career.firstProSeason != null).length, group.length);
      }).join(" | ")} |`),
    "",
    `- Weak-player variance: **${pct(weak.filter((career) => career.firstProSeason != null).length, weak.length)}** of Rusty careers reached Pro within 16 seasons.`,
    `- Pro one-season survival: **${pct(survival.reduce((sum, value) => sum + value.survived, 0), survival.reduce((sum, value) => sum + value.eligible, 0))}**.`,
    `- Immediate promote-then-relegate reversal: **${pct(reversals.reduce((sum, value) => sum + value.reversed, 0), reversals.reduce((sum, value) => sum + value.eligible, 0))}**.`,
    `- Longer alternating movement sequence: **${pct(oscillators.length, careers.length)}** of careers.`,
    `- Returning-player recovery to pre-absence Tour Rating: median **${fixed(median(returnRecovery), 1)} active seasons** after return (${returnRecovery.length} measurable careers).`,
    `- New-player catch-up to 80% of the established same-ability 16-season median: Rusty **${fixed(median(catchupByAbility.get("rusty") ?? []), 1)}**, Scratch **${fixed(median(catchupByAbility.get("scratch") ?? []), 1)}**, Ace **${fixed(median(catchupByAbility.get("ace") ?? []), 1)}** seasons.`,
    "",
    "## Rating overlap",
    "",
    `Strong Challenger (Ace) median: **${fixed(median(strongChallenger), 1)}**. Weak Pro (Rusty) median: **${fixed(weakProMedian, 1)}**. **${pct(challengerOverlap, strongChallenger.length)}** of strong Challengers meet or exceed the weak-Pro median.`,
    "",
    "## Movement boundaries and large fields",
    "",
    `Across ${movement.snapshots.toLocaleString()} tier-seasons, exact boundary ties expanded movement in **${movement.rate}**, adding **${fixed(movement.averageExtra, 2)}** slots on average when expansion occurred.`,
    "",
    `In the required 500-player scenarios, the largest human tier population was **${spikeMaxHumans}**, the largest cohort was **${spikeMaxField}**, and baseline movement slots ranged from **${Math.min(...spikeSlots)} to ${Math.max(...spikeSlots)}** per direction. This confirms the mechanical result can approach 100 simultaneous movers; product judgment on bounded movement/flights remains necessary.`,
    "",
    "Sixteen-season population behavior by configured cohort floor:",
    "",
    "| Field floor | Simulated humans | Local | Challenger | Pro | Largest cohort | Max base slots/direction |",
    "|---:|---:|---:|---:|---:|---:|---:|",
    ...fieldBehavior.map((field) =>
      `| ${field.fieldSize} | ${field.total} | ${pct(field.counts.local, field.total)} | ${pct(field.counts.challenger, field.total)} | ${pct(field.counts.pro, field.total)} | ${field.maxCohort} | ${field.maxSlots} |`),
    "",
    "## Championship qualification",
    "",
    "| Source | All qualifiers | Human qualifiers |",
    "|---|---:|---:|",
    ...(["pro-top-six", "pro-event-winner", "pro-passdown", "challenger-top-two", "elite-bot"] as ChampionshipSource[])
      .map((source) => `| ${source} | ${sources[source]} (${pct(sources[source], totalChampionshipQualifiers)}) | ${humanSources[source]} |`),
    "",
    "## Explicit candidates",
    "",
    "Every row runs the same field-size, human-ratio, horizon, and seed matrix as the baseline. \"Uniform\" preserves the original simulator field; \"scaled\" uses Local 60/35/5, Challenger 10/45/45, and Pro 2/28/70 Rusty/Scratch/Ace bot mixes. All candidates share world seeds and score banks so the labelled dimensions are isolated.",
    "",
    "### Operational interpretation of the v5 targets",
    "",
    "V5 deliberately uses qualitative targets. To prevent post-hoc declarations, this report treats a freeze candidate as credible only when the complete matrix shows: Ace reach at least 55% with a 4–8 active-season median; Rusty reach at most 10%; Ace > Scratch > Rusty with at least a 10-point Ace/Scratch gap; first-season Pro survival between 70% and 95% (credible but not structurally guaranteed); immediate reversal at most 15%; longer oscillation reported and materially below the v5 baseline; returning-player rating recovery within eight active seasons; and a bounded large-field human movement rule with exact ties still honored. V5 does not assign numeric limits to oscillation or large-field movement, so those remain visible product judgments rather than invented pass/fail gates.",
    "",
    "### Progression and rating",
    "",
    "| Candidate | Model | Field | Movement | Confirmation | Ace→Pro | Scratch→Pro | Rusty→Pro | Ace median | Reversal | Oscillation | Pro survival | Ace survival | Scratch survival | Rusty survival | Strong Chall. | Weak Pro | Overlap |",
    "|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...candidates.map((candidate) =>
      `| ${candidate.name} | ${candidate.model} | ${candidate.botFieldModel} | ${candidate.movementShape} | ${candidate.movementConfirmation} | ${candidate.aceProc} | ${candidate.scratchPro} | ${candidate.rustyPro} | ${candidate.aceMedianToPro} | ${candidate.reversal} | ${candidate.oscillation} | ${candidate.survival} | ${candidate.aceSurvival} | ${candidate.scratchSurvival} | ${candidate.rustySurvival} | ${fixed(candidate.strongChallengerMedian, 1)} | ${fixed(candidate.weakProMedian, 1)} | ${candidate.overlap} |`),
    "",
    "### Inactivity, ties, Championships, and scale",
    "",
    "| Candidate | Returning recovery | Boundary-tie expansion | Human Championship share | Max raw 500-field slots | Max human promoted | Max human relegated | Warning frequency | Cap-hold frequency |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...candidates.map((candidate) =>
      `| ${candidate.name} | ${candidate.returnRecovery} | ${candidate.tieExpansion} | ${candidate.humanChampionshipShare} | ${candidate.maxFiveHundredSlots} | ${candidate.maxHumanPromoted} | ${candidate.maxHumanRelegated} | ${candidate.warningFrequency} | ${candidate.capHoldFrequency} |`),
    "",
    "### Per-candidate required-metric appendix",
    "",
    ...candidates.flatMap((candidate) => [
      `#### ${candidate.name}`,
      "",
      `Median active seasons to Pro — Rusty ${candidate.medianToPro.rusty}, Scratch ${candidate.medianToPro.scratch}, Ace ${candidate.medianToPro.ace}. New-player catch-up to 80% of established same-ability rating — Rusty ${candidate.newCatchup.rusty}, Scratch ${candidate.newCatchup.scratch}, Ace ${candidate.newCatchup.ace}.`,
      "",
      "| Horizon | Ability | Local | Challenger | Pro |",
      "|---:|---|---:|---:|---:|",
      ...[4, 8, 16].flatMap((horizon) => ABILITY_BANDS.map((ability) => {
        const distribution = candidate.tierDistributions[horizon][ability];
        return `| ${horizon} | ${ability} | ${distribution.local} | ${distribution.challenger} | ${distribution.pro} |`;
      })),
      "",
      `Championship source mix — Pro top six ${candidate.championshipSources["pro-top-six"]}, Pro event winner ${candidate.championshipSources["pro-event-winner"]}, Pro pass-down ${candidate.championshipSources["pro-passdown"]}, Challenger top two ${candidate.championshipSources["challenger-top-two"]}, elite bot ${candidate.championshipSources["elite-bot"]}.`,
      "",
      `Field-size sensitivity — ${candidate.fieldSensitivity}.`,
      "",
      `Human-ratio sensitivity — ${candidate.ratioSensitivity}.`,
      "",
      `Activity sensitivity — ${candidate.activitySensitivity}.`,
      "",
    ]),
    ...(finalistValidations.length ? [
      "",
      "### High-seed finalist validation",
      "",
      "Each finalist is rerun independently at the 16-season horizon with 20 deterministic world seeds across every required field size and human ratio (300 worlds per finalist). This reduces the small-denominator noise visible in three-seed field-20 slices.",
      "",
      ...finalistValidations.flatMap((validation) => [
        `**${validation.name}** — Ace ${validation.aceProc}, Scratch ${validation.scratchPro}, Rusty ${validation.rustyPro}; Ace median ${validation.aceMedianToPro}; reversal ${validation.reversal}; oscillation ${validation.oscillation}; Pro survival ${validation.survival}; max human movement ${validation.maxHumanPromoted} promoted/${validation.maxHumanRelegated} relegated.`,
        "",
        `Field-size sensitivity — ${validation.fieldSensitivity}.`,
        "",
        `Human-ratio sensitivity — ${validation.ratioSensitivity}.`,
        "",
        `Activity sensitivity — ${validation.activitySensitivity}.`,
        "",
      ]),
    ] : []),
    "",
    "Reading the matrix: a healthy candidate shows Ace→Pro clearly above Scratch above Rusty, low Rusty→Pro, low reversal, credible Pro survival, and Ace median seasons near the 4–8 target.",
    "",
    "## Audit notes and disclosures",
    "",
    "Correctness items confirmed against v5: event points (unrounded percentile, averaged ties, no-show zero), best-3-of-4, active≥3, season tiebreak chain, symmetric movement with exact boundary-tie expansion, Local floor / Pro ceiling, inactivity (first preserve, second Pro→Challenger, never below Challenger, reset on activity), Tour Rating (tier-weighted percentile, best-6-of-8, inactive occupies a slot at zero), Championship qualification with Pro pass-down. Focused unit tests cover each. The report reproduces byte-identically from the documented seed.",
    "",
    "Honest limitations that temper the headline numbers:",
    "",
    "- **Uniform remains the untouched baseline; tier scaling is only a labelled candidate.** The scaled mix is static field assignment (consistent with v5's bot persistence boundary), not a simulation of autonomous bot careers. Its exact 60/35/5, 10/45/45, and 2/28/70 weights are proposed calibration values, not frozen product rules.",
    "- **Every candidate now runs the complete matrix.** Candidate reach/survival/reversal figures use the 16-season slice; tie, Championship, and scale figures use all matching horizons. This avoids the prior field-50-only comparison but still means those metric families use the population appropriate to the question.",
    "- **The 500-player \"~100 movers\" are cohort-level and bot-dominated.** With ≤400 humans spread across three tiers, most of a 500 cohort is bots, so the ~100 promoted/relegated are mostly bots. The product concern (a cohort where ~100 move at once) stands; the human-facing count is smaller.",
    "- **Bot results are sampled from the score bank, not fresh rounds.** A deliberate speed trade-off; settlement-scale tests should also run direct complete rounds before production.",
    "",
    "## Formula recommendation",
    "",
    `**Do not freeze the v5 baseline.** The failure is not the 20% movement rate — it is the ability model. v5's twelve policies give a non-monotonic band ordering (Ace ${fixed(bandAverage(bank, "ace"), 2)} vs Scratch ${fixed(bandAverage(bank, "scratch"), 2)}) and a naive/strong gap of only **${fixed(policyGap, 2)} strokes**, because the engine's EV floor is \"normal\" and tactical aggression is EV-negative. No movement rate or tier multiplier can repair a skill signal that does not exist, which is why the v5-model rows in the matrix stay poor at every movement rate.`,
    "",
    "**Recommended direction: the corrected error-model** — one shared near-optimal reference policy plus a per-band seeded decision-error rate (Rusty 0.42 / Scratch 0.18 / Ace 0.05). It is the smallest engine-consistent change that produces a monotonic, ~0.9-stroke skill gradient with every competitor still resolving through the same server-authoritative engine, deterministic replay intact, no hidden shot-quality bonus, no arbitrary strokes, and bot identity/tendency kept separate from ability.",
    "",
    "**Tier-scaled fields do not solve the residual progression problem.** At corrected 20%, moving from uniform to scaled changes Ace→Pro from 74.0% to 71.7%, Rusty→Pro from 32.9% to 33.2%, reversal from 22.0% to 25.2%, and survival from 81.4% to 77.0%. The harder Challenger/Pro fields are offset by an easier Local field, and a fixed percentage still advances a cohort share every season. Pro strength affects survival after arrival but cannot stop a competitor from first crossing the Challenger boundary. The earlier claim that uniform fields were probably the main cause is therefore rejected by this experiment.",
    "",
    "**The original standard-signal candidates do not clear every v5 target.** The best slot compromise remains **Corrected 15% · tier-scaled**, but a 21.1% weak-player Pro rate and 38.9% longer-term oscillation are too high. Corrected 12% is more selective but still leaves weak advancement above the operational rare threshold and pushes Ace to the edge of the timing target.",
    "",
    "**Symmetric two-season confirmation also fails.** It removes immediate reversal by construction and suppresses Rusty→Pro to ~1%, but over-corrects Ace→Pro to 11–15% with an 11-season median. Making both boundaries equally sticky produces stability by largely stopping progression, not by improving separation.",
    "",
    "**Candidate A (rolling form) is the strongest new direction, but still not a freeze.** Rolling-2 at 75/25 is selective (Rusty 8.3%) but misses the strong-player timing target (Ace 45.5%, median 9). Relaxing to 70/30 moves Ace to 58.1% with a median of 8, keeps Rusty at 16.0%, eliminates immediate reversal, and lowers oscillation to 28.3%. However, resetting the window on tier change guarantees one-season Pro survival (100%), and 16% weak advancement is not unambiguously \"rare.\" Rolling-3 over-corrects (Ace 20.9%, median 11).",
    "",
    "**Candidate B (relegation protection) fails.** One-shot promotion plus a protected first weak season eliminates immediate reversal but lets weak careers accumulate upward: Rusty reaches Pro 47.5% at 20% movement and 33.5% at 15%. The warning state appears in 12.2% and 8.6% of active human seasons respectively. Stability comes from retention rather than better selection.",
    "",
    "**Candidate C (bounded human movement) solves scale but starves progression.** Caps of 4/8/12 keep actual human movement near their soft boundary even in 500-player fields, but Ace reaches Pro only 25.2%/36.9%/43.6%, with medians of 9/9/8. Bots do not consume the cap and exact ties remain together, but a single global cap is too blunt across 20- and 500-player cohorts.",
    "",
    "**Candidate D also fails.** Combining rolling-2 70/30 with a soft human cap of 20 bounds actual movement at 20 per direction, but drops Ace to 49.8% with a median of 9 seasons. It improves Rusty to 12.4% and oscillation to 21.0%, yet misses the strong-player 4–8-season target. The failed B protection rule was deliberately not stacked into D.",
    "",
    "**Transition carryover resolves the artificial survival result only when it is bounded near neutral.** A neutral promotion prior lowers structural 100% survival to 88.7%, while half/full carry still guarantee survival and materially increase weak upward accumulation. A quarter-weight prior is the useful middle ground once paired with a promotion-quality floor.",
    "",
    "**Observed-performance guards cannot rescue the standard skill signal by themselves.** Requiring both rolling seasons to clear a percentile floor improves selectivity, but the strict versions that approach rare weak progression push Ace beyond the 8-season target. This demonstrates that movement was being asked to manufacture separation the underlying outcomes did not contain.",
    "",
    moderateAdaptive
      ? `**E moderate signal + D3 adaptive is an aggregate pass but fails robustness.** Its aggregate is Ace ${moderateAdaptive.aceProc}, Scratch ${moderateAdaptive.scratchPro}, Rusty ${moderateAdaptive.rustyPro}, Ace median ${moderateAdaptive.aceMedianToPro}, reversal ${moderateAdaptive.reversal}, oscillation ${moderateAdaptive.oscillation}, and survival ${moderateAdaptive.survival}. However, its 500-player, 80%-human, and fully-active Ace medians reach 9 seasons, so the complete evidence does not support freezing it.`
      : "**The moderate-signal adaptive candidate was not generated; do not freeze formulas.**",
    "",
    finalistValidations.length
      ? "**H is the mechanical freeze recommendation; G is rejected.** Both use corrected 0.65/0.14/0.02 error rates, two active-season percentiles, a 0.32 relegation threshold, quarter-weight promotion carry, and clamp(ceil(0.20 × active humans), 4, 40) soft movement limits. G's 0.55 floor is faster but leaves fully active Rusty reach at 13.3%. H promotes at average ≥0.65 only when both seasons are ≥0.58; independent validation yields Ace 62.4%/median 8, Scratch 48.7%, Rusty 7.0%, reversal 9.2%, oscillation 29.3%, and survival 91.3%. Its fully active slice is Ace 73.8%/median 8 and Rusty 9.9%; its 500-player slice is Ace 62.1%/median 8 and Rusty 6.5%. The field-20 Ace median is 9, one season outside the approximate range, while every human-ratio slice and the explicitly targeted consistently-active slice is 8 or faster."
      : "**Finalists G and H were not independently validated; formulas cannot freeze.**",
    "",
    "**Freeze recommendation remains conditional on one explicit product decision:** whether the wide 0.65/0.14/0.02 decision-error calibration is an acceptable representation of Rusty/Scratch/Ace rival skill. The simulator shows that standard-signal movement rules cannot simultaneously produce approximately 4–8-season strong progression and rare weak progression; widening observed outcome separation can. This is now an ability-calibration choice, not an unresolved movement-formula search.",
    "",
    "Decision options:",
    "",
    "1. **Approve wide skill calibration and freeze H (recommended).** This is the only tested path that clears the aggregate, fully active, high-human-ratio, and 500-player checks together. Exact movement is the H formula above; exact error rates are 0.65/0.14/0.02.",
    "2. **Keep moderate calibration and relax “rare” to roughly 15%.** F3 moderate reaches Ace 67.6%, Scratch 54.6%, Rusty 14.9%, median 7, reversal 9.4%, survival 91.1%, with the same 40-person soft scale bound. This preserves a less extreme Rusty error rate but explicitly weakens the fairness target.",
    "3. **Keep the standard calibration and relax strong-player timing.** The selective standard-signal rolling candidate holds Rusty to 8.3% but reaches only 45.5% of Aces with a 9-season median. This preserves the original corrected rates but explicitly moves the progression target.",
    "",
    "Until option 1 is approved, H is simulator-validated but the production formulas remain unfrozen.",
    "",
    "Compressing Tour Rating multipliers narrows displayed rating gaps but leaves progression byte-identical, as expected.",
    "",
    "This remains a proposed model requiring explicit approval. The reference policy and the error rates (0.42/0.18/0.05) are tuning knobs, not frozen values.",
    "",
    "## Risks and unresolved questions",
    "",
    "- The corrected model expresses ability as decision-error frequency through the real engine — no hidden shot-quality bonuses, no Career-only probability tables. The error rates (0.42/0.18/0.05) and the reference policy are proposed values that need approval and further sensitivity work.",
    "- Tier-scaled fields were measured and did not repair weak advancement; their proposed mix should not be frozen.",
    "- Rolling windows implicitly protect a newly promoted player until enough active seasons exist in the new tier; the 100% one-season survival metric is structural, not evidence that Pro difficulty is calibrated perfectly.",
    "- A fixed human cap behaves very differently at field sizes 20 and 500. A production cap would likely need a bounded percentage or size bands, which was not silently introduced here.",
    "- H clears the mechanical evaluation after independent validation; accepting its wider bot-skill calibration is the remaining product decision before formula freeze.",
    "- Bot results use deterministic samples from real-engine score banks for speed; settlement-scale tests should also run direct complete rounds.",
    "- The 500-player case exposes the product effect of a cohort where ~100 move at once even when the mathematics stay stable; bounded slots or flights may be preferable.",
    "- Tour Rating overlap should remain visible: a strong Challenger should approach a weak Pro, while tier multipliers should not make weak Pro performance untouchable.",
    "- **Championship and regular-season concurrency still requires human playtesting.** A simulator can measure workload and eligibility but cannot decide whether a simultaneous Championship feels like a delightful bonus or an unwanted second obligation.",
    "",
    "## Gate 3 freeze-stage follow-up",
    "",
    "Candidate H's remaining ability-calibration decision was approved. H is now packaged as `career-v1-freeze-candidate`; event points, tier strength, Tour Rating, and Legacy Points receive their final sensitivity analysis in [`career-formula-freeze.md`](./career-formula-freeze.md). This section supersedes only the report's earlier conditional status—it does not remove or rewrite any rejected-candidate evidence.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
if (!Number.isFinite(options.bankSamples) || options.bankSamples < 1) {
  throw new Error("--bank-samples must be a positive number");
}

console.log(`Building real-engine score banks (${options.bankSamples} rounds/archetype)…`);
const bank = buildScoreBank(options.seed, options.bankSamples, "v5");
const correctedBank = buildScoreBank(options.seed, options.bankSamples, "error");
const moderateErrorRates: CareerErrorRates = { rusty: 0.55, scratch: 0.16, ace: 0.03 };
const wideErrorRates: CareerErrorRates = { rusty: 0.65, scratch: 0.14, ace: 0.02 };
const moderateCorrectedBank = buildScoreBank(options.seed, options.bankSamples, "error", moderateErrorRates);
const wideCorrectedBank = buildScoreBank(options.seed, options.bankSamples, "error", wideErrorRates);
const fieldSizes = options.quick ? [20, 500] : [20, 30, 50, 100, 500];
const humanRatios = options.quick ? [0.5] : [0.25, 0.5, 0.8];
const horizons = options.quick ? [4, 16] : [4, 8, 16];
const worldSeeds = options.quick ? ["a"] : ["a", "b", "c"];
const baseline: CareerSimulation[] = [];

for (const fieldSize of fieldSizes) {
  for (const humanRatio of humanRatios) {
    for (const seasons of horizons) {
      for (const worldSeed of worldSeeds) {
        baseline.push(simulateCareerWorld({
          seed: `${options.seed}:baseline:${worldSeed}:f${fieldSize}:r${humanRatio}:s${seasons}`,
          fieldSize,
          humanRatio,
          seasons,
          scoreBank: bank,
        }));
      }
    }
  }
}

const baselineMult = BASELINE_TIER_MULTIPLIER;
const compressedMult = { local: 1, challenger: 1.4, pro: 2 };
const candidateConfigs: Candidate[] = [
  // v5 locked baseline — the thing under review. NOT recommended for freezing.
  { name: "v5 20% · uniform", model: "v5", botFieldModel: "uniform", movementRate: 0.2, multipliers: baselineMult },
  { name: "v5 20% · scaled", model: "v5", botFieldModel: "tier-scaled", movementRate: 0.2, multipliers: baselineMult },
  // Corrected-model uniform/scaled pairs isolate the field-strength effect.
  { name: "Corrected 20% · uniform", model: "error", botFieldModel: "uniform", movementRate: 0.2, multipliers: baselineMult },
  { name: "Corrected 20% · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.2, multipliers: baselineMult },
  { name: "Corrected 12% · uniform", model: "error", botFieldModel: "uniform", movementRate: 0.12, multipliers: baselineMult },
  { name: "Corrected 12% · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.12, multipliers: baselineMult },
  { name: "Corrected 20% compressed · uniform", model: "error", botFieldModel: "uniform", movementRate: 0.2, multipliers: compressedMult },
  { name: "Corrected 20% compressed · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.2, multipliers: compressedMult },
  // New movement-rate candidates requested by the handoff.
  { name: "Corrected 15% · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult },
  { name: "Corrected 18% · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.18, multipliers: baselineMult },
  // Symmetric confirmation makes both boundaries sticky rather than protecting
  // promotion while leaving relegation one-shot.
  { name: "Corrected 20% symmetric · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.2, multipliers: baselineMult, movementConfirmation: "symmetric" },
  { name: "Corrected 18% symmetric · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.18, multipliers: baselineMult, movementConfirmation: "symmetric" },
  // Candidate A: sustained percentile form; inactive seasons are skipped.
  { name: "A rolling-2 top quartile · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.75, rollingRelegateThreshold: 0.25 },
  { name: "A rolling-2 70/30 · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.7, rollingRelegateThreshold: 0.3 },
  { name: "A rolling-3 top quartile · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 3, rollingMinEntries: 3, rollingPromoteThreshold: 0.75, rollingRelegateThreshold: 0.25 },
  // A2: carry one bounded evidence item into the promoted tier. Weight 0 is
  // neutral probation; 0.5 retains half of the prior-tier signal; 1 retains
  // the full rolling average. Relegation and inactivity tier changes still reset.
  { name: "A2 rolling-2 70/30 + neutral promotion prior · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.7, rollingRelegateThreshold: 0.3, rollingPromotionCarryWeight: 0 },
  { name: "A2 rolling-2 70/30 + half promotion carry · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.7, rollingRelegateThreshold: 0.3, rollingPromotionCarryWeight: 0.5 },
  { name: "A2 rolling-2 70/30 + full promotion carry · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.7, rollingRelegateThreshold: 0.3, rollingPromotionCarryWeight: 1 },
  // B2: separation based only on observed sustained finishes. A great result
  // cannot mask a below-floor companion season, and the relegation guard is
  // the symmetric mirror.
  { name: "B2 rolling-2 68/32 + 55/45 quality guard · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.68, rollingRelegateThreshold: 0.32, rollingPromotionFloor: 0.55, rollingRelegationCeiling: 0.45 },
  { name: "B2 rolling-2 67/33 + 60/40 quality guard · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.67, rollingRelegateThreshold: 0.33, rollingPromotionFloor: 0.6, rollingRelegationCeiling: 0.4 },
  { name: "B2 rolling-2 65/35 + promotion floor 55 · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.65, rollingRelegateThreshold: 0.35, rollingPromotionFloor: 0.55 },
  // Candidate B: one-shot promotion, two consecutive weak finishes to relegate.
  { name: "B 20% relegation protection · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.2, multipliers: baselineMult, movementConfirmation: "relegation-protection" },
  { name: "B 15% relegation protection · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, movementConfirmation: "relegation-protection" },
  // Candidate C: full-field placement still qualifies; at most four humans per
  // direction move in a cohort, with exact ties allowed through the soft cap.
  { name: "C 15% human cap 4 · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, humanMovementCap: 4 },
  { name: "C 15% human cap 8 · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, humanMovementCap: 8 },
  { name: "C 15% human cap 12 · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, humanMovementCap: 12 },
  // C2: adaptive caps leave normal cohorts effectively unconstrained and grow
  // sublinearly during a viral spike. Exact ties still pass the soft boundary.
  { name: "C2 rolling-2 70/30 + sqrt human limit · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.7, rollingRelegateThreshold: 0.3, humanMovementLimitModel: "sqrt", humanMovementLimitMin: 4, humanMovementLimitScale: 2, humanMovementLimitMax: 40 },
  { name: "C2 rolling-2 70/30 + 15%-cap-32 human limit · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.7, rollingRelegateThreshold: 0.3, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.15, humanMovementLimitMax: 32 },
  // D2 combines transition evidence with promotion-only sustained quality. The
  // relegation side deliberately has no consistency ceiling: adding one would
  // make the neutral prior protect the first promoted season again.
  { name: "D2 rolling-2 65/35 + floor 55 + neutral prior · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.65, rollingRelegateThreshold: 0.35, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0 },
  { name: "D2 rolling-2 67/33 + floor 55 + neutral prior · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.67, rollingRelegateThreshold: 0.33, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0 },
  { name: "D2 rolling-2 67/33 + floor 55 + quarter carry · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.67, rollingRelegateThreshold: 0.33, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25 },
  { name: "D2 rolling-2 66/34 + floor 58 + quarter carry · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.66, rollingRelegateThreshold: 0.34, rollingPromotionFloor: 0.58, rollingPromotionCarryWeight: 0.25 },
  { name: "D2 rolling-2 65/35 + floor 60 + quarter carry · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.65, rollingRelegateThreshold: 0.35, rollingPromotionFloor: 0.6, rollingPromotionCarryWeight: 0.25 },
  { name: "D3 rolling-2 67/33 + floor 55 + quarter carry + sqrt limit · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.67, rollingRelegateThreshold: 0.33, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "sqrt", humanMovementLimitMin: 4, humanMovementLimitScale: 2, humanMovementLimitMax: 40 },
  { name: "D3 rolling-2 67/33 + floor 55 + quarter carry + 15%-cap-32 · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.67, rollingRelegateThreshold: 0.33, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.15, humanMovementLimitMax: 32 },
  // E: sensitivity check on the corrected model's explicitly unfrozen error
  // rates. Movement still consumes only observed results; cohort labels never
  // enter the movement rule.
  { name: "E moderate signal + D2 66/34 floor 58 quarter carry · scaled", model: "error", errorProfile: "moderate", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.66, rollingRelegateThreshold: 0.34, rollingPromotionFloor: 0.58, rollingPromotionCarryWeight: 0.25 },
  { name: "E wide signal + D2 66/34 floor 58 quarter carry · scaled", model: "error", errorProfile: "wide", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.66, rollingRelegateThreshold: 0.34, rollingPromotionFloor: 0.58, rollingPromotionCarryWeight: 0.25 },
  { name: "E moderate signal + D3 adaptive · uniform", model: "error", errorProfile: "moderate", botFieldModel: "uniform", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.66, rollingRelegateThreshold: 0.34, rollingPromotionFloor: 0.58, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.15, humanMovementLimitMax: 32 },
  { name: "E moderate signal + D3 adaptive · scaled", model: "error", errorProfile: "moderate", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.66, rollingRelegateThreshold: 0.34, rollingPromotionFloor: 0.58, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.15, humanMovementLimitMax: 32 },
  // F targets the failed fully-active/500-player slices rather than the
  // aggregate: slightly looser observed-performance gates and a 40-person soft
  // ceiling, using the wide signal's remaining weak-progression margin.
  { name: "F moderate signal 64/36 floor 55 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "moderate", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.64, rollingRelegateThreshold: 0.36, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  { name: "F wide signal 65/35 floor 55 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "wide", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.65, rollingRelegateThreshold: 0.35, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  { name: "F wide signal 64/36 floor 55 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "wide", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.64, rollingRelegateThreshold: 0.36, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  { name: "F2 moderate signal 64/32 floor 55 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "moderate", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.64, rollingRelegateThreshold: 0.32, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  { name: "F2 wide signal 64/32 floor 55 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "wide", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.64, rollingRelegateThreshold: 0.32, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  { name: "F3 moderate signal 65/32 floor 55 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "moderate", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.65, rollingRelegateThreshold: 0.32, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  { name: "F3 wide signal 65/32 floor 55 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "wide", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.65, rollingRelegateThreshold: 0.32, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  { name: "G wide signal 66/32 floor 55 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "wide", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.66, rollingRelegateThreshold: 0.32, rollingPromotionFloor: 0.55, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  { name: "H wide signal 65/32 floor 58 quarter carry + 20%-cap-40 · scaled", model: "error", errorProfile: "wide", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.65, rollingRelegateThreshold: 0.32, rollingPromotionFloor: 0.58, rollingPromotionCarryWeight: 0.25, humanMovementLimitModel: "percentage-cap", humanMovementLimitMin: 4, humanMovementLimitScale: 0.2, humanMovementLimitMax: 40 },
  // Candidate D combines only the best independent movement shape (rolling-2
  // 70/30) with a restrained large-field cap. Relegation protection is omitted
  // because B made weak upward retention materially worse.
  { name: "D rolling-2 70/30 + human cap 20 · scaled", model: "error", botFieldModel: "tier-scaled", movementRate: 0.15, multipliers: baselineMult, promotionModel: "rolling", rollingWindow: 2, rollingMinEntries: 2, rollingPromoteThreshold: 0.7, rollingRelegateThreshold: 0.3, humanMovementCap: 20 },
];
const scoreBankForCandidate = (candidate: Candidate): ScoreBank =>
  candidate.model === "error"
    ? candidate.errorProfile === "moderate"
      ? moderateCorrectedBank
      : candidate.errorProfile === "wide"
        ? wideCorrectedBank
        : correctedBank
    : bank;

const runCandidateMatrix = (
  candidate: Candidate,
  matrixSeeds: string[],
  matrixHorizons: number[],
  namespace = "candidate",
): CareerSimulation[] => {
  const simulations: CareerSimulation[] = [];
  for (const fieldSize of fieldSizes) {
    for (const humanRatio of humanRatios) {
      for (const seasons of matrixHorizons) {
        for (const worldSeed of matrixSeeds) {
          simulations.push(simulateCareerWorld({
            // Common world seeds isolate candidate effects from different luck.
            seed: `${options.seed}:${namespace}:${worldSeed}:f${fieldSize}:r${humanRatio}:s${seasons}`,
            fieldSize,
            humanRatio,
            seasons,
            movementRate: candidate.movementRate,
            tierMultipliers: candidate.multipliers,
            requireRepeatQualification: candidate.requireRepeatQualification,
            botFieldModel: candidate.botFieldModel,
            movementConfirmation: candidate.movementConfirmation,
            promotionModel: candidate.promotionModel,
            rollingWindow: candidate.rollingWindow,
            rollingPromoteThreshold: candidate.rollingPromoteThreshold,
            rollingRelegateThreshold: candidate.rollingRelegateThreshold,
            rollingMinEntries: candidate.rollingMinEntries,
            rollingPromotionFloor: candidate.rollingPromotionFloor,
            rollingRelegationCeiling: candidate.rollingRelegationCeiling,
            rollingPromotionCarryWeight: candidate.rollingPromotionCarryWeight,
            humanMovementCap: candidate.humanMovementCap,
            humanMovementLimitModel: candidate.humanMovementLimitModel,
            humanMovementLimitMin: candidate.humanMovementLimitMin,
            humanMovementLimitScale: candidate.humanMovementLimitScale,
            humanMovementLimitMax: candidate.humanMovementLimitMax,
            scoreBank: scoreBankForCandidate(candidate),
          }));
        }
      }
    }
  }
  return simulations;
};

const candidateSummaries = candidateConfigs.map((candidate) =>
  summarizeCandidate(candidate, runCandidateMatrix(candidate, worldSeeds, horizons)));

const finalists = candidateConfigs.filter((candidate) =>
  candidate.name === "G wide signal 66/32 floor 55 quarter carry + 20%-cap-40 · scaled"
  || candidate.name === "H wide signal 65/32 floor 58 quarter carry + 20%-cap-40 · scaled");
const validationSeeds = options.quick
  ? ["validation-a"]
  : Array.from({ length: 20 }, (_, index) => `validation-${String(index + 1).padStart(2, "0")}`);
const finalistValidations = finalists.map((finalist) =>
  summarizeCandidate(
    { ...finalist, name: `${finalist.name} (independent 20-seed validation)` },
    runCandidateMatrix(finalist, validationSeeds, [16], "validation"),
  ));

const report = buildReport(
  options,
  bank,
  correctedBank,
  moderateCorrectedBank,
  wideCorrectedBank,
  baseline,
  candidateSummaries,
  finalistValidations,
);
const output = resolve(options.output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, report);
console.log(`Wrote ${output}`);
