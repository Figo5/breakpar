/**
 * Difficulty calibration harness. Run `npm run engine:calibrate` after editing
 * lib/engine/probabilities.ts to confirm the break-PAR rate is where you want it.
 * Simulates several strategies over many rounds and prints the spread.
 */
import { COURSES, coursePar } from "../data/courses";
import { resolveHole, holeDifficulty, type HoleSpec } from "../lib/engine/resolveHole";
import { mulberry32 } from "../lib/engine/rng";
import type { Decision } from "../lib/engine/probabilities";

const N = 40_000;
const strategies: Record<string, (h: HoleSpec, d: number) => Decision> = {
  good: (h, d) => (d < 0.38 || (h.par === 5 && d < 0.5) ? "aggressive" : "normal"),
  cautious: (h, d) => (d > 0.5 ? "safe" : "normal"),
  naive: () => "normal",
  greedy: () => "aggressive",
};

for (const [name, strat] of Object.entries(strategies)) {
  let broke = 0, sumRel = 0;
  for (let i = 0; i < N; i++) {
    const c = COURSES[i % COURSES.length];
    const par = coursePar(c);
    const rng = mulberry32((i * 2654435761) >>> 0 || 1);
    let total = 0;
    for (const h of c.holes) {
      const spec: HoleSpec = { number: h.number, par: h.par, strokeIndex: h.strokeIndex };
      const d = holeDifficulty(spec, { difficulty: c.difficulty, wind: c.wind });
      total += resolveHole(strat(spec, d), spec, { difficulty: c.difficulty, wind: c.wind }, rng).strokes;
    }
    if (total < par) broke++; // broke par for that course
    sumRel += total - par;
  }
  const rel = sumRel / N;
  const relStr = rel >= 0 ? `+${rel.toFixed(1)}` : rel.toFixed(1);
  console.log(`${name.padEnd(7)} breakPar ${(broke / N * 100).toFixed(1)}%  avg ${relStr} to par`);
}
