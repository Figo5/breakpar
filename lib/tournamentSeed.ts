/**
 * Tournament seed neutralization.
 *
 * A shared seed keeps a tournament fair: identical decisions face identical
 * rolls. The downside is that one extreme seed can move the entire field
 * several strokes in the same direction. We deterministically score a small
 * set of candidate seeds with three established player policies and select the
 * median field mean. This preserves shared-seed fairness while rejecting both
 * the hottest and coldest whole-field outliers.
 */
import type { Course } from "@/data/courses";
import { holeDifficulty, type Conditions, type HoleSpec } from "@/lib/engine/resolveHole";
import { resolveHoleChain, type ChainResult, type Lie } from "@/lib/engine/shots";
import type { Decision, Outcome } from "@/lib/engine/probabilities";
import type { GreenSpeed } from "@/lib/engine/putting";
import {
  eventSeed,
  hashSeed,
  hazardSeed,
  holeShotSeed,
  mulberry32,
  scoringEventSeed,
} from "@/lib/engine/rng";
import { AGGRESSIVE_BUDGET } from "@/lib/holeRead";

export const TOURNAMENT_SEED_CANDIDATES = 31;
const TOURNAMENT_SEED_PANEL_SIZE = 12;

interface SeedState {
  rel: number;
  holesLeft: number;
  aggrLeft: number;
}

interface SeedPanelPlayer {
  readonly archetype: "skilled" | "good" | "greedy" | "naive";
  readonly jitter: number;
  readonly charge: boolean;
}

export interface TournamentSeedAssessment {
  readonly seedKey: string;
  readonly fieldMean: number;
}

function spend(decision: Decision, state: SeedState): Decision {
  if (decision !== "aggressive") return decision;
  if (state.aggrLeft <= 0) return "normal";
  state.aggrLeft--;
  return "aggressive";
}

function seedPanel(): SeedPanelPlayer[] {
  return Array.from({ length: TOURNAMENT_SEED_PANEL_SIZE }, (_, index) => {
    const random = mulberry32(hashSeed(`tournament-neutral-panel:${index}`));
    const archetypeDraw = random();
    return {
      archetype: archetypeDraw < 0.5
        ? "skilled"
        : archetypeDraw < 0.8
          ? "good"
          : archetypeDraw < 0.92
            ? "greedy"
            : "naive",
      jitter: (random() - 0.5) * 0.24,
      charge: random() < 0.5,
    };
  });
}

function panelDecision(
  player: SeedPanelPlayer,
  stage: "tee" | "approach" | "putt" | "scramble",
  hole: HoleSpec,
  difficulty: number,
  lie: Lie | null,
  bucket: "short" | "long" | null,
  state: SeedState,
): Decision {
  if (player.archetype === "naive") return "normal";
  if (player.archetype === "greedy") {
    return stage === "putt" && bucket === "long" ? "normal" : "aggressive";
  }
  if (player.archetype === "good") {
    if (stage === "tee") {
      if (state.aggrLeft > 0 && difficulty < 0.34 + player.jitter) return "aggressive";
      return difficulty > 0.62 + player.jitter ? "safe" : "normal";
    }
    if (stage === "approach") {
      if (lie === "trouble") return "safe";
      if (
        hole.par === 5
        && state.aggrLeft > 0
        && (lie === "dialed" || lie === "fairway")
      ) return "aggressive";
      return state.aggrLeft > 0 && (lie === "dialed" || lie === "fairway")
        ? "aggressive"
        : "normal";
    }
    if (stage === "putt") return bucket === "short" ? "normal" : "safe";
    return "normal";
  }
  if (stage === "tee") {
    const behind = state.rel >= 0;
    let attackBelow = 0.32 + player.jitter;
    if (behind && state.holesLeft <= 9) attackBelow = 0.46 + player.jitter;
    if (behind && state.holesLeft <= 4) attackBelow = 0.62 + player.jitter;
    if (state.rel <= -2 && state.holesLeft <= 6) attackBelow = 0.18 + player.jitter;
    if (state.aggrLeft > 0 && difficulty < attackBelow) return "aggressive";
    return difficulty > 0.6 && !(behind && state.holesLeft <= 4) ? "safe" : "normal";
  }
  if (stage === "approach") {
    if (lie === "trouble") {
      return state.rel >= 1 && state.holesLeft <= 3 && state.aggrLeft > 0
        ? "aggressive"
        : "safe";
    }
    if (
      hole.par === 5
      && state.aggrLeft > 0
      && (lie === "dialed" || lie === "fairway")
      && difficulty < 0.55 + player.jitter
    ) return "aggressive";
    if (lie === "rough") {
      return state.aggrLeft > 0 && state.rel >= 0 && state.holesLeft <= 8
        ? "aggressive"
        : "normal";
    }
    return state.aggrLeft > 0 && difficulty < 0.5 + player.jitter
      ? "aggressive"
      : "normal";
  }
  if (stage === "putt") {
    if (bucket === "short") {
      return player.charge && state.rel >= 0 && state.holesLeft <= 8
        ? "aggressive"
        : "normal";
    }
    return state.rel >= 2 && state.holesLeft <= 3 ? "normal" : "safe";
  }
  return state.rel >= 1 && state.holesLeft <= 6 ? "aggressive" : "normal";
}

