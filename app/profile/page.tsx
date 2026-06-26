import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { getProfile, type ProfileRound } from "@/lib/profile";
import { relativeLabel } from "@/lib/scoring";

// Server component — the player's profile: lifetime stats, their personal
// best-rounds leaderboard, and recent games. Modeled on the 82-0 profile.
export default async function Profile() {
  const me = await getProfile();
  const initial = (me?.username?.[0] ?? "G").toUpperCase();

  return (
    <div className="screen">
      <div className="topbar">
        <div className="eyebrow">Your Profile</div>
        <div className="acct">
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="acct-link">Sign in</button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="acct-link">Sign up</button>
            </SignUpButton>
          </SignedOut>
        </div>
      </div>

      <div className="profile-head">
        <div className="avatar">{initial}</div>
        <div className="who">
          <h2>{me?.username ?? "Guest"}</h2>
          <div className="sub">
            {me?.signedIn ? "Signed in" : "Playing as guest"}
          </div>
        </div>
      </div>

      {!me || me.roundsPlayed === 0 ? (
        <>
          <div className="profile-empty">
            No rounds yet. Play your first round to start your card.
          </div>
          <div className="btn-stack">
            <Link href="/play" className="cta">Tee off ⛳</Link>
            <Link href="/" className="cta ghost">Back to today</Link>
          </div>
          {!me?.signedIn && (
            <div className="footnote">
              Playing as a guest — sign up to keep your stats across devices.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="start-stats">
            <div className="stat-card">
              <div className="n">{me.roundsPlayed}</div>
              <div className="k">Rounds played</div>
            </div>
            <div className="stat-card">
              <div className="n">{me.bestToPar !== null ? relativeLabel(me.bestToPar) : "—"}</div>
              <div className="k">Best to par</div>
            </div>
            <div className="stat-card">
              <div className="n">{me.underParRounds || "—"}</div>
              <div className="k">Under par</div>
            </div>
          </div>

          <div className="stats-line">
            {me.dayStreak > 0 ? `🔥 ${me.dayStreak}-day streak` : "No active streak"} · best run {me.bestStreak}
          </div>

          <div className="section-title">Best Rounds</div>
          <div className="lb">
            {me.bestRounds.map((r) => (
              <RoundRow key={r.id} r={r} />
            ))}
          </div>

          <div className="section-title">Recent Games</div>
          <div className="lb">
            {me.recentRounds.map((r) => (
              <RoundRow key={`recent-${r.id}`} r={r} showDate />
            ))}
          </div>

          <div className="btn-stack">
            <Link href="/play" className="cta">Play today&apos;s round ⛳</Link>
            <Link href="/courses" className="cta ghost">Play unlimited · Browse courses</Link>
            <Link href="/" className="cta ghost">Back to today</Link>
          </div>

          {!me.signedIn && (
            <div className="footnote">
              Playing as a guest — sign up to keep these stats across devices.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RoundRow({ r, showDate = false }: { r: ProfileRound; showDate?: boolean }) {
  const tag = r.mode === "daily" ? (r.puzzleNo ? `#${r.puzzleNo}` : "Daily") : "Practice";
  const meta = showDate
    ? new Date(r.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : r.durationMs
      ? `${Math.round(r.durationMs / 1000)}s`
      : "";
  return (
    <Link href={`/result/${r.id}`} className="lb-row prow">
      <span className="rank">{showDate ? "" : r.rank}</span>
      <span className="nm">
        {r.courseName}
        <span className="prow-tag">{tag}</span>
      </span>
      <span className="tm">{meta}</span>
      <span className="sc">{relativeLabel(r.relativeToPar)}</span>
    </Link>
  );
}
