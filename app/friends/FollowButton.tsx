"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Follow/unfollow control for a server-rendered friends/following row. Hits the
// same /api/friends endpoint as search, then refreshes the server component so
// the list re-derives friend/following/removed state. This is what lets a user
// unfollow directly from the list (no re-search needed).
export function FollowButton({
  username,
  following,
  label,
}: {
  username: string;
  following: boolean; // true => Unfollow (DELETE); false => Follow (POST)
  label?: string; // override the resting label (e.g. "Unfollow")
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault(); // rows are wrapped in a profile <Link>; don't navigate
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/friends", {
        method: following ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (res.ok) router.refresh();
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      className={`cta ghost fs-btn${following ? " following" : ""}`}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? "…" : label ?? (following ? "Unfollow" : "Follow")}
    </button>
  );
}
