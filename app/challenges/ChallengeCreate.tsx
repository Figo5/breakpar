"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Create a challenge: opponent username + course (default today's daily). On
// success, jump straight into playing your side of the shared seed.
export function ChallengeCreate({
  courses,
  dailyName,
  prefillOpponent,
}: {
  courses: { slug: string; name: string }[];
  dailyName: string;
  prefillOpponent: string;
}) {
  const router = useRouter();
  const [opponent, setOpponent] = useState(prefillOpponent);
  const [courseSlug, setCourseSlug] = useState(""); // "" = today's daily
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!!prefillOpponent);

  async function create() {
    const name = opponent.trim().replace(/^@+/, "");
    if (!name || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opponentUsername: name, courseSlug: courseSlug || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(
          data.error === "not-found" ? "No player with that username." :
          data.error === "self" ? "You can't challenge yourself." :
          "Couldn't create the challenge."
        );
        setBusy(false);
        return;
      }
      // Start playing my side immediately.
      router.push(`/play?challenge=${data.id}`);
    } catch {
      setErr("Couldn't reach the server.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="cta" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>
        New challenge ⚔️
      </button>
    );
  }

  return (
    <div className="ch-create">
      <input
        className="fs-input"
        type="text"
        autoComplete="off"
        placeholder="Opponent username"
        value={opponent}
        onChange={(e) => setOpponent(e.target.value)}
      />
      <select className="fs-input ch-select" value={courseSlug} onChange={(e) => setCourseSlug(e.target.value)}>
        <option value="">Today&apos;s daily — {dailyName}</option>
        {courses.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
      </select>
      <div className="ch-create-actions">
        <button className="cta" disabled={busy || !opponent.trim()} onClick={create}>
          {busy ? "Creating…" : "Challenge & play ⚔️"}
        </button>
        <button className="cta ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <div className="fb-err">{err}</div>}
    </div>
  );
}
