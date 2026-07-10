"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const BOT_ROSTER = [
  { key: "rusty", name: "Rusty", blurb: "Plays everything down the middle. Beatable — usually." },
  { key: "scratch", name: "Scratch", blurb: "Picks the right spots. Attacks good lies, respects hard holes." },
  { key: "ace", name: "Ace", blurb: "Reads the round like a tour pro. Charges when behind, protects a lead." },
];

/**
 * "Play a bot" — creates the bot challenge and starts the round in one POST,
 * then drops the player straight onto the tee. While you play, the bot's
 * score reveals hole-by-hole alongside yours (see OpponentStrip).
 */
export function BotChallengeCard() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (bot: string) => {
    if (busy) return;
    setBusy(bot);
    setError(null);
    try {
      const res = await fetch("/api/challenge/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        challengeId?: string;
        error?: string;
      };
      if (!res.ok || !json.challengeId) {
        const code = json.error ?? `http-${res.status}`;
        setError(
          code === "account-required"
            ? "Sign in to play a bot."
            : code === "course-not-seeded"
              ? "Today's course isn't in this database yet — run npm run db:seed."
              : `Couldn't start (${code}).`
        );
        setBusy(null);
        return;
      }
      router.push(`/play?challenge=${json.challengeId}`);
    } catch {
      setError("Couldn't start — try again.");
      setBusy(null);
    }
  };

  return (
    <div className="bot-card">
      <div className="bot-card-head">
        <div className="bot-card-title">Play a bot</div>
        <div className="bot-card-sub">Today&apos;s course, live head-to-head. Their score reveals as you play.</div>
      </div>
      <div className="bot-list">
        {BOT_ROSTER.map((b) => (
          <button key={b.key} className="bot-row" onClick={() => start(b.key)} disabled={busy !== null}>
            <span className="bot-row-name">{busy === b.key ? "Teeing up…" : b.name}</span>
            <span className="bot-row-blurb">{b.blurb}</span>
          </button>
        ))}
      </div>
      {error ? <div className="bot-card-error">{error}</div> : null}
    </div>
  );
}