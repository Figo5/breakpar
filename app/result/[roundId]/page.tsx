import type { Metadata } from "next";
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
  dailyStanding,
  standingLabel,
} from "@/lib/scoring";
import { topBoard, fieldStats } from "@/lib/leaderboard";
import { type Outcome } from "@/lib/engine/probabilities";
import { getCurrentUser } from "@/lib/user";
import { type RoundMeta } from "@/lib/analytics";
import { ShareButton } from "./ShareButton";
import { ResultTracker } from "./ResultTracker";

// Per-round share metadata. The link-preview IMAGE is wired automatically by
// the opengraph-image.tsx file in this segment; here we just give it a title +
// description. Works unauthenticated; invalid id falls back to a generic title.
export async function generateMetadata({ params }: { params: Promise<{ roundId: string }> }): Promise<Metadata> {
  const { roundId } = await params;
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    select: { score: true, relativeToPar: true, mode: true, dateKey: true, course: { select: { slug: true } } },
  });
  const course = round ? courseBySlug(round.course.slug) : null;
  if (!round || !course) return { title: "Break Par — result" };

  const par = coursePar(course);
  const courseName = course.name.split("—")[0].trim();
  const isDaily = round.mode === "daily" && !!round.dateKey;
  const puzzleNo = round.dateKey ? puzzleNumberForKey(round.dateKey) : null;
  const tag = `${round.score} (${relativeLabel(round.relativeToPar)})`;
  const title = isDaily ? `Break Par #${puzzleNo} — ${courseName}: ${tag}` : `Break Par — ${courseName}: ${tag}`;
  const description = brokePar(round.score, par)
    ? `Broke par at ${courseName} — ${tag}. Think you can?`
    : `${tag} at ${courseName}. Can you break par?`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website", url: `/result/${roundId}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

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

  // Analytics identity + own-round vs incoming-share signal. getCurrentUser is
  // read-only for guests and safe on this public page.
  const viewer = await getCurrentUser();
  const ownRound = !!viewer && viewer.id === round.userId;
  const analyticsMeta: RoundMeta = {
    roundId: round.id,
    slug: course.slug,
    mode: round.mode === "unlimited" ? "practice" : "daily",
    puzzleNumber: puzzleNo,
  };
  const made = brokePar(round.score, par);
  const grid = shareGrid(outcomes);

  // Daily-only: the ranked ladder + REAL standing in today's field. The field
  // is scoped by dateKey + completed, which means: only FINISHED, DAILY rounds
  // for today's daily course (practice rounds carry dateKey = null, so they're
  // excluded; each daily course owns its own dateKey). Unlimited practice has
  // no ladder. Computed at view time, so the percentile drifts as more finish —
  // hence the "so far today" copy. (The share text below snapshots it.)
  const [board, stats] = isDaily
    ? await Promise.all([
        topBoard(round.dateKey!, 8),
        fieldStats(round.dateKey!, round.score),
      ])
    : [[], null];

  const standing =
    isDaily && round.completed && stats ? dailyStanding(stats.betterCount, stats.fieldSize) : null;

  const courseName = course.name.split("—")[0].trim();
  // The share text snapshots the standing at render (share) time; the page may
  // show a slightly different number later as more people finish today.
  const standingLine = standing ? `\n${standingLabel(standing)}` : "";
  const shareText = isDaily
    ? `BREAK PAR #${puzzleNo} ⛳\n${courseName} (Par ${par})\n` +
      `${round.score} (${relativeLabel(round.relativeToPar)})\n\n${grid}${standingLine}\n\n` +
      `🐦 ${counts.birdiesOrBetter}  ·  ⛳ ${counts.pars}  ·  😬 ${counts.bogeysOrWorse}\nbreakpar.xyz`
    : `BREAK PAR — Practice ⛳\n${courseName} (Par ${par})\n` +
      `${round.score} (${relativeLabel(round.relativeToPar)})\n\n${grid}\n\n` +
      `🐦 ${counts.birdiesOrBetter}  ·  ⛳ ${counts.pars}  ·  😬 ${counts.bogeysOrWorse}\nbreakpar.xyz`;

  return (
    <div className="screen">
      <ResultTracker meta={analyticsMeta} ownRound={ownRound} userId={viewer?.id ?? null} />
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
      {standing && <span className="pct">{standingLabel(standing)}</span>}

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
        <ShareButton text={shareText} meta={analyticsMeta} />
        {isDaily ? (
          <Link href="/" className="cta ghost">Back to today</Link>
        ) : (
          <>
            <Link href={`/play?course=${course.slug}`} className="cta green">Play again</Link>
            <Link href="/courses" className="cta ghost">Browse courses</Link>
          </>
        )}
        <Link href="/profile" className="cta ghost">View your profile &amp; best rounds</Link>
      </div>
    </div>
  );
}
