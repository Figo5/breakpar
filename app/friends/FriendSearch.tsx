"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";

// Client-side player search + follow. Debounced query hits /api/friends/search;
// follow/unfollow hit /api/friends and refresh the server component so the
// friends list below reflects the change.
interface Hit {
  username: string;
  imageUrl: string | null;
  isPublic: boolean;
  isFollowing: boolean;
}

export function FriendSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    const query = value.trim();
    if (!query) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setHits(Array.isArray(data.results) ? data.results : []);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  async function toggleFollow(username: string, following: boolean) {
    if (busy) return;
    setBusy(username);
    try {
      const res = await fetch("/api/friends", {
        method: following ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (res.ok) {
        setHits((hs) => hs.map((h) => (h.username === username ? { ...h, isFollowing: !following } : h)));
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="friend-search">
      <input
        className="fs-input"
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder="Find players by username…"
        value={q}
        onChange={(e) => onChange(e.target.value)}
      />
      {q.trim() && (
        <div className="fs-results">
          {loading && hits.length === 0 ? (
            <div className="fs-empty">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="fs-empty">No players found.</div>
          ) : (
            <div className="lb">
              {hits.map((h) => (
                <div key={h.username} className="lb-row frow">
                  <span className="rank frow-av">
                    <Avatar src={h.imageUrl} name={h.username} className="lb-av" />
                  </span>
                  <span className="nm">
                    <span className="nm-row">
                      <Link href={`/u/${h.username}`} className="lb-name-link">{h.username}</Link>
                    </span>
                  </span>
                  <button
                    className={`cta ghost fs-btn${h.isFollowing ? " following" : ""}`}
                    disabled={busy === h.username}
                    onClick={() => toggleFollow(h.username, h.isFollowing)}
                  >
                    {busy === h.username ? "…" : h.isFollowing ? "Following" : "Follow"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
