import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { relativeLabel } from "@/lib/scoring";
import { Avatar } from "@/components/Avatar";
import { getAccountUser, listFriends, countFollowers, type FriendEntry } from "@/lib/friends";
import { FriendSearch } from "./FriendSearch";
import { FollowButton } from "./FollowButton";

// Friends (Stage 1) — accounts only. Search for players, follow them, and see
// your friends' (mutual follows') daily results. Guests get a sign-up prompt.
//
// Follow-style is asymmetric, so the list is split to remove the "why aren't
// they my friend?" confusion:
//   • Friends   = mutual follow (you follow each other)
//   • Following = you follow them, they haven't followed back yet
export default async function FriendsPage() {
  const me = await getAccountUser();
  if (!me) {
    return (
      <div className="screen">
        <Topbar />
        <div className="profile-empty">
          Friends are an account feature. Sign up to find players, follow them, and
          see how your friends score each day.
        </div>
        <div className="btn-stack">
          <SignedOut>
            <SignUpButton mode="modal"><button className="cta">Sign up</button></SignUpButton>
          </SignedOut>
          <Link href="/" className="cta ghost">Back to today</Link>
        </div>
      </div>
    );
  }

  const [entries, followers] = await Promise.all([
    listFriends(me.id, relativeLabel),
    countFollowers(me.id),
  ]);
  const friends = entries.filter((e) => e.state === "friend");
  const following = entries.filter((e) => e.state === "following");

  return (
    <div className="screen">
      <Topbar />

      <FriendSearch />

      <div className="friends-meta">
        {friends.length} {friends.length === 1 ? "friend" : "friends"} ·{" "}
        {following.length} following · {followers} {followers === 1 ? "follower" : "followers"}
      </div>

      <div className="section-title">Friends</div>
      {friends.length === 0 ? (
        <div className="profile-empty">
          No friends yet. When someone you follow follows you back, they show up here.
        </div>
      ) : (
        <div className="lb">
          {friends.map((f) => <FriendRow key={f.username} f={f} />)}
        </div>
      )}

      {following.length > 0 && (
        <>
          <div className="section-title">Following</div>
          <div className="section-sub">You follow them — they haven&apos;t followed back yet.</div>
          <div className="lb">
            {following.map((f) => <FriendRow key={f.username} f={f} />)}
          </div>
        </>
      )}

      <div className="btn-stack">
        <Link href="/challenges" className="cta ghost">Challenges ⚔️</Link>
        <Link href="/leaderboard" className="cta ghost">Today&apos;s leaderboard 🏆</Link>
        <Link href="/" className="cta ghost">Back to today</Link>
      </div>
    </div>
  );
}

function Topbar() {
  return (
    <div className="topbar">
      <div className="eyebrow">Friends</div>
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
  );
}

function FriendRow({ f }: { f: FriendEntry }) {
  // A real to-par score renders emphasised; "Private"/"Not played" are muted so
  // they read as state, not a result — and never crowd the name (own track).
  const scored = !f.today.private && f.today.played;
  const result = f.today.private ? "Private" : f.today.played ? f.today.score : "Not played";
  return (
    <div className="lb-row frow">
      <span className="rank frow-av">
        <Avatar src={f.imageUrl} name={f.username} className="lb-av" />
      </span>
      <span className="nm">
        <span className="nm-row">
          <Link href={`/u/${f.username}`} className="lb-name-link">{f.username}</Link>
          <span className="prow-tag">{f.state === "friend" ? "Friends" : "Following"}</span>
        </span>
      </span>
      <span className={`sc${scored ? "" : " muted"}`}>{result}</span>
      <span className="frow-actions">
        <Link href={`/challenges?to=${encodeURIComponent(f.username)}`} className="cta ghost fs-btn">Challenge</Link>
        <FollowButton username={f.username} following label="Unfollow" />
      </span>
    </div>
  );
}
