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
import { holeShotSeed, eventSeed as evSeed, hazardSeed as hzSeed, scoringEventSeed as scSeed, mulberry32, hashSeed } from "../lib/engine/rng";

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
  penaltyStrokes: number;
  scoringEvents: number;
  aces: number;
  albatrosses: number;
  approachHoleOuts: number;
  wedgeHoleOuts: number;
  chipIns: number;
  bunkerHoleOuts: number;
  blowups: number;
}

console.log(`Break Par calibration · VARIABLE CHAIN · ${N.toLocaleString()} rounds/strategy · budget ${AGGRESSIVE_BUDGET}\n`);

const results: Record<string, number> = {};

for (const [name, p] of Object.entries(players)) {
  let broke = 0;
  let sumRel = 0;
  let sumRelSq = 0;
  let baselineBroke = 0;
  let baselineSumRel = 0;
  const roundScores: number[] = [];
  const feel: Feel = {
    decisions: 0, holes: 0, greenHoles: 0, onePutts: 0, threePutts: 0,
    scrambles: 0, upDowns: 0, penaltyStrokes: 0, scoringEvents: 0,
    aces: 0, albatrosses: 0, approachHoleOuts: 0, wedgeHoleOuts: 0,
    chipIns: 0, bunkerHoleOuts: 0, blowups: 0,
  };

  for (let i = 0; i < N; i++) {
    const c = COURSES[i % COURSES.length];
    const par = coursePar(c);
    const cond = { difficulty: c.difficulty, wind: c.wind };
    const st: State = { rel: 0, holesLeft: c.holes.length, aggrLeft: AGGRESSIVE_BUDGET };
    let total = 0;
    let baselineTotal = 0;
    const recent: Outcome[] = [];

    for (let hi = 0; hi < c.holes.length; hi++) {
      const h = c.holes[hi];
      const spec: HoleSpec = { number: h.number, par: h.par, strokeIndex: h.strokeIndex };
      const d = holeDifficulty(spec, cond);
      st.holesLeft = c.holes.length - hi;

      const shotSeed = (s: number) => (((i * 2 + 1) * 0x9e3779b1 + hi * 2654435761 + s * 40503 + 1) >>> 0) || 1;
      const eventSeed = (s: number) => (((i * 2 + 1) * 0x85ebca77 + hi * 374761393 + s * 668265263 + 5) >>> 0) || 1;
      const hazardSeed = (s: number) => (((i * 2 + 1) * 0xc2b2ae3d + hi * 2246822519 + s * 3266489917 + 9) >>> 0) || 1;
      const scoringEventSeed = (s: number) => (((i * 2 + 1) * 0x27d4eb2f + hi * 3266489917 + s * 668265263 + 11) >>> 0) || 1;
      const opts = {
        shotSeed,
        eventSeed,
        hazardSeed,
        scoringEventSeed,
        greens: c.greens,
        recent,
        narration: false as const,
        holeContext: { hazard: h.hazard, signature: h.signature },
      };

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

      // Same-decision no-event counterfactual. Independent event RNG means this
      // is identical on ordinary holes; on an early hole-out, finish the old
      // chain with the player's normal final-stage policy for a fair comparison.
      const baselineDecisions = [...decisions];
      let baseline = resolveHoleChain(baselineDecisions, spec, cond, { ...opts, scoringEvents: false });
      let baselineGuard = 0;
      while (!baseline.complete && baselineGuard++ < 2) {
        const dec = baseline.next === "putt"
          ? p.putt(spec, baseline.putt!.bucket, st)
          : baseline.next === "scramble"
            ? p.scramble(spec, st)
            : "normal";
        baselineDecisions.push(dec);
        baseline = resolveHoleChain(baselineDecisions, spec, cond, { ...opts, scoringEvents: false });
      }
      baselineTotal += h.par + (baseline.scoreDelta ?? 0);

      // feel metrics
      feel.holes++;
      feel.decisions += res.shots.filter((s) => s.decision).length;
      feel.penaltyStrokes += res.penaltyStrokes ?? 0;
      const scoredEvent = res.shots.find((shot) => shot.scoringEvent)?.scoringEvent;
      if (scoredEvent) {
        feel.scoringEvents++;
        if (scoredEvent.kind === "hole-in-one") feel.aces++;
        if (scoredEvent.kind === "albatross") feel.albatrosses++;
        if (scoredEvent.kind === "approach-hole-out") feel.approachHoleOuts++;
        if (scoredEvent.kind === "wedge-hole-out") feel.wedgeHoleOuts++;
        if (scoredEvent.kind === "chip-in") feel.chipIns++;
        if (scoredEvent.kind === "bunker-hole-out") feel.bunkerHoleOuts++;
      }
      if (outcome === "double" || outcome === "triple") feel.blowups++;
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
    const baselineRel = baselineTotal - par;
    if (total < par) broke++;
    if (baselineTotal < par) baselineBroke++;
    sumRel += rel;
    sumRelSq += rel * rel;
    baselineSumRel += baselineRel;
    roundScores.push(rel);
  }

  const mean = sumRel / N;
  const stdev = Math.sqrt(Math.max(0, sumRelSq / N - mean * mean));
  const breakPct = (broke / N) * 100;
  const baselineBreakPct = (baselineBroke / N) * 100;
  const baselineMean = baselineSumRel / N;
  roundScores.sort((a, b) => a - b);
  const median = (roundScores[N / 2 - 1] + roundScores[N / 2]) / 2;
  results[name] = breakPct;
  const meanStr = mean >= 0 ? `+${mean.toFixed(1)}` : mean.toFixed(1);
  const dec = (feel.decisions / feel.holes).toFixed(2);
  const gir = ((feel.greenHoles / feel.holes) * 100).toFixed(0);
  const one = ((feel.onePutts / Math.max(1, feel.greenHoles)) * 100).toFixed(0);
  const three = ((feel.threePutts / Math.max(1, feel.greenHoles)) * 100).toFixed(0);
  const ud = ((feel.upDowns / Math.max(1, feel.scrambles)) * 100).toFixed(0);
  const penalties = (feel.penaltyStrokes / feel.holes).toFixed(2);
  const scored = ((feel.scoringEvents / feel.holes) * 100).toFixed(2);
  const blowups = ((feel.blowups / feel.holes) * 100).toFixed(1);
  console.log(
    `${name.padEnd(9)} breakPar ${breakPct.toFixed(1).padStart(4)}%   avg ${meanStr.padStart(5)}   median ${median >= 0 ? "+" : ""}${median.toFixed(1)}   stdev ${stdev.toFixed(2)}` +
      `   ·  dec/hole ${dec}  GIR ${gir}%  1putt ${one}%  3putt ${three}%  u&d ${ud}%  blowup ${blowups}%  pen/hole ${penalties}  scoreEv ${scored}%`
  );
  console.log(
    `           rare events: aces ${feel.aces} · albatrosses ${feel.albatrosses} · approach HOs ${feel.approachHoleOuts}` +
      ` · wedge HOs ${feel.wedgeHoleOuts} · chip-ins ${feel.chipIns} · bunker HOs ${feel.bunkerHoleOuts}`
  );
  console.log(
    `           same-choice no-event baseline: breakPar ${baselineBreakPct.toFixed(1)}% · avg ${baselineMean >= 0 ? "+" : ""}${baselineMean.toFixed(1)}`
  );
}

// ---------------------------------------------------------------------------
// SHARED-SEED FIELD SPREAD — the tournament-fairness check.
//
// Everything above draws an independent seed per round, which models daily
// play. Tournaments don't work like that: every player in a round shares one
// seedKey, so ALL RNG namespaces (shots, events, hazards, scoring events) are
// identical across the field and within-field spread comes only from decision
// divergence. That spread is what a tournament leaderboard actually ranks.
//
// SPEC-5 shipped through the mean-only gate above while raising the real
// within-field stdev at Torrey W29 from 1.42 to 2.44 (+72%) on the same seed —
// players felt it as "every round seems increasingly random". This section
// exists so a change like that can never pass calibration silently again.
//
// Panel: a mixed field (skilled/good/greedy/naive with per-player threshold
// jitter) played on S shared seeds per course; we report the average
// within-field stdev and the seed-to-seed spread of the field mean (the "hot
// seed day" driver — Pebble W28 R1 averaged -7.63 vs -1.5 on its other rounds).
// ---------------------------------------------------------------------------
const FIELD_SEEDS = 60;
const FIELD_PANEL = 32;
// Course classes: hazard-free / mid / heavy — hazard exposure is what splits
// behavior post-SPEC-5, so the gate is per-class, not global.
const FIELD_COURSES = ["riviera", "torrey-pines-south", "muirfield-village"] as const;
// Regression tripwire, not a target: bands bracket the CURRENT engine's
// measured values (set from scripts/seed-band-investigation.ts, Jul 20 2026).
// A deliberate retune should move these numbers on purpose — update the band in
// the same commit and say so. Drifting outside the band by accident fails CI.
// Measured on the current engine (Jul 20 2026, post pen-0.20 retune): riviera
// 1.12, torrey 1.36, muirfield 1.37 — bands are those values ±0.4, wide enough
// for sim noise, tight enough that a SPEC-5-scale shift (+0.5-1.0) trips CI.
const FIELD_SPREAD_BAND: Record<(typeof FIELD_COURSES)[number], { min: number; max: number }> = {
  riviera: { min: 0.72, max: 1.52 },
  "torrey-pines-south": { min: 0.96, max: 1.76 },
  "muirfield-village": { min: 0.97, max: 1.77 },
};

// PER-COURSE MEAN GATE — the check that would have caught SPEC-5's real harm.
// The water penalty at 0.35 moved Muirfield's whole-field mean by +1.45
// strokes/round while every aggregate statistic stayed in band, because the
// main calibration averages across all courses. Gating the field MEAN per
// hazard class makes a course-conditional difficulty shift fail CI loudly.
// ASYMMETRIC on purpose. The regression risk is one-directional: wet-course
// means creeping back UP toward the pre-retune tax (torrey +1.71, muirfield
// +3.20 at pen 0.35). So the lower bound is measured -0.6 (headroom for
// legitimate changes making scoring easier) while the upper bound is measured
// +0.15 — tight enough that BOTH old values fail (torrey by 0.15, muirfield by
// 0.51; +0.3 would put old-torrey exactly on the line). Tightness is free:
// this section runs on FIXED seeds, so run-to-run noise is zero and the gate
// can only trip when engine outcomes genuinely change. Measured Jul 20 2026,
// pen 0.20: riviera +1.62, torrey +1.41, muirfield +2.54. Same discipline as
// every band here: a deliberate retune updates the band in the same commit;
// accidental drift fails.
const FIELD_MEAN_BAND: Record<(typeof FIELD_COURSES)[number], { min: number; max: number }> = {
  riviera: { min: 1.02, max: 1.77 },
  "torrey-pines-south": { min: 0.81, max: 1.56 },
  "muirfield-village": { min: 1.94, max: 2.69 },
};

interface FieldPlayer { arch: "skilled" | "good" | "greedy" | "naive"; j: number; charge: boolean }

function fieldPanel(): FieldPlayer[] {
  const out: FieldPlayer[] = [];
  for (let i = 0; i < FIELD_PANEL; i++) {
    const r = mulberry32(hashSeed(`calib-panel:${i}`));
    const a = r();
    out.push({
      arch: a < 0.5 ? "skilled" : a < 0.8 ? "good" : a < 0.92 ? "greedy" : "naive",
      j: (r() - 0.5) * 0.24,
      charge: r() < 0.5,
    });
  }
  return out;
}

function fieldDecide(p: FieldPlayer, kind: "tee" | "approach" | "putt" | "scramble", h: HoleSpec, d: number, lie: string | null, bucket: "short" | "long" | null, st: State): Decision {
  if (p.arch === "naive") return "normal";
  if (p.arch === "greedy") return kind === "putt" && bucket === "long" ? "normal" : "aggressive";
  if (p.arch === "good") {
    if (kind === "tee") return st.aggrLeft > 0 && d < 0.34 + p.j ? "aggressive" : d > 0.62 + p.j ? "safe" : "normal";
    if (kind === "approach") {
      if (lie === "trouble") return "safe";
      if (h.par === 5 && st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway")) return "aggressive";
      return st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") ? "aggressive" : "normal";
    }
    if (kind === "putt") return bucket === "short" ? "normal" : "safe";
    return "normal";
  }
  if (kind === "tee") {
    const behind = st.rel >= 0;
    let attackBelow = 0.32 + p.j;
    if (behind && st.holesLeft <= 9) attackBelow = 0.46 + p.j;
    if (behind && st.holesLeft <= 4) attackBelow = 0.62 + p.j;
    if (st.rel <= -2 && st.holesLeft <= 6) attackBelow = 0.18 + p.j;
    if (st.aggrLeft > 0 && d < attackBelow) return "aggressive";
    return d > 0.6 && !(behind && st.holesLeft <= 4) ? "safe" : "normal";
  }
  if (kind === "approach") {
    if (lie === "trouble") return st.rel >= 1 && st.holesLeft <= 3 && st.aggrLeft > 0 ? "aggressive" : "safe";
    if (h.par === 5 && st.aggrLeft > 0 && (lie === "dialed" || lie === "fairway") && d < 0.55 + p.j) return "aggressive";
    if (lie === "rough") return st.aggrLeft > 0 && st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
    return st.aggrLeft > 0 && d < 0.5 + p.j ? "aggressive" : "normal";
  }
  if (kind === "putt") {
    if (bucket === "short") return p.charge && st.rel >= 0 && st.holesLeft <= 8 ? "aggressive" : "normal";
    return st.rel >= 2 && st.holesLeft <= 3 ? "normal" : "safe";
  }
  return st.rel >= 1 && st.holesLeft <= 6 ? "aggressive" : "normal";
}

console.log("\nSHARED-SEED FIELD SPREAD (tournament model: one seed per round, whole field)");
const fieldFailures: string[] = [];
for (const slug of FIELD_COURSES) {
  const course = COURSES.find((c) => c.slug === slug);
  if (!course) { console.log(`  ${slug}: not in roster — skipped`); continue; }
  const panel = fieldPanel();
  const par = coursePar(course);
  const cond = { difficulty: course.difficulty, wind: course.wind };
  const seedMeans: number[] = [];
  const stdevs: number[] = [];
  for (let s = 0; s < FIELD_SEEDS; s++) {
    const seedRef = `calibrate-field:${slug}:${s}`;
    const rels: number[] = [];
    for (const p of panel) {
      const st: State = { rel: 0, holesLeft: course.holes.length, aggrLeft: AGGRESSIVE_BUDGET };
      let total = 0;
      const recent: Outcome[] = [];
      for (let hi = 0; hi < course.holes.length; hi++) {
        const h = course.holes[hi];
        const spec: HoleSpec = { number: h.number, par: h.par, strokeIndex: h.strokeIndex };
        const d = holeDifficulty(spec, cond);
        st.holesLeft = course.holes.length - hi;
        const opts = {
          shotSeed: (x: number) => holeShotSeed(seedRef, h.number, x),
          eventSeed: (x: number) => evSeed(seedRef, h.number, x),
          hazardSeed: (x: number) => hzSeed(seedRef, h.number, x),
          scoringEventSeed: (x: number) => scSeed(seedRef, h.number, x),
          greens: course.greens, recent, narration: false as const,
          holeContext: { hazard: h.hazard, signature: h.signature },
        };
        const decisions: Decision[] = [];
        let res: ChainResult = resolveHoleChain(decisions, spec, cond, opts);
        let guard = 0;
        while (!res.complete && guard++ < 5) {
          let dec = fieldDecide(p, res.next === "tee" ? "tee" : res.next === "approach" ? "approach" : res.next === "putt" ? "putt" : "scramble", spec, d, res.lie ?? null, res.putt?.bucket ?? null, st);
          if ((res.next === "tee" || res.next === "approach") && dec === "aggressive") {
            if (st.aggrLeft <= 0) dec = "normal"; else st.aggrLeft--;
          }
          decisions.push(dec);
          res = resolveHoleChain(decisions, spec, cond, opts);
        }
        total += h.par + (res.scoreDelta ?? 0);
        st.rel += res.scoreDelta ?? 0;
        recent.push(res.outcome as Outcome);
      }
      rels.push(total - par);
    }
    const m = rels.reduce((a, b) => a + b, 0) / rels.length;
    seedMeans.push(m);
    stdevs.push(Math.sqrt(rels.reduce((a, b) => a + (b - m) ** 2, 0) / rels.length));
  }
  const fieldStdev = stdevs.reduce((a, b) => a + b, 0) / stdevs.length;
  const mm = seedMeans.reduce((a, b) => a + b, 0) / seedMeans.length;
  const seedSpread = Math.sqrt(seedMeans.reduce((a, b) => a + (b - mm) ** 2, 0) / seedMeans.length);
  const band = FIELD_SPREAD_BAND[slug];
  const ok = fieldStdev >= band.min && fieldStdev <= band.max;
  if (!ok) fieldFailures.push(`${slug} within-field stdev ${fieldStdev.toFixed(2)} outside [${band.min}-${band.max}]`);
  const meanBand = FIELD_MEAN_BAND[slug];
  const meanOk = mm >= meanBand.min && mm <= meanBand.max;
  if (!meanOk) fieldFailures.push(`${slug} field mean ${mm >= 0 ? "+" : ""}${mm.toFixed(2)} outside [+${meanBand.min}..+${meanBand.max}]`);
  console.log(
    `  ${slug.padEnd(22)} within-field stdev ${fieldStdev.toFixed(2)} [${band.min}-${band.max}] ${ok ? "✓" : "✗"}` +
      `   field mean ${mm >= 0 ? "+" : ""}${mm.toFixed(2)} [+${meanBand.min}..+${meanBand.max}] ${meanOk ? "✓" : "✗"}` +
      `   seed-to-seed spread ${seedSpread.toFixed(2)}`
  );
}
if (fieldFailures.length) {
  console.error(`\n✗ shared-seed field checks out of band: ${fieldFailures.join("; ")}`);
  process.exit(1);
}
console.log("✓ shared-seed field spread + per-course means within band (all classes)");

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
