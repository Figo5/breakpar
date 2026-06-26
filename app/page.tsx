import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { dailyCourse, puzzleNumber } from "@/lib/daily";
import { coursePar } from "@/data/courses";
import { relativeLabel } from "@/lib/scoring";
import { getHomeState } from "@/lib/streak";
import { NextCourseTimer } from "./NextCourseTimer";

// Server component — the start screen. Shows today's course plus the signed-in
// player's streak/best once they've played.
export default async function Home() {
  const course = dailyCourse();
  const par = coursePar(course);
  const me = await getHomeState();

  const playedToday = !!me.playedTodayRoundId;
  const streakLabel = me.streak > 0 ? `${me.streak}` : "—";
  const bestLabel = me.bestToPar !== null ? relativeLabel(me.bestToPar) : "—";

  return (
    <div className="screen">
      <div className="topbar">
        <div className="eyebrow">Daily Challenge · No. {puzzleNumber()}</div>
        <div className="acct">
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="acct-link">Sign in to sync</button>
            </SignInButton>
          </SignedOut>
        </div>
      </div>
      <div className="wordmark">Break&nbsp;<span>Par</span></div>
      <div className="tagline">One round. 18 holes. ~2 minutes.</div>

      <div className="nameplate">
        <div className="lbl">Today&apos;s Course</div>
        <h2>{course.name}</h2>
        <div className="loc">{course.location} · Par {par}</div>
        <div className="chips">
          <div className="chip">💨 {course.wind} mph</div>
          <div className="chip">🟢 {course.greens}</div>
          <div className="chip">🎯 {course.difficulty}/10</div>
        </div>
      </div>

      <div className="start-stats">
        <div className="stat-card">
          <div className="n">{me.streak > 0 ? `🔥${streakLabel}` : streakLabel}</div>
          <div className="k">Day streak</div>
        </div>
        <div className="stat-card">
          <div className="n">{me.maxStreak || "—"}</div>
          <div className="k">Best streak</div>
        </div>
        <div className="stat-card">
          <div className="n">{bestLabel}</div>
          <div className="k">Best to par</div>
        </div>
      </div>

      {me.daysPlayed > 0 && (
        <div className="stats-line">
          {me.daysPlayed} played · {me.winPct}% under par · best run {me.maxStreak}
        </div>
      )}

      <div className="spacer" />

      {playedToday ? (
        <>
          <div className="home-note">
            ✓ You&apos;ve played today. New course in <NextCourseTimer />
          </div>
          <Link href={`/result/${me.playedTodayRoundId}`} className="cta">See today&apos;s result</Link>
          <Link href="/courses" className="cta ghost" style={{ marginTop: 10 }}>Play unlimited · Browse courses</Link>
        </>
      ) : (
        <>
          <div className="home-note">
            {me.inProgressRoundId ? "Pick up where you left off." : "Can you break par today?"}
          </div>
          <Link href="/play" className="cta">
            {me.inProgressRoundId ? "Resume round ⛳" : "Tee Off ⛳"}
          </Link>
          <Link href="/courses" className="cta ghost" style={{ marginTop: 10 }}>Play unlimited · Browse courses</Link>
        </>
      )}

      <div className="footnote">
        New course every day at 00:00 UTC. Course names are trademarks of their
        owners; Break Par is unaffiliated and layouts/yardages are stylized for play.
      </div>
    </div>
  );
}
