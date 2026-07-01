import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { getHallOfFame, type CourseRecord } from "@/lib/hallOfFame";
import { relativeLabel } from "@/lib/scoring";

// Server component — the player's Hall of Fame: their best card on every course
// (daily or unlimited), with unplayed courses shown as open slots to chase.
// Read-only; works for guests (their records carry over on sign-up).
export default async function Hall() {
  const hof = await getHallOfFame();

  return (
    <div className="screen">
      <div className="topbar">
        <div className="eyebrow">Hall of Fame</div>
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

      <div className="wordmark" style={{ fontSize: "clamp(36px,11vw,52px)" }}>
        Hall of Fame
      </div>
      <div className="tagline">
        Your best card on every course — daily or practice. Chase the open slots and beat your records.
      </div>

      {!hof || hof.coursesPlayed === 0 ? (
        <>
          <div className="profile-empty">
            No records yet. Play any course and your best card lands here.
          </div>
          <div className="btn-stack">
            <Link href="/play" className="cta">Play today&apos;s round ⛳</Link>
            <Link href="/courses" className="cta ghost">Browse courses</Link>
            <Link href="/" className="cta ghost">Back to today</Link>
          </div>
          {hof && !hof.signedIn && (
            <div className="footnote">
              Playing as a guest — your Hall of Fame is saved. Sign up to keep it across devices.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="start-stats">
            <div className="stat-card">
              <div className="n">{hof.coursesPlayed}<span style={{ fontSize: 14, opacity: 0.6 }}>/{hof.coursesTotal}</span></div>
              <div className="k">Courses conquered</div>
            </div>
            <div className="stat-card">
              <div className="n">{hof.recordsUnderPar || "—"}</div>
              <div className="k">Records under par</div>
            </div>
            <div className="stat-card">
              <div className="n">{hof.bestOverall !== null ? relativeLabel(hof.bestOverall) : "—"}</div>
              <div className="k">Best card</div>
            </div>
          </div>

          <div className="section-title">Course Records</div>
          <div className="lb">
            {hof.records.map((r) => (
              <RecordRow key={r.slug} r={r} />
            ))}
          </div>

          <div className="btn-stack">
            <Link href="/courses" className="cta ghost">Play unlimited · Browse courses</Link>
            <Link href="/profile" className="cta ghost">Your profile</Link>
            <Link href="/" className="cta ghost">Back to today</Link>
          </div>

          {!hof.signedIn && (
            <div className="footnote">
              Playing as a guest — your Hall of Fame is saved. Sign up to keep it across devices.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecordRow({ r }: { r: CourseRecord }) {
  // Conquered course → best card, links to that round's result.
  if (r.played) {
    const tag = r.mode === "daily" ? (r.puzzleNo ? `#${r.puzzleNo}` : "Daily") : "Practice";
    const badge = r.relativeToPar! < 0 ? "🏆" : "";
    return (
      <Link href={`/result/${r.roundId}`} className="lb-row prow">
        <span className="rank">{badge}</span>
        <span className="nm">
          {r.courseName}
          <span className="prow-tag">{tag}</span>
        </span>
        <span className="tm">Par {r.par}</span>
        <span className="sc">{relativeLabel(r.relativeToPar!)}</span>
      </Link>
    );
  }
  // Open slot → not played yet, links to start a practice round on it.
  return (
    <Link href={`/play?course=${r.slug}`} className="lb-row prow" style={{ opacity: 0.72 }}>
      <span className="rank">＋</span>
      <span className="nm">
        {r.courseName}
        <span className="prow-tag">Open</span>
      </span>
      <span className="tm">Par {r.par}</span>
      <span className="sc" style={{ fontSize: 12, color: "var(--ink-soft)" }}>Play</span>
    </Link>
  );
}
