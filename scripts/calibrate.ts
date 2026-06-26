/**
 * Difficulty + SKILL calibration for MULTI-SHOT play. Run after editing the
 * shot tables in lib/engine/shots.ts (or lib/engine/probabilities.ts).
 *
 * Each hole is two decisions: a tee shot (-> lie) then a scoring shot (the
 * player sees the lie first). Strategies below model players of varying skill;
 * the harness prints break-par %, avg, stdev, and the SKILL GAP between a
 * strong, state-aware player and a mindless one. Bigger gap = more skill-based.
 */
import { COURSES, coursePar } from "../data/courses";
import { holeDifficulty, type HoleSpec } from "../lib/engine/resolveHole";
import { teeWeights, scoreWeights, type Lie } from "../lib/engine/shots";
import { SCORE_DELTA, type Decision, type Outcome } from "../lib/engine/probabilities";
import { mulberry32, type RNG } from "../lib/engine/rng";
import { AGGRESSIVE_BUDGET } from "../lib/holeRead";

const N = 40_000;

interface State {
  rel: number; // running strokes relative to par
  holesLeft: number; // holes remaining (incl. current)
  aggrLeft: number; // aggressive plays left in the budget
}

interface Player {
  // Tee-shot decision (no lie yet).
  tee: (h: HoleSpec, d: number, st: State) => Decision;
  // Scoring-shot decision (lie now known).
  score: (h: HoleSpec, d: number, lie: Lie, st: State) => Decision;
}

const players: Record<string, Player> = {
  naive: { tee: () => "normal", score: () => "normal" },
  greedy: { tee: () => "aggressive", score: () => "aggressive" },
  good: {
    tee: (h, d, st) => (st.aggrLeft > 0 && d < 0.34 ? "aggressive" : d > 0.62 ? "safe" : "normal"),
    score: (_h, _d, lie, st) =>
      lie === "trouble" ? "safe" : st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") ? "aggressive" : "normal",
  },
  skilled: {
    tee: (h, d, st) => {
      const behind = st.rel >= 0;
      let attackBelow = 0.32;
      if (behind && st.holesLeft <= 9) attackBelow = 0.46;
      if (behind && st.holesLeft <= 4) attackBelow = 0.62;
      if (st.rel <= -2 && st.holesLeft <= 6) attackBelow = 0.18;
      if (st.aggrLeft > 0 && d < attackBelow) return "aggressive";
      return d > 0.6 && !(behind && st.holesLeft <= 4) ? "safe" : "normal";
    },
    score: (_h, _d, lie, st) => {
      if (lie === "trouble") return st.rel >= 1 && st.holesLeft <= 3 && st.aggrLeft > 0 ? "aggressive" : "safe";
      if (lie === "rough") return st.aggrLeft > 0 && st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
      // dialed / fairway — good position
      return st.aggrLeft > 0 ? "aggressive" : "normal";
    },
  },
};

function spend(decision: Decision, st: State): Decision {
  if (decision !== "aggressive") return decision;
  if (st.aggrLeft <= 0) return "normal"; // budget enforced
  st.aggrLeft--;
  return "aggressive";
}

function pick<T extends string>(w: Record<T, number>, rng: RNG): T {
  const keys = Object.keys(w) as T[];
  const total = keys.reduce((a, k) => a + w[k], 0);
  let r = rng() * total;
  for (const k of keys) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

console.log(`Break Par calibration · MULTI-SHOT · ${N.toLocaleString()} rounds/strategy · budget ${AGGRESSIVE_BUDGET}\n`);

const results: Record<string, number> = {};

for (const [name, p] of Object.entries(players)) {
  let broke = 0;
  let sumRel = 0;
  let sumRelSq = 0;

  for (let i = 0; i < N; i++) {
    const c = COURSES[i % COURSES.length];
    const par = coursePar(c);
    const cond = { difficulty: c.difficulty, wind: c.wind };
    const st: State = { rel: 0, holesLeft: c.holes.length, aggrLeft: AGGRESSIVE_BUDGET };
    let total = 0;

    for (let hi = 0; hi < c.holes.length; hi++) {
      const h = c.holes[hi];
      const spec: HoleSpec = { number: h.number, par: h.par, strokeIndex: h.strokeIndex };
      const d = holeDifficulty(spec, cond);
      st.holesLeft = c.holes.length - hi;

      const teeRng = mulberry32(((i * 131 + hi * 7 + 1) * 2654435761) >>> 0 || 1);
      const teeDec = spend(p.tee(spec, d, st), st);
      const lie = pick(teeWeights(teeDec, spec, cond), teeRng);

      const scoreRng = mulberry32(((i * 131 + hi * 7 + 2) * 2654435761) >>> 0 || 1);
      const scoreDec = spend(p.score(spec, d, lie, st), st);
      const outcome = pick(scoreWeights(lie, scoreDec, spec, cond), scoreRng) as Outcome;

      const strokes = h.par + SCORE_DELTA[outcome];
      total += strokes;
      st.rel += SCORE_DELTA[outcome];
    }

    const rel = total - par;
    if (total < par) broke++;
    sumRel += rel;
    sumRelSq += rel * rel;
  }

  const mean = sumRel / N;
  const stdev = Math.sqrt(Math.max(0, sumRelSq / N - mean * mean));
  const breakPct = (broke / N) * 100;
  results[name] = breakPct;
  const meanStr = mean >= 0 ? `+${mean.toFixed(1)}` : mean.toFixed(1);
  console.log(
    `${name.padEnd(9)} breakPar ${breakPct.toFixed(1).padStart(4)}%   avg ${meanStr.padStart(5)}   stdev ${stdev.toFixed(2)}`
  );
}

const gap = results.skilled - results.naive;
const gapGreedy = results.skilled - results.greedy;
console.log(
  `\nSKILL GAP  skilled − naive  = ${gap.toFixed(1)} pts   ·   skilled − greedy = ${gapGreedy.toFixed(1)} pts`
);
console.log("(bigger gaps = decisions matter more = more skill-based)");
