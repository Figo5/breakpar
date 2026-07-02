"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Row actions for a challenge: Play (start/resume my side of the shared seed)
// and Decline (opponent-only). Both are compact; Play routes into /play.
export function ChallengeActions({
  id,
  canPlay,
  canDecline,
}: {
  id: string;
  canPlay: boolean;
  canDecline: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decline() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/challenge/${id}/decline`, { method: "POST" });
      if (res.ok) router.refresh();
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  if (canPlay) {
    return (
      <span className="ch-actions">
        <button className="cta fs-btn ch-play" disabled={busy} onClick={() => router.push(`/play?challenge=${id}`)}>
          Play
        </button>
        {canDecline && (
          <button className="ch-decline" disabled={busy} onClick={decline} aria-label="Decline challenge" title="Decline">
            {busy ? "…" : "✕"}
          </button>
        )}
      </span>
    );
  }
  return null;
}
