import Link from "next/link";
import { notFound } from "next/navigation";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { relativeLabel } from "@/lib/scoring";
import { Avatar } from "@/components/Avatar";
import { getAccountUser } from "@/lib/friends";
import { getChallenge, type ChallengeSide } from "@/lib/challenge";
import { ChallengeActions } from "../ChallengeActions";

// Challenge detail — side-by-side result. Only participants can view it.
export default async function ChallengeDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await getAccountUser();
  const { id } = await params;
  const c = me ? await getChallenge(me.id, id) : null;
  if (me && !c) notFound();

  return (
    <div className="screen">
      <div className="topbar">
        <div className="eyebrow">Challenge</div>
        <div className="acct">
          <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
          <SignedOut>
            <SignInButton mode="modal"><button className="acct-link">Sign in</button></SignInButton>
            <SignUpButton mode="modal"><button className="acct-link">Sign up</button></SignUpButton>
          </SignedOut>
        </div>
      </div>

      {!me ? (
        <div className="profile-empty">Sign in to view this challenge.</div>
      ) : (
        <>
          <div className="ch-head">
            <div className="ch-course">{c!.courseName}</div>
            <div className="ch-status">{statusLine(c!.status, c!.verdict)}</div>
          </div>

          <div className="ch-versus">
            <SideCard side={c!.me} you badge={c!.verdict === "win" ? "🏆" : null} />
            <div className="ch-vs">vs</div>
            <SideCard side={c!.them} badge={c!.verdict === "loss" ? "🏆" : null} />
          </div>

          {c!.status !== "complete" && (
            <div className="ch-detail-actions">
              <ChallengeActions
                id={c!.id}
                canPlay={!c!.me.completed}
                canDecline={!c!.iAmChallenger && !c!.me.completed}
              />
            </div>
          )}

          <div className="footnote">
            Both players play the identical seeded course — same holes, same conditions.
            Lowest score to par wins. Challenge rounds don&apos;t affect your streak, leaderboard or trophies.
          </div>

          <div className="btn-stack">
            <Link href="/challenges" className="cta ghost">All challenges</Link>
            <Link href="/" className="cta ghost">Back to today</Link>
          </div>
        </>
      )}
    </div>
  );
}

function statusLine(status: string, verdict: string | null) {
  if (status === "complete") return verdict === "win" ? "You won 🏆" : verdict === "loss" ? "You lost" : "Draw";
  return "In progress — waiting for both to finish";
}

function SideCard({ side, you = false, badge }: { side: ChallengeSide; you?: boolean; badge: string | null }) {
  return (
    <div className={`ch-side${you ? " you" : ""}`}>
      <Avatar src={side.imageUrl} name={side.username} className="avatar" />
      <div className="ch-side-name">{you ? "You" : side.username} {badge}</div>
      <div className="ch-side-score">
        {side.completed && side.relativeToPar != null ? relativeLabel(side.relativeToPar) : side.roundId ? "Playing…" : "Not started"}
      </div>
    </div>
  );
}
