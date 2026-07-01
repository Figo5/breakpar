import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { getHallOfFame } from "@/lib/hallOfFame";
import { getTrophies } from "@/lib/trophies.server";
import { HallTabs } from "./HallTabs";

// Server component — the player's Hall of Fame: their best card on every course
// (daily or unlimited) + a derived trophy case, switched by a header toggle.
// Read-only; works for guests (their records + trophies carry over on sign-up).
export default async function Hall() {
  const [hof, trophies] = await Promise.all([getHallOfFame(), getTrophies()]);

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
        Every course conquered, every trophy earned. This is your golf résumé.
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
          <HallTabs
            records={hof.records}
            coursesPlayed={hof.coursesPlayed}
            coursesTotal={hof.coursesTotal}
            recordsUnderPar={hof.recordsUnderPar}
            bestOverall={hof.bestOverall}
            trophies={trophies}
          />

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
