/**
 * WEEKLY FIELD-MEAN LOG — the dataset a future seed-band decision rests on.
 *
 * Option B (redrawing extreme tournament seeds) was DEFERRED on Jul 20 2026
 * because only 8 real per-round field means existed (n=4 per course, σ≈2.6,
 * wide CI) — too few to place a threshold. This script is the fix: run it once
 * a week (any time after Monday settle) against prod and it appends one JSON
 * line per tournament round to field-means.jsonl. After ~10 weeks there are
 * 40+ real seeds and the "how rare are Pebble-R1-scale rounds actually?"
 * question has an empirical answer.
 *
 * Read-only against the DB; appends locally; idempotent (re-runs skip rounds
 * already logged).
 *
 *   npx tsx --env-file=.env.prod scripts/log-field-means.ts
 */
import { appendFileSync, existsSync, readFileSync } from "fs";
import { prisma } from "@/lib/db";

const LOG = "field-means.jsonl";

interface Row {
  weekKey: string;
  course: string;
  roundNo: number;
  n: number;
  mean: number;
  stdev: number;
  min: number;
  max: number;
  loggedAt: string;
}

async function main() {
  const seen = new Set<string>();
  if (existsSync(LOG)) {
    for (const line of readFileSync(LOG, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as Row;
        seen.add(`${r.weekKey}:${r.roundNo}`);
      } catch { /* tolerate partial lines */ }
    }
  }

  const tournaments = await prisma.tournament.findMany({
    orderBy: { startsAt: "asc" },
    select: { id: true, weekKey: true, courseId: true },
  });

  let wrote = 0;
  for (const t of tournaments) {
    const course = await prisma.course.findUnique({ where: { id: t.courseId }, select: { slug: true } });
    for (const roundNo of [1, 2, 3, 4]) {
      const key = `${t.weekKey}:${roundNo}`;
      if (seen.has(key)) continue;
      const rounds = await prisma.round.findMany({
        where: { completed: true, tournamentRoundNo: roundNo, tournamentEntry: { tournamentId: t.id } },
        select: { relativeToPar: true },
      });
      if (rounds.length < 10) continue; // too small to be a meaningful field
      const xs = rounds.map((r) => r.relativeToPar);
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      const stdev = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
      const row: Row = {
        weekKey: t.weekKey,
        course: course?.slug ?? "?",
        roundNo,
        n: xs.length,
        mean: +mean.toFixed(3),
        stdev: +stdev.toFixed(3),
        min: Math.min(...xs),
        max: Math.max(...xs),
        loggedAt: new Date().toISOString(),
      };
      appendFileSync(LOG, JSON.stringify(row) + "\n");
      console.log(`logged ${key} (${row.course}): n=${row.n} mean ${row.mean >= 0 ? "+" : ""}${row.mean} stdev ${row.stdev}`);
      wrote++;
    }
  }
  console.log(wrote ? `\n${wrote} new round(s) appended to ${LOG}.` : `\nNothing new to log.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
