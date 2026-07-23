/**
 * Deterministic scoring-shape audit.
 *
 * Reports the distribution hidden by a single round mean: results by par,
 * double-or-worse frequency, penalty contribution, finish-stage contribution,
 * and par-5 reached-in-two vs layup routes. Run before and after engine tuning:
 *
 *   npm run engine:audit
 *
 * Read-only: no database or external calls.
 */
import { COURSES, coursePar } from "../data/courses";
import { holeDifficulty, type HoleSpec } from "../lib/engine/resolveHole";
import { resolveHoleChain, type ChainResult } from "../lib/engine/shots";
import { type Decision, type Outcome } from "../lib/engine/probabilities";
import { AGGRESSIVE_BUDGET } from "../lib/holeRead";

const ROUNDS_PER_PLAYER = 6_000;

interface State {
  rel: number;
  holesLeft: number;
  aggrLeft: number;
}

interface Player {
  approach: (h: HoleSpec, difficulty: number, lie: string | null, state: State) => Decision;
  tee: (h: HoleSpec, difficulty: number, state: State) => Decision;
  putt: (bucket: "short" | "long", state: State) => Decision;
  scramble: (state: State) => Decision;
}

const players: Record<"good" | "skilled", Player> = {
  good: {
    tee: (_h, d, st) => (st.aggrLeft > 0 && d < 0.34 ? "aggressive" : d > 0.62 ? "safe" : "normal"),
    approach: (h, _d, lie, st) => {
      if (lie === "trouble") return "safe";
      if (h.par === 5 && st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway")) return "aggressive";
      return st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") ? "aggressive" : "normal";
    },
    putt: (bucket) => (bucket === "short" ? "normal" : "safe"),
    scramble: () => "normal",
  },
  skilled: {
    tee: (_h, d, st) => {
      const behind = st.rel >= 0;
      let attackBelow = 0.32;
      if (behind && st.holesLeft <= 9) attackBelow = 0.46;
      if (behind && st.holesLeft <= 4) attackBelow = 0.62;
      if (st.rel <= -2 && st.holesLeft <= 6) attackBelow = 0.18;
      if (st.aggrLeft > 0 && d < attackBelow) return "aggressive";
      return d > 0.6 && !(behind && st.holesLeft <= 4) ? "safe" : "normal";
    },
    approach: (h, d, lie, st) => {
      if (lie === "trouble") return st.rel >= 1 && st.holesLeft <= 3 && st.aggrLeft > 0 ? "aggressive" : "safe";
      if (h.par === 5 && st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") && d < 0.55) return "aggressive";
      if (lie === "rough") return st.aggrLeft > 0 && st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
      return st.aggrLeft > 0 && d < 0.5 ? "aggressive" : "normal";
    },
    putt: (bucket, st) => {
      if (bucket === "short") return st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
      return st.rel >= 2 && st.holesLeft <= 3 ? "normal" : "safe";
    },
    scramble: (st) => (st.rel >= 1 && st.holesLeft <= 6 ? "aggressive" : "normal"),
  },
};

function spend(decision: Decision, state: State): Decision {
  if (decision !== "aggressive") return decision;
  if (state.aggrLeft <= 0) return "normal";
  state.aggrLeft--;
  return decision;
}

interface Cell {
  count: number;
  sum: number;
  penalties: number;
  scores: Map<number, number>;
}

const cell = (): Cell => ({ count: 0, sum: 0, penalties: 0, scores: new Map() });
const byPar = new Map<number, Cell>([[3, cell()], [4, cell()], [5, cell()]]);
const byFinish = new Map<string, Cell>();
const par5Route = new Map<string, Cell>([["reached in two", cell()], ["laid up", cell()]]);
const roundScores: number[] = [];

function add(target: Cell, delta: number, penalties: number): void {
  target.count++;
  target.sum += delta;
  target.penalties += penalties;
  target.scores.set(delta, (target.scores.get(delta) ?? 0) + 1);
}

for (const [playerIndex, player] of Object.values(players).entries()) {
  for (let round = 0; round < ROUNDS_PER_PLAYER; round++) {
    const courseIndex = (round + playerIndex * 17) % COURSES.length;
    const course = COURSES[courseIndex];
    const conditions = { difficulty: course.difficulty, wind: course.wind };
    const state: State = { rel: 0, holesLeft: course.holes.length, aggrLeft: AGGRESSIVE_BUDGET };
    const recent: Outcome[] = [];
    let total = 0;

    for (let holeIndex = 0; holeIndex < course.holes.length; holeIndex++) {
      const hole = course.holes[holeIndex];
      const spec: HoleSpec = { number: hole.number, par: hole.par, strokeIndex: hole.strokeIndex };
      const difficulty = holeDifficulty(spec, conditions);
      const key = round + playerIndex * ROUNDS_PER_PLAYER;
      const opts = {
        shotSeed: (shot: number) =>
          (((key * 2 + 1) * 0x9e3779b1 + holeIndex * 2654435761 + shot * 40503 + 1) >>> 0) || 1,
        eventSeed: (shot: number) =>
          (((key * 2 + 1) * 0x85ebca77 + holeIndex * 374761393 + shot * 668265263 + 5) >>> 0) || 1,
        hazardSeed: (shot: number) =>
          (((key * 2 + 1) * 0xc2b2ae3d + holeIndex * 2246822519 + shot * 3266489917 + 9) >>> 0) || 1,
        scoringEventSeed: (shot: number) =>
          (((key * 2 + 1) * 0x27d4eb2f + holeIndex * 3266489917 + shot * 668265263 + 11) >>> 0) || 1,
        greens: course.greens,
        recent,
        narration: false as const,
        holeContext: { hazard: hole.hazard, signature: hole.signature },
      };

      state.holesLeft = course.holes.length - holeIndex;
      const decisions: Decision[] = [];
      let result: ChainResult = resolveHoleChain(decisions, spec, conditions, opts);
      let guard = 0;
      while (!result.complete && guard++ < 5) {
        let decision: Decision;
        if (result.next === "tee") decision = spend(player.tee(spec, difficulty, state), state);
        else if (result.next === "approach") {
          decision = spend(player.approach(spec, difficulty, result.lie ?? null, state), state);
        } else if (result.next === "putt") decision = player.putt(result.putt!.bucket, state);
        else decision = player.scramble(state);
        decisions.push(decision);
        result = resolveHoleChain(decisions, spec, conditions, opts);
      }

      if (!result.complete || result.scoreDelta == null || !result.outcome) {
        throw new Error(`Incomplete audit simulation: ${course.slug} hole ${hole.number}`);
      }

      const delta = result.scoreDelta;
      const penalties = result.penaltyStrokes ?? 0;
      add(byPar.get(hole.par)!, delta, penalties);

      const finish = result.shots.some((shot) => shot.scoringEvent)
        ? "scoring event"
        : result.green === "scramble"
          ? "scramble"
          : "putting";
      const finishCell = byFinish.get(finish) ?? cell();
      add(finishCell, delta, penalties);
      byFinish.set(finish, finishCell);

      if (hole.par === 5) {
        const route = result.shots.some((shot) => shot.stage === "layup") ? "laid up" : "reached in two";
        add(par5Route.get(route)!, delta, penalties);
      }

      total += hole.par + delta;
      state.rel += delta;
      recent.push(result.outcome);
    }
    roundScores.push(total - coursePar(course));
  }
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

function printCell(label: string, value: Cell): void {
  const middle = [...value.scores].filter(([delta]) => delta >= -1 && delta <= 1).reduce((n, [, count]) => n + count, 0);
  const doublePlus = [...value.scores].filter(([delta]) => delta >= 2).reduce((n, [, count]) => n + count, 0);
  const scoreShape = [-3, -2, -1, 0, 1, 2, 3, 4]
    .map((delta) => `${delta >= 0 ? "+" : ""}${delta}:${pct(value.scores.get(delta) ?? 0, value.count)}`)
    .join(" ");
  console.log(
    `  ${label.padEnd(17)} n=${String(value.count).padStart(7)} mean ${signed(value.sum / value.count)}` +
      ` middle(-1..+1) ${pct(middle, value.count)} double+ ${pct(doublePlus, value.count)}` +
      ` pen/hole ${(value.penalties / value.count).toFixed(3)}`
  );
  console.log(`  ${"".padEnd(17)} ${scoreShape}`);
}

console.log(`Scoring shape audit · ${(ROUNDS_PER_PLAYER * Object.keys(players).length).toLocaleString()} smart-player rounds`);
console.log("\nBY PAR");
for (const [par, value] of byPar) printCell(`par ${par}`, value);
console.log("\nBY FINISH");
for (const [finish, value] of byFinish) printCell(finish, value);
console.log("\nPAR 5 ROUTE");
for (const [route, value] of par5Route) printCell(route, value);

roundScores.sort((a, b) => a - b);
const quantile = (p: number) => roundScores[Math.min(roundScores.length - 1, Math.floor(p * roundScores.length))];
const mean = roundScores.reduce((sum, score) => sum + score, 0) / roundScores.length;
const variance = roundScores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / roundScores.length;
const middleRounds = roundScores.filter((score) => score >= -2 && score <= 4).length;
console.log(
  `\nROUND SHAPE  mean ${signed(mean)} median ${quantile(0.5) >= 0 ? "+" : ""}${quantile(0.5)}` +
    ` stdev ${Math.sqrt(variance).toFixed(2)} p05 ${quantile(0.05) >= 0 ? "+" : ""}${quantile(0.05)}` +
    ` p95 ${quantile(0.95) >= 0 ? "+" : ""}${quantile(0.95)} middle(-2..+4) ${pct(middleRounds, roundScores.length)}`
);
