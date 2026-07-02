"use client";
import { useState } from "react";
import { SignUpButton } from "@clerk/nextjs";
import type { FollowContext } from "@/lib/publicProfile";

// Follow / Following control for a public profile. Reuses the SAME follow logic
// as the friends page — the /api/friends POST/DELETE endpoints (server-gated,
// accounts-only) — with optimistic local state so it flips instantly.
//
//   owner  -> nothing (no self-follow; owner state is shown elsewhere)
//   guest  -> "Sign up to follow" (Clerk sign-up, accounts-only)
//   else   -> Follow  <->  Following (unfollow on click)
// A private profile is still followable — their results just stay hidden.
export function ProfileFollow({ username, follow }: { username: string; follow: FollowContext }) {
  const [following, setFollowing] = useState(follow.isFollowing);
  const [busy, setBusy] = useState(false);

  if (follow.isSelf) return null;

  if (follow.isGuest) {
    return (
      <SignUpButton mode="modal">
        <button className="cta profile-follow">Sign up to follow</button>
      </SignUpButton>
    );
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/friends", {
        method: following ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (res.ok) setFollowing((f) => !f);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`cta profile-follow${following ? " ghost" : ""}`}
      onClick={toggle}
      disabled={busy}
    >
      {busy ? "…" : following ? "Following ✓" : "Follow"}
    </button>
  );
}
