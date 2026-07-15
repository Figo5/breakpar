/**
 * Print sample resolved-hole transcripts (shot-by-shot, with play-by-play and
 * events) so we can sanity-check the FEEL of the new putting/events chain
 * before any UI work. Not a test — a human-readable demo.
 *
 *   npx tsx scripts/transcript.ts
 */
import { COURSES } from "../data/courses";
import { resolveHoleChain, type ChainResult, type Lie } from "../lib/engine/shots";
import { stagePrompt } from "../lib/engine/shots";
import { GREEN_META, PUTT_META, SCRAMBLE_META, type GreenSpeed } from "../lib/engine/putting";
import { LIE_META } from "../lib/engine/shots";
import { OUTCOME_META, type Decision, type Outcome } from "../lib/engine/probabilities";

// A simple "smart-ish" auto-player so we can drive a full hole to completion.
function playHole(
  hole: { number: number; par: number; strokeIndex: number },
  cond: { difficulty: number; wind: number },
  greens: GreenSpeed,
  seedBase: number,
  recent: Outcome[]
) {
  const shotSeed = (i: number) => ((seedBase + i * 2654435761) >>> 0) || 1;
  const eventSeed = (i: number) => ((seedBase * 13 + i * 40503 + 7) >>> 0) || 1;
  const decisions: Decision[] = [];

  // policy: attack good positions, protect from trouble.
  for (let guard = 0; guard < 4; guard++) {
    const step = resolveHoleChain(decisions, hole, cond, { shotSeed, eventSeed, greens, recent });
    if (step.complete) return step;
    let d: Decision = "normal";
    if (step.next === "tee") d = hole.strokeIndex >= 12 ? "aggressive" : "normal";
    else if (step.next === "approach")
      d =
        step.lie === "trouble" ? "safe"
        : hole.par === 5 && (step.lie === "dialed" || step.lie === "fairway") ? "aggressive" // go for it in two
        : "normal";
    else if (step.next === "putt") d = step.putt!.bucket === "short" ? "normal" : "safe";
    else if (step.next === "scramble") d = "normal";
    decisions.push(d);
  }
  return resolveHoleChain(decisions, hole, cond, { shotSeed, eventSeed, greens, recent });
}

function printHole(label: string, course: (typeof COURSES)[number], holeIdx: number, seedBase: number, recent: Outcome[] = []) {
  const h = course.holes[holeIdx];
  const spec = { number: h.number, par: h.par, strokeIndex: h.strokeIndex };
  const cond = { difficulty: course.difficulty, wind: course.wind };
  const res = playHole(spec, cond, course.greens, seedBase, recent) as ChainResult;

  console.log(`\n━━ ${label} ━━`);
  console.log(`${course.name} · Hole ${h.number} · Par ${h.par} · SI ${h.strokeIndex} · ${h.yardage}y · greens ${course.greens}, wind ${course.wind}mph`);
  for (const s of res.shots) {
    const dec = s.decision ? `[${s.decision}]` : "[auto]";
    const pos =
      s.lie ? LIE_META[s.lie].label :
      s.green ? GREEN_META[s.green].label : "";
    const detail =
      s.puttResult ? ` (${PUTT_META[s.puttResult].label}${s.distanceFt ? `, ${s.distanceFt}ft` : ""})` :
      s.scrambleResult ? ` (${SCRAMBLE_META[s.scrambleResult].label})` : "";
    const ev = s.event ? `   ⚡ ${s.event.label}: ${s.event.narration}` : "";
    console.log(`  ${s.stage.padEnd(9)} ${dec.padEnd(13)} ${(pos + detail).padEnd(30)} “${s.note}”${ev}`);
  }
  const o = res.outcome!;
  console.log(`  → ${OUTCOME_META[o].label} (${res.scoreDelta! >= 0 ? "+" : ""}${res.scoreDelta}) · ${res.shots.filter((s) => s.decision).length} decisions`);
}

const pebble = COURSES[0];
const sawgrass = COURSES[2];

// A reachable par 5, an island par 3, a brutal par 4, and a recovery.
printHole("Reachable par 5", sawgrass, 15, 1001); // hole 16, par 5 reachable
printHole("Island par 3", sawgrass, 16, 2002); // hole 17, par 3
printHole("Brutal par 4 (SI 1)", pebble, 15, 3003); // hole 16, SI 1
printHole("Short par 4", pebble, 3, 4004); // hole 4, short
printHole("Momentum: after two birdies", pebble, 0, 5005, ["birdie", "birdie"]);
printHole("Long par 5", COURSES[1], 13, 6006); // St Andrews 14 (Long Hole)

// A few extra seeds on the same brutal hole to show variety (scramble vs putt).
for (let i = 0; i < 4; i++) printHole(`Pebble #8 (cliff par 4) seed ${i}`, pebble, 7, 7000 + i * 97);

// Hunt a couple of seeds on the reachable par 5 to show the eagle / go-for-it path.
console.log("\n\n===== Going for the reachable par 5 in two (a few seeds) =====");
for (let i = 0; i < 6; i++) printHole(`Sawgrass #16 (par 5) seed ${i}`, sawgrass, 15, 80000 + i * 521);