function policyScore(seedKey: string, course: Course, player: SeedPanelPlayer): number {
  const conditions: Conditions = { difficulty: course.difficulty, wind: course.wind };
  const state: SeedState = {
    rel: 0,
    holesLeft: course.holes.length,
    aggrLeft: AGGRESSIVE_BUDGET,
  };
  const recent: Outcome[] = [];
  let relativeToPar = 0;

  for (let holeIndex = 0; holeIndex < course.holes.length; holeIndex++) {
    const hole = course.holes[holeIndex];
    const spec: HoleSpec = {
      number: hole.number,
      par: hole.par,
      strokeIndex: hole.strokeIndex,
      yardage: hole.yardage,
    };
    const difficulty = holeDifficulty(spec, conditions);
    state.holesLeft = course.holes.length - holeIndex;
    const options = {
      shotSeed: (shot: number) => holeShotSeed(seedKey, hole.number, shot),
      eventSeed: (shot: number) => eventSeed(seedKey, hole.number, shot),
      hazardSeed: (shot: number) => hazardSeed(seedKey, hole.number, shot),
      scoringEventSeed: (shot: number) => scoringEventSeed(seedKey, hole.number, shot),
      greens: course.greens as GreenSpeed,
      recent,
      narration: false as const,
      holeContext: { hazard: hole.hazard, signature: hole.signature },
    };

    const decisions: Decision[] = [];
    let result: ChainResult = resolveHoleChain(decisions, spec, conditions, options);
    let guard = 0;
    while (!result.complete && guard++ < 6) {
      let decision: Decision;
      if (result.next === "tee") {
        decision = spend(
          panelDecision(player, "tee", spec, difficulty, result.lie ?? null, null, state),
          state,
        );
      } else if (result.next === "approach") {
        decision = spend(
          panelDecision(
            player,
            "approach",
            spec,
            difficulty,
            (result.lie as Lie | undefined) ?? null,
            null,
            state,
          ),
          state,
        );
      } else if (result.next === "putt") {
        decision = panelDecision(
          player,
          "putt",
          spec,
          difficulty,
          result.lie ?? null,
          result.putt!.bucket,
          state,
        );
      } else {
        decision = panelDecision(
          player,
          "scramble",
          spec,
          difficulty,
          result.lie ?? null,
          null,
          state,
        );
      }
      decisions.push(decision);
      result = resolveHoleChain(decisions, spec, conditions, options);
    }
    if (!result.complete || result.scoreDelta == null || !result.outcome) {
      throw new Error(`Tournament seed assessment did not finish ${course.slug} hole ${hole.number}`);
    }
    relativeToPar += result.scoreDelta;
    state.rel += result.scoreDelta;
    recent.push(result.outcome);
  }

  return relativeToPar;
}

/** Score the deterministic candidate set. Exported for regression/calibration. */
export function assessTournamentSeeds(baseSeedKey: string, course: Course): TournamentSeedAssessment[] {
  const panel = seedPanel();
  return Array.from({ length: TOURNAMENT_SEED_CANDIDATES }, (_, index) => {
    const seedKey = `${baseSeedKey}:neutral:${index}`;
    const scores = panel.map((player) => policyScore(seedKey, course, player));
    return {
      seedKey,
      fieldMean: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    };
  });
}

/**
 * Select the candidate at the median simulated field mean. Ties break by key,
 * so the result is stable across processes and concurrent first-round starts.
 */
export function selectNeutralTournamentSeed(
  candidates: readonly TournamentSeedAssessment[],
): string {
  if (candidates.length === 0) throw new Error("Tournament seed candidate set is empty");
  const assessed = [...candidates].sort(
    (a, b) => a.fieldMean - b.fieldMean || a.seedKey.localeCompare(b.seedKey),
  );
  return assessed[Math.floor(assessed.length / 2)].seedKey;
}

export function neutralTournamentSeedKey(baseSeedKey: string, course: Course): string {
  return selectNeutralTournamentSeed(assessTournamentSeeds(baseSeedKey, course));
}
