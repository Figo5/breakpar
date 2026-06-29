/**
 * Difficulty + SKILL calibration for the VARIABLE-LENGTH CHAIN.
 * Run after editing the engine tables (shots.ts / putting.ts / probabilities.ts).
 *
 *   npm run engine:calibrate
 *
 * Each hole is now Tee -> Approach -> (Putt | Scramble) -> Outcome, with kick-ins
 * auto-resolving. Strategies below model players of varying skill across ALL
 * stages. The harness prints break-par %, avg, stdev, the SKILL GAP between a
 * strong state-aware player and a mindless one, and the new FEEL metrics
 * (decisions/hole, GIR%, 1-putt%, 3-putt%, up&down%).
 *
 * Targets: smart play breaks par ~28-32%; skill gap stays positive.
 * Principle: variance is the enemy of skill expression — putting/scramble add
 * texture, not slot-machine noise.
 */
import { COURSES, coursePar } from "../data/courses";
import { holeDifficulty, type HoleSpec } from "../lib/engine/resolveHole";
import { resolveHoleChain, type ChainResult } from "../lib/engine/shots";
import { type Decision, type Outcome } from "../lib/engine/probabilities";
import { AGGRESSIVE_BUDGET } from "../lib/holeRead";

const N = 40_000;

interface State {
  rel: number; // running strokes relative to par
  holesLeft: number; // holes remaining (incl. current)
  aggrLeft: number; // aggressive plays left in the budget (tee/approach only)
}

interface Player {
  tee: (h: HoleSpec, d: number, st: State) => Decision;
  approach: (h: HoleSpec, d: number, lie: string | null, st: State) => Decision;
  putt: (h: HoleSpec, bucket: "short" | "long", st: State) => Decision;
  scramble: (h: HoleSpec, st: State) => Decision;
}

