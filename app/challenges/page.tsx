import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { relativeLabel } from "@/lib/scoring";
import { Avatar } from "@/components/Avatar";
import { getAccountUser } from "@/lib/friends";
import { listChallenges, type ChallengeItem } from "@/lib/challenge";
import { COURSES } from "@/data/courses";
import { dailyCourse } from "@/lib/daily";
import { ChallengeCreate } from "./ChallengeCreate";
import { BotChallengeCard } from "./BotChallengeCard";
import { ChallengeActions } from "./ChallengeActions";

// Challenges (Stage 2) — accounts only. Create a head-to-head, play the shared
// seed, and see results side by side once both finish.
export default async function ChallengesPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const me = await getAccountUser();
  const { to } = await searchParams;

  return (
    <div className="screen">
      <div className="topbar">
        <div className="eyebrow">Challenges</div>
        <div className="acct">
          <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
          <SignedOut>
            <SignInButton mode="modal"><button className="acct-link">Sign in</button></SignInButton>
            <SignUpButton mode="modal"><button className="acct-link">Sign up</button></SignUpButton>
          </SignedOut>
        </div>
      </div>

      {!me ? (
        <>
          <div className="profile-empty">
            Challenges are an account feature. Sign up to challenge a friend to the same
            course — you both play the identical seed, low score wins.
          </div>
          <div className="btn-stack">
            <SignedOut><SignUpButton mode="modal"><button className="cta">Sign up</button></SignUpButton></SignedOut>
            <Link href="/" className="cta ghost">Back to today</Link>
          </div>
        </>
      ) : (
        <ChallengesBody meId={me.id} prefillOpponent={to ?? ""} />
      )}
    </div>
  );
}

async function ChallengesBody({ meId, prefillOpponent }: { meId: string; prefillOpponent: string }) {
  const groups = await listChallenges(meId);
  const courses = COURSES.map((c) => ({ slug: c.slug, name: c.name.split("—")[0].trim() }));
  const dailyName = dailyCourse().name.split("—")[0].trim();

  return (
    <>
      <ChallengeCreate courses={courses} dailyName={dailyName} prefillOpponent={prefillOpponent} />

      <BotChallengeCard />

      <Section title="Your turn" items={groups.yourTurn} empty="No challenges waiting on you." />
      <Section title="Waiting on them" items={groups.waiting} empty="" hideIfEmpty />
      <Section title="Complete" items={groups.complete} empty="" hideIfEmpty />

      <div className="btn-stack">
        <Link href="/friends" className="cta ghost">Friends</Link>
        <Link href="/" className="cta ghost">Back to today</Link>
      </div>
    </>
  );
}

function Section({
  title, items, empty, hideIfEmpty = false,
}: { title: string; items: ChallengeItem[]; empty: string; hideIfEmpty?: boolean }) {
  if (hideIfEmpty && items.length === 0) return null;
  return (
    <>
      <div className="section-title">{title}</div>
      {items.length === 0 ? (
        <div className="profile-empty">{empty}</div>
      ) : (
        <div className="lb">{items.map((c) => <ChallengeRow key={c.id} c={c} />)}</div>
      )}
    </>
  );
}

function ChallengeRow({ c }: { c: ChallengeItem }) {
  const canPlay = !c.me.completed && c.status !== "complete";
  const score = (rel: number | null) => (rel != null ? relativeLabel(rel) : "—");
  const verdictLabel = c.verdict === "win" ? "Won" : c.verdict === "loss" ? "Lost" : "Draw";

  // Right-pinned end content by state: Your turn -> action buttons (no text);
  // Waiting -> a muted pill; Complete -> "+3 v +4 · Won". Fixed width so the
  // name/course (flex) truncates instead of pushing the controls off-screen.
  return (
    <div className="chrow">
      <Avatar src={c.them.imageUrl} name={c.them.username} className="lb-av" />
      <div className="chrow-main">
        <Link href={`/challenges/${c.id}`} className="lb-name-link chrow-name">{c.them.username}</Link>
        <span className="chrow-sub">{c.courseName}</span>
      </div>
      <div className="chrow-end">
        {c.status === "complete" ? (
          <span className={`chrow-status v-${c.verdict}`}>
            {score(c.me.relativeToPar)} v {score(c.them.relativeToPar)} · {verdictLabel}
          </span>
        ) : c.me.completed ? (
          <span className="chrow-status muted">Waiting</span>
        ) : (
          <ChallengeActions
            id={c.id}
            canPlay={canPlay}
            canDecline={!c.iAmChallenger && canPlay}
          />
        )}
      </div>
    </div>
  );
}
