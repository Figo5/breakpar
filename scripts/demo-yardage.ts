/**
 * Demo (no DB): replays the real seeded chain to show the yardage-feedback work.
 * Finds a daily-ish round/hole where a Lag (safe) approach lands on a long green
 * and the conservative putt three-putts, so you can see ALL FOUR at once:
 *   1) tee distance   2) yards-to-pin (approach)   3) ball position on HoleArt
 *   4) reworded putt cue + the bad-luck note.
 * Run: npx tsx scripts/demo-yardage.ts
 */
import { resolveHoleChain, ballProgress, type Decision } from "@/lib/engine/shots";
import { holeShotSeed, eventSeed } from "@/lib/engine/rng";
import { greenRead } from "@/lib/holeRead";
import { courseBySlug } from "@/data/courses";

const course = courseBySlug("bethpage-black")!; // long par-70 championship test
const cond = { difficulty: course.difficulty, wind: course.wind };

function play(roundId: string, holeNumber: number, decisions: Decision[]) {
  const hole = course.holes.find((h) => h.number === holeNumber)!;
  return {
    hole,
    step: resolveHoleChain(decisions, { number: hole.number, par: hole.par, strokeIndex: hole.strokeIndex }, cond, {
      shotSeed: (s) => holeShotSeed(roundId, holeNumber, s),
      eventSeed: (s) => eventSeed(roundId, holeNumber, s),
      greens: course.greens,
      holeYards: hole.yardage,
    }),
  };
}

// Search for a par-4 hole where: tee -> approach(safe) -> long green -> putt(safe) three-putts.
for (let n = 1; n <= 9999; n++) {
  const roundId = `demo-${n}`;
  for (const hole of course.holes.filter((h) => h.par === 4)) {
    const seq: Decision[] = ["normal", "safe", "safe"]; // tee / approach=lay-ish / lag putt
    const afterTee = play(roundId, hole.number, ["normal"]).step;
    const afterApproach = play(roundId, hole.number, ["normal", "safe"]).step;
    const final = play(roundId, hole.number, seq).step;
    const puttShot = final.shots.find((s) => s.stage === "putt");
    const isLag = afterApproach.green === "lag";
    if (isLag && puttShot?.puttResult === "threeputt" && final.complete) {
      const tee = afterTee.shots.find((s) => s.stage === "tee")!;
      console.log("================ SEED (roundId) =", roundId, "· Bethpage Black · Hole", hole.number, `(par ${hole.par}, ${hole.yardage} yds) ================\n`);

      console.log("1) TEE  — ball sits at the tee on HoleArt: t = 0.05");
      console.log("   after the tee shot:", `"${tee.note}"`, "· shows  ~" + tee.yards + " yd   <-- tee distance\n");

      console.log("2) APPROACH — yards to target:");
      console.log("   banner shows:  ⛳", afterTee.approachYards, "to the pin   <-- yardage-to-target");
      console.log("   ball advances on HoleArt: t =", afterTee.ballT?.toFixed(2), `( = drive ${tee.yards} / ${hole.yardage} )`);
      console.log("   consistency:  tee", tee.yards, "+ approach", afterTee.approachYards, "=", tee.yards! + afterTee.approachYards!, "= hole yardage", hole.yardage, "\n");

      console.log("3) GREEN — reworded (non-promising) cue:");
      console.log("   green banner read:  \"" + greenRead("lag").text + "\"   <-- was 'Long two-putt territory'\n");

      console.log("4) PUTT result — the bad-luck note (lag/safe three-putt = variance, not a yip):");
      console.log("   \"" + puttShot!.note + `"   (~${puttShot!.distanceFt} ft)\n`);

      console.log("Ball-position track across the hole:",
        ["tee", "approach", "scramble", "putt"].map((s) =>
          `${s}=${ballProgress(s as never, afterApproach.green ?? null, tee.yards ?? null, hole.yardage).toFixed(2)}`
        ).join("  "));
      console.log("\nLIVE: play unlimited at /play?course=bethpage-black, hole", hole.number, "— Tee: Normal, Approach: Safe, Putt: Lag.");
      process.exit(0);
    }
  }
}
console.log("no matching hole found in search window");