const players: Record<string, Player> = {
  naive: {
    tee: () => "normal",
    approach: () => "normal",
    putt: () => "normal",
    scramble: () => "normal",
  },
  greedy: {
    tee: () => "aggressive",
    approach: () => "aggressive",
    putt: () => "aggressive",
    scramble: () => "aggressive",
  },
  good: {
    tee: (_h, d, st) => (st.aggrLeft > 0 && d < 0.34 ? "aggressive" : d > 0.62 ? "safe" : "normal"),
    approach: (h, _d, lie, st) => {
      if (lie === "trouble") return "safe";
      // reach par 5s in two when you have the budget and good position
      if (h.par === 5 && st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway")) return "aggressive";
      return st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") ? "aggressive" : "normal";
    },
    putt: (_h, bucket) => (bucket === "short" ? "normal" : "safe"),
    scramble: () => "normal",
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
    approach: (h, d, lie, st) => {
      if (lie === "trouble") return st.rel >= 1 && st.holesLeft <= 3 && st.aggrLeft > 0 ? "aggressive" : "safe";
      // par 5: go for the green in two from a good lie when it's worth a token
      if (h.par === 5 && st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") && d < 0.55) return "aggressive";
      if (lie === "rough") return st.aggrLeft > 0 && st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
      // par 3 (lie === null) or good lie
      return st.aggrLeft > 0 && d < 0.5 ? "aggressive" : "normal";
    },
    putt: (_h, bucket, st) => {
      if (bucket === "short") {
        // charge birdie putts when chasing late; otherwise roll it
        return st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
      }
      // long putts: lag to avoid the three-jack unless desperate
      return st.rel >= 2 && st.holesLeft <= 3 ? "normal" : "safe";
    },
    scramble: (_h, st) => (st.rel >= 1 && st.holesLeft <= 6 ? "aggressive" : "normal"),
  },
};

/** Spend a budget token only on tee/approach aggressive plays. */
function spendTeeApproach(decision: Decision, st: State): Decision {
  if (decision !== "aggressive") return decision;
  if (st.aggrLeft <= 0) return "normal";
  st.aggrLeft--;
  return "aggressive";
}

interface Feel {
  decisions: number;
  holes: number;
  greenHoles: number; // reached the green (kickin/makeable/lag)
  onePutts: number;
  threePutts: number;
  scrambles: number;
  upDowns: number;
}

console.log(`Break Par calibration · VARIABLE CHAIN · ${N.toLocaleString()} rounds/strategy · budget ${AGGRESSIVE_BUDGET}\n`);

const results: Record<string, number> = {};

for (const [name, p] of Object.entries(players)) {
  let broke = 0;
  let sumRel = 0;
  let sumRelSq = 0;
  const feel: Feel = { decisions: 0, holes: 0, greenHoles: 0, onePutts: 0, threePutts: 0, scrambles: 0, upDowns: 0 };

  for (let i = 0; i < N; i++) {
    const c = COURSES[i % COURSES.length];
    const par = coursePar(c);
    const cond = { difficulty: c.difficulty, wind: c.wind };
    const st: State = { rel: 0, holesLeft: c.holes.length, aggrLeft: AGGRESSIVE_BUDGET };
    let total = 0;
    const recent: Outcome[] = [];

    for (let hi = 0; hi < c.holes.length; hi++) {
      const h = c.holes[hi];
      const spec: HoleSpec = { number: h.number, par: h.par, strokeIndex: h.strokeIndex };
      const d = holeDifficulty(spec, cond);
      st.holesLeft = c.holes.length - hi;

      const shotSeed = (s: number) => (((i * 2 + 1) * 0x9e3779b1 + hi * 2654435761 + s * 40503 + 1) >>> 0) || 1;
      const eventSeed = (s: number) => (((i * 2 + 1) * 0x85ebca77 + hi * 374761393 + s * 668265263 + 5) >>> 0) || 1;
      const opts = { shotSeed, eventSeed, greens: c.greens, recent, narration: false as const };

      const decisions: Decision[] = [];
      let res: ChainResult = resolveHoleChain(decisions, spec, cond, opts);
      // walk the chain to completion
      let guard = 0;
      while (!res.complete && guard++ < 5) {
        let dec: Decision;
        if (res.next === "tee") dec = spendTeeApproach(p.tee(spec, d, st), st);
        else if (res.next === "approach") dec = spendTeeApproach(p.approach(spec, d, res.lie ?? null, st), st);
        else if (res.next === "putt") dec = p.putt(spec, res.putt!.bucket, st); // not budgeted
        else dec = p.scramble(spec, st); // scramble, not budgeted
        decisions.push(dec);
        res = resolveHoleChain(decisions, spec, cond, opts);
      }

      const outcome = res.outcome as Outcome;
      const strokes = h.par + (res.scoreDelta ?? 0);
      total += strokes;
      st.rel += res.scoreDelta ?? 0;
      recent.push(outcome);

      // feel metrics
      feel.holes++;
      feel.decisions += res.shots.filter((s) => s.decision).length;
      const green = res.green;
      if (green === "scramble") {
        feel.scrambles++;
        const sg = res.shots.find((s) => s.scrambleResult);
        if (sg?.scrambleResult === "updown") feel.upDowns++;
      } else if (green) {
        feel.greenHoles++;
        const putt = res.shots.find((s) => s.puttResult);
        if (putt?.puttResult === "oneputt" || green === "kickin") feel.onePutts++;
        if (putt?.puttResult === "threeputt") feel.threePutts++;
      }
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
  const dec = (feel.decisions / feel.holes).toFixed(2);
  const gir = ((feel.greenHoles / feel.holes) * 100).toFixed(0);
  const one = ((feel.onePutts / Math.max(1, feel.greenHoles)) * 100).toFixed(0);
  const three = ((feel.threePutts / Math.max(1, feel.greenHoles)) * 100).toFixed(0);
  const ud = ((feel.upDowns / Math.max(1, feel.scrambles)) * 100).toFixed(0);
  console.log(
    `${name.padEnd(9)} breakPar ${breakPct.toFixed(1).padStart(4)}%   avg ${meanStr.padStart(5)}   stdev ${stdev.toFixed(2)}` +
      `   ·  dec/hole ${dec}  GIR ${gir}%  1putt ${one}%  3putt ${three}%  u&d ${ud}%`
  );
}

const gap = results.skilled - results.naive;
const gapGreedy = results.skilled - results.greedy;
console.log(
  `\nSKILL GAP  skilled − naive  = ${gap.toFixed(1)} pts   ·   skilled − greedy = ${gapGreedy.toFixed(1)} pts`
);
console.log("(bigger gaps = decisions matter more = more skill-based)");

// --- CI gate -----------------------------------------------------------------
// Smart play (good/skilled) must break par within this band. Outside it means
// an engine change wrecked difficulty -> exit non-zero so CI fails loudly
// instead of printing red numbers nobody reads. Tunable: widen/narrow here.
const BREAK_PAR_BAND = { min: 26, max: 34 } as const;
const offenders = (["good", "skilled"] as const)
  .map((name) => [name, results[name]] as const)
  .filter(([, pct]) => pct < BREAK_PAR_BAND.min || pct > BREAK_PAR_BAND.max);
if (offenders.length) {
  console.error(
    `\n\u2717 break-par out of band [${BREAK_PAR_BAND.min}\u2013${BREAK_PAR_BAND.max}%]: ` +
      offenders.map(([n, p]) => `${n} ${p.toFixed(1)}%`).join(", ")
  );
  process.exit(1);
}
console.log(`\n\u2713 break-par within band [${BREAK_PAR_BAND.min}\u2013${BREAK_PAR_BAND.max}%] (good/skilled)`);
