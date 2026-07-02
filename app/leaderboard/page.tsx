import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { dateKey, dailyCourse, puzzleNumber } from "@/lib/daily";
import { coursePar } from "@/data/courses";
import { topBoard, fieldStats, type BoardEntry } from "@/lib/leaderboard";
import { relativeLabel } from "@/lib/scoring";
import { xHandleLabel, xHandleUrl } from "@/lib/xHandle";
import { Avatar } from "@/components/Avatar";

// Standalone daily leaderboard — today's ranked field on the daily course.
// Reuses the same topBoard/fieldStats + row markup as the result screen, so the
// ordering and rendering stay in one place (no new backend). This is the target
// the "Today's Leaderboard" button on /friends was always meant to reach.
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const key = dateKey();
  const course = dailyCourse();
  const [board, user] = await Promise.all([topBoard(key, 25), getCurrentUser()]);

  // Your standing — highlight you in the board and, if you've played but fell
  // outside the top 25, show your rank separately.
  let you: { rank: number; score: number; inTop: boolean } | null = null;
  if (user) {
    const mine = await prisma.round.findUnique({
      where: { userId_dateKey: { userId: user.id, dateKey: key } },
    });
    if (mine?.completed) {
      const { rank } = await fieldStats(key, mine.score);
      you = { rank, score: mine.score, inTop: board.some((r) => r.userId === user.id) };
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div className="eyebrow">Leaderboard · No. {puzzleNumber()}</div>
        <div className="acct">
          <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
          <SignedOut>
            <SignInButton mode="modal"><button className="acct-link">Sign in</button></SignInButton>
            <SignUpButton mode="modal"><button className="acct-link">Sign up</button></SignUpButton>
          </SignedOut>
        </div>
      </div>

      <div className="nameplate">
        <div className="lbl">Today&apos;s Course</div>
        <h2>{course.name}</h2>
        <div className="loc">{course.location} · Par {coursePar(course)}</div>
      </div>

      {board.length === 0 ? (
        <div className="profile-empty">
          No finished rounds yet today. Be the first — play today&apos;s round to top the board.
        </div>
      ) : (
        <>
          <div className="section-title">Today&apos;s Leaderboard</div>
          <div className="lb">
            {board.map((r) => <Row key={r.id} r={r} meId={user?.id} />)}
          </div>
          {you && !you.inTop && (
            <div className="stats-line">Your rank today: <strong>#{you.rank}</strong> · {you.score}</div>
          )}
        </>
      )}

      <div className="btn-stack">
        {!you && (
          <Link href="/play" className="cta">Play today&apos;s round ⛳</Link>
        )}
        <Link href="/friends" className="cta ghost">Friends 👥</Link>
        <Link href="/" className="cta ghost">Back to today</Link>
      </div>
    </div>
  );
}

// Same row markup as the result screen: rank · avatar+name (public accounts
// link to their profile, guests/private render plain) · time · score.
function Row({ r, meId }: { r: BoardEntry; meId?: string }) {
  const isYou = r.userId === meId;
  return (
    <div className={`lb-row ${isYou ? "you" : ""}`}>
      <span className="rank">{r.rank}</span>
      <span className="nm">
        <span className="nm-row">
          <Avatar src={r.imageUrl} name={r.username} className="lb-av" />
          {r.isAccount && r.profilePublic ? (
            <Link className="lb-name-link" href={`/u/${r.username}`}>{isYou ? "You" : r.username}</Link>
          ) : (
            <span className={r.isAccount ? undefined : "lb-name-guest"}>{isYou ? "You" : r.username}</span>
          )}
        </span>
        {r.xHandle && (
          <a className="xh" href={xHandleUrl(r.xHandle)} target="_blank" rel="noopener noreferrer">
            {xHandleLabel(r.xHandle)}
          </a>
        )}
      </span>
      <span className="tm">{r.durationMs ? Math.round(r.durationMs / 1000) + "s" : ""}</span>
      <span className="sc">{r.score}</span>
    </div>
  );
}
