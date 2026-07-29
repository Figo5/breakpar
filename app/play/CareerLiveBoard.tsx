"use client";

import { useCallback, useEffect, useState } from "react";

import type { CareerLiveLeaderboardView } from "@/lib/career/read";

/** Score relative to par, with level shown as E. */
function toPar(value: number): string {
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * The leaderboard during a Career round.
 *
 * Re-reads after each completed hole so the standings a player uses to decide
 * how to attack the next hole are the standings through the hole they just
 * finished. Every rival is reported through that same hole by the server, so
 * nothing here can reveal a score the player has not reached.
 *
 * Career only — no other mode mounts this, and no other mode's score display
 * changes.
 */
export function CareerLiveBoard({
  eventId,
  holesPlayed,
}: {
  eventId: string;
  holesPlayed: number;
}) {
  const [view, setView] = useState<CareerLiveLeaderboardView | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/career/event/${encodeURIComponent(eventId)}/live`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      setView(await response.json() as CareerLiveLeaderboardView);
    } catch {
      // A leaderboard is context, never a blocker: leave the last good view up
      // and let the next completed hole refresh it.
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load, holesPlayed]);

  if (!view) return null;

  const { player } = view;
  const strip = (
    <div className="career-live-strip">
      <b>{player.positionLabel}</b>
      <span>Round <i>{toPar(player.roundRelativeToPar)}</i></span>
      <span>Event <i>{toPar(player.eventRelativeToPar)}</i></span>
    </div>
  );

  if (!view.available) {
    // Formed before per-hole rival cards existed. Show the player their own
    // numbers rather than splitting a stored total into invented holes.
    return (
      <div className="career-live">
        {strip}
        <p className="career-live-note">
          Live standings arrive with your next event — this one was set up before
          hole-by-hole rival cards.
        </p>
      </div>
    );
  }

  // Top five, plus the player's own row when they sit outside it.
  const top = view.rows.slice(0, 5);
  const mine = view.rows.find((row) => row.isMe);
  const shown = expanded
    ? view.rows
    : mine && !top.some((row) => row.isMe)
      ? [...top, mine]
      : top;

  return (
    <div className="career-live">
      {strip}
      <div className="career-live-head">
        <span>Pos</span><span>Player</span><span>Rd</span><span>Event</span><span>Thru</span>
      </div>
      {shown.map((row, index) => (
        <div
          className={`career-live-row ${row.isMe ? "is-me" : ""} ${
            !expanded && mine && index === 5 ? "is-detached" : ""
          }`}
          key={row.competitorId}
        >
          <span>{row.positionLabel}</span>
          <span className="career-live-name">{row.displayName}</span>
          <span>{toPar(row.roundRelativeToPar)}</span>
          <span><b>{toPar(row.eventRelativeToPar)}</b></span>
          <span>{row.thruLabel}</span>
        </div>
      ))}
      <button
        type="button"
        className="career-live-toggle"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        {expanded ? "Show top five" : `Full leaderboard · ${view.rows.length} players`}
      </button>
    </div>
  );
}
