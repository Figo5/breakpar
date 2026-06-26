/**
 * Difficulty + SKILL calibration harness. Run `npm run engine:calibrate` after
 * editing lib/engine/probabilities.ts.
 *
 * It simulates several strategies over many rounds and prints, for each:
 *   - break-par %         (is the challenge fair-but-hard?)
 *   - avg to par          (central tendency)
 *   - stdev               (variance — lower = luck matters less)
 *
 * Then it prints the SKILL GAP: how much better a strong, state-aware player
 * does than a mindless one. The bigger that gap, the more skill-based the game.
 * Strategies honor the real AGGRESSIVE_BUDGET so the sim matches live play.
 */
import { COURSES, coursePar } from "../data/courses";
import { resolveHole, holeDifficulty, type HoleSpec } from "../lib/engine/resolveHole";
import { mulberry32 } from "../lib/engine/rng";
import { AGGRESSIVE_BUDGET } from "../lib/holeRead";
import type { Decision } from "../lib/engine/probabilities";

const N = 40_000;

/** Online state a player can actually see when choosing. */
interface State {
  rel: number; // running strokes relative to par
  holesLeft: number; // holes remaining INCLUDING the current one
  aggrLeft: number; // aggressive plays still in the budget
}

type Strategy = (h: HoleSpec, d: number, st: State) => Decision;

const strategies: Record<string, Strategy> = {
  // Mindless baselines.
  naive: () => "normal",
  greedy: () => "aggressive", // budget-capped by the harness, then forced to normal
  cautious: (_h, d) => (d > 0.5 ? "safe" : "normal"),

  // Difficulty-aware, but ignores the scoreboard.
  good: (h, d, st) =>
    st.aggrLeft > 0 && (d < 0.3 || (h.par === 5 && d < 0.45)) ? "aggressive" : d > 0.62 ? "safe" : "normal",

  // Strong play: difficulty-aware AND state-aware. Spends the aggression budget
  // on gettable holes, gambles harder when behind late, protects a cushion.
  skilled: (h, d, st) => {
    const behind = st.rel >= 0; // not under par yet
    let attackBelow = 0.3; // attack holes easier than this
    if (behind && st.holesLeft <= 9) attackBelow = 0.45;
    if (behind && st.holesLeft <= 4) attackBelow = 0.62;
    if (st.rel <= -2 && st.holesLeft <= 6) attackBelow = 0.16; // protect the card

    if (st.aggrLeft > 0 && d < attackBelow) return "aggressive";
    if (d > 0.6 && !(behind && st.holesLeft <= 4)) return "safe";
    return "normal";
  },
};

console.log(`Break Par calibration · ${N.toLocaleString()} rounds/strategy · budget ${AGGRESSIVE_BUDGET}\n`);

const results: Record<string, number> = {};

for (const [name, strat] of Object.entries(strategies)) {
  let broke = 0;
  let sumRel = 0;
  let sumRelSq = 0;

  for (let i = 0; i < N; i++) {
    const c = COURSES[i % COURSES.length];
    const par = coursePar(c);
    const rng = mulberry32((i * 2654435761) >>> 0 || 1);

    let total = 0;
    let aggrLeft = AGGRESSIVE_BUDGET;
    const holeCount = c.holes.length;

    for (let hi = 0; hi < holeCount; hi++) {
      const h = c.holes[hi];
      const spec: HoleSpec = { number: h.number, par: h.par, strokeIndex: h.strokeIndex };
      const cond = { difficulty: c.difficulty, wind: c.wind };
      const d = holeDifficulty(spec, cond);

      // running rel-to-par across the holes played so far:
      const relSoFar = total - c.holes.slice(0, hi).reduce((a, x) => a + x.par, 0);
      let decision = strat(spec, d, { rel: relSoFar, holesLeft: holeCount - hi, aggrLeft });

      // Enforce the live aggression budget: no tokens left -> forced to normal.
      if (decision === "aggressive") {
        if (aggrLeft <= 0) decision = "normal";
        else aggrLeft--;
      }

      total += resolveHole(decision, spec, cond, rng).strokes;
    }

    const rel = total - par;
    if (total < par) broke++;
    sumRel += rel;
    sumRelSq += rel * rel;
  }

  const mean = sumRel / N;
  const variance = sumRelSq / N - mean * mean;
  const stdev = Math.sqrt(Math.max(0, variance));
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
  `\nSKILL GAP  skilled − naive  = ${gap.toFixed(1)} pts` +
    `   ·   skilled − greedy = ${gapGreedy.toFixed(1)} pts`
);
console.log("(bigger gaps = decisions matter more = more skill-based)");
