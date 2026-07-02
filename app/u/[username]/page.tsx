import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { getPublicProfile, type PublicProfile, type FollowContext } from "@/lib/publicProfile";
import { ProfileFollow } from "./ProfileFollow";
import { relativeLabel } from "@/lib/scoring";
import { TIER_META, type TrophyState } from "@/lib/trophies";
import { xHandleLabel, xHandleUrl } from "@/lib/xHandle";
import { Avatar } from "@/components/Avatar";

// Public profile at /u/[username] — account-only, read-only for strangers.
// Guests have no profile (resolution targets accounts). Private profiles show a
// "private" state to everyone but the owner.

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const res = await getPublicProfile(decodeURIComponent(username));
  if (res.kind === "not-found") return { title: "Break Par — profile" };
  if (res.kind === "private") return { title: `${res.username} — Break Par`, robots: { index: false } };
  const p = res.profile;
  const title = `${p.username} — Break Par`;
  const description = `${p.coursesConquered}/${p.coursesTotal} courses · best ${p.bestToPar !== null ? relativeLabel(p.bestToPar) : "—"} · ${p.roundsPlayed} rounds.`;
  return { title, description, openGraph: { title, description, url: `/u/${p.username}` } };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const res = await getPublicProfile(decodeURIComponent(username));
  if (res.kind === "not-found") notFound();

  return (
    <div className="screen">
      <div className="topbar">
        <div className="eyebrow">Player Profile</div>
        <div className="acct">
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal"><button className="acct-link">Sign in</button></SignInButton>
            <SignUpButton mode="modal"><button className="acct-link">Sign up</button></SignUpButton>
          </SignedOut>
        </div>
      </div>

      {res.kind === "private" ? (
        <PrivateState username={res.username} follow={res.follow} />
      ) : (
        <ProfileBody p={res.profile} follow={res.follow} />
      )}

      <div className="btn-stack">
        <Link href="/" className="cta ghost">Back to today</Link>
      </div>
    </div>
  );
}

function PrivateState({ username, follow }: { username: string; follow: FollowContext }) {
  return (
    <>
      <div className="profile-head">
        <Avatar src={null} name={username} />
        <div className="who">
          <h2>{username}</h2>
          <div className="sub">Profile is private</div>
          <ProfileFollow username={username} follow={follow} />
        </div>
      </div>
      <div className="profile-empty">This player keeps their profile private.</div>
    </>
  );
}

function ProfileBody({ p, follow }: { p: PublicProfile; follow: FollowContext }) {
  const since = new Date(p.memberSince).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return (
    <>
      <div className="profile-head">
        <Avatar src={p.imageUrl} name={p.username} />
        <div className="who">
          <h2>{p.username}</h2>
          <div className="sub">
            {p.xHandle && (
              <a className="xh" href={xHandleUrl(p.xHandle)} target="_blank" rel="noopener noreferrer">
                {xHandleLabel(p.xHandle)}
              </a>
            )}
            {p.xHandle ? " · " : ""}Member since {since}
          </div>
          <ProfileFollow username={p.username} follow={follow} />
        </div>
      </div>

      {p.isOwner && (
        <div className="footnote" style={{ marginTop: 0 }}>
          This is your public profile{p.isPublic ? "" : " (currently private — only you can see it)"}.
        </div>
      )}

      {p.featured.length > 0 && (
        <>
          <div className="section-title">Featured Trophies</div>
          <div className="trophy-grid">
            {p.featured.map((t) => <FeaturedTrophy key={t.id} t={t} />)}
          </div>
        </>
      )}

      <div className="section-title">Stats</div>
      <div className="start-stats">
        <div className="stat-card">
          <div className="n">{p.coursesConquered}<span style={{ fontSize: 14, opacity: 0.6 }}>/{p.coursesTotal}</span></div>
          <div className="k">Courses conquered</div>
        </div>
        <div className="stat-card">
          <div className="n">{p.bestToPar !== null ? relativeLabel(p.bestToPar) : "—"}</div>
          <div className="k">Best to par</div>
        </div>
        <div className="stat-card">
          <div className="n">{p.roundsPlayed}</div>
          <div className="k">Rounds</div>
        </div>
      </div>
      <div className="stats-line">
        {p.currentStreak > 0 ? `🔥 ${p.currentStreak}-day streak` : "No active streak"} · best run {p.bestStreak}
      </div>

      {p.records.length > 0 && (
        <>
          <div className="section-title">Course Records</div>
          <div className="lb">
            {p.records.map((r) => (
              <div key={r.slug} className="lb-row">
                <span className="rank">{r.relativeToPar! < 0 ? "🏆" : ""}</span>
                <span className="nm">{r.courseName}</span>
                <span className="tm">Par {r.par}</span>
                <span className="sc">{relativeLabel(r.relativeToPar!)}</span>
              </div>
            ))}
          </div>
          {p.isOwner && (
            <Link href="/hall" className="cta ghost" style={{ marginTop: 10 }}>
              View full Hall of Fame 🏆
            </Link>
          )}
        </>
      )}

      {p.recent.length > 0 && (
        <>
          <div className="section-title">Recent Activity</div>
          <div className="lb">
            {p.recent.map((r) => (
              <div key={r.id} className="lb-row">
                <span className="rank" />
                <span className="nm">
                  {r.courseName}
                  <span className="prow-tag">{r.mode === "daily" ? (r.puzzleNo ? `#${r.puzzleNo}` : "Daily") : "Practice"}</span>
                </span>
                <span className="tm">{new Date(r.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <span className="sc">{relativeLabel(r.relativeToPar)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function FeaturedTrophy({ t }: { t: TrophyState }) {
  return (
    <div className={`trophy earned t-${t.tier}`}>
      <div className="trophy-badge">{TIER_ICON[t.tier]}</div>
      <div className="trophy-name">{t.label}</div>
      {!t.special && <div className="trophy-tier-label">{TIER_META[t.tier].label}</div>}
    </div>
  );
}

const TIER_ICON: Record<TrophyState["tier"], string> = {
  common: "🎖️",
  rare: "🏅",
  elite: "🏆",
  legendary: "👑",
  special: "✦",
};
