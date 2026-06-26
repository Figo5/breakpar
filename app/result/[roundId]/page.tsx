import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { puzzleNumberForKey } from "@/lib/daily";
import { coursePar, courseBySlug } from "@/data/courses";
import {
  tally,
  shareGrid,
  relativeLabel,
  brokePar,
  estimatePercentile,
  percentileFromRank,
  PERCENTILE_MIN_SAMPLE,
} from "@/lib/scoring";
import { topBoard, fieldStats } from "@/lib/leaderboard";
import { type Outcome } from "@/lib/engine/probabilities";
import { ShareButton } from "./ShareButton";

// Server component — final card + today's leaderboard.
export default async function Result({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    // Only what the card renders — no `user: true` (that would pull the user's
    // email into a publicly reachable page).
    include: {
      holeResults: { orderBy: { holeNumber: "asc" } },
      course: { select: { slug: true } },
    },
  });
  if (!round) notFound();

  // Course comes from the round's OWN stored course (daily or unlimited).
  const course = courseBySlug(round.course.slug);
  if (!course) notFound();
  const par = coursePar(course);
  const isDaily = round.mode === "daily" && !!round.dateKey;
  const puzzleNo = round.dateKey ? puzzleNumberForKey(round.dateKey) : null;
  const outcomes = round.holeResults.map((h) => h.outcome as Outcome);
  const counts = tally(outcomes);
  const made = brokePar(round.score, par);
  const grid = shareGrid(outcomes);

  // Daily-only: the ranked ladder + empirical "Top X%" (heuristic fallback
  // until the field is large enough). Unlimited practice has no ladder.
  const [board, stats] = isDaily
    ? await Promise.all([
        topBoard(round.dateKey!, 8),
        fieldStats(round.dateKey!, round.score),
      ])
    : [[], null];

  const pct = !isDaily
    ? null
    : round.completed && stats!.fieldSize >= PERCENTILE_MIN_SAMPLE
      ? percentileFromRank(stats!.rank, stats!.fieldSize)
      : estimatePercentile(round.score, par);

  const courseName = course.name.split("—")[0].trim();
  const shareText = isDaily
    ? `BREAK PAR #${puzzleNo} ⛳\n${courseName} (Par ${par})\n` +
      `${round.score} (${relativeLabel(round.relativeToPar)}) · Top ${pct}%\n\n${grid}\n\n` +
      `🐦 ${counts.birdiesOrBetter}  ·  ⛳ ${counts.pars}  ·  😬 ${counts.bogeysOrWorse}\nbreakpar.game`
    : `BREAK PAR — Practice ⛳\n${courseName} (Par ${par})\n` +
      `${round.score} (${relativeLabel(round.relativeToPar)})\n\n${grid}\n\n` +
      `🐦 ${counts.birdiesOrBetter}  ·  ⛳ ${counts.pars}  ·  😬 ${counts.bogeysOrWorse}\nbreakpar.game`;

  return (
    <div className="screen">
      <div className="final-course">
        {isDaily ? `Break Par · No. ${puzzleNo} · ` : "Practice · "}{course.name}
      </div>
      <div className="final-score">{round.score}</div>
      <div className={`final-rel ${made ? "made-it" : "missed"}`}>
        {relativeLabel(round.relativeToPar)} · {made ? "Under par ✓" : `Missed par by ${round.score - par + 1}`}
      </div>
      <div className="verdict">
        {made ? "You broke par. 🔥" : isDaily ? "So close — run it back tomorrow." : "So close — go again."}
      </div>
      {pct !== null && <span className="pct">Top {pct}% today</span>}

      <div className="breakdown">
        <div className="bd"><div className="n">{counts.birdiesOrBetter}</div><div className="k">Birdies+</div></div>
        <div className="bd"><div className="n">{counts.pars}</div><div className="k">Pars</div></div>
        <div className="bd"><div className="n">{counts.bogeysOrWorse}</div><div className="k">Bogeys+</div></div>
        <div className="bd"><div className="n">{round.durationMs ? Math.round(round.durationMs / 1000) + "s" : "—"}</div><div className="k">Time</div></div>
      </div>

      <div className="share-grid">
        <div className="ghdr">
          {isDaily ? `BREAK PAR #${puzzleNo}` : `BREAK PAR — ${courseName}`} — {round.score} ({relativeLabel(round.relativeToPar)})
        </div>
        <div className="grid">{grid}</div>
      </div>

      {isDaily && (
        <>
          <div className="section-title">Today&apos;s Leaderboard</div>
          <div className="lb">
            {board.map((r) => (
              <div key={r.id} className={`lb-row ${r.userId === round.userId ? "you" : ""}`}>
                <span className="rank">{r.rank}</span>
                <span className="nm">{r.userId === round.userId ? "You" : r.username}</span>
                <span className="tm">{r.durationMs ? Math.round(r.durationMs / 1000) + "s" : ""}</span>
                <span className="sc">{r.score}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="btn-stack">
        <ShareButton text={shareText} />
        {isDaily ? (
          <Link href="/" className="cta ghost">Back to today</Link>
        ) : (
          <>
            <Link href={`/play?course=${course.slug}`} className="cta green">Play again</Link>
            <Link href="/courses" className="cta ghost">Browse courses</Link>
          </>
        )}
      </div>
    </div>
  );
}
