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

  useEffect(() => {
    setExpanded(false);
  }, [eventId]);

  if (!view) return null;

  const { player } = view;
  const summary = (
    <button
      type="button"
      className="career-live-summary"
      onClick={() => setExpanded((open) => !open)}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} live leaderboard. Position ${player.positionLabel}, round ${toPar(player.roundRelativeToPar)}, total ${toPar(player.eventRelativeToPar)}.`}
    >
      <span><small>Position</small><b>{player.positionLabel}</b></span>
      <span><small>Round</small><b>{toPar(player.roundRelativeToPar)}</b></span>
      <span><small>Total</small><b>{toPar(player.eventRelativeToPar)}</b></span>
      <i aria-hidden="true">{expanded ? "−" : "+"}</i>
    </button>
  );

  if (!view.available) {
    // Formed before per-hole rival cards existed. Show the player their own
    // numbers rather than splitting a stored total into invented holes.
    return (
      <div className="career-live">
        {summary}
        {expanded && (
          <p className="career-live-note">
            Live standings arrive with your next event — this one was set up before
            hole-by-hole rival cards.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`career-live ${expanded ? "is-expanded" : ""}`}>
      {summary}
      {expanded && (
        <div className="career-live-board">
          <div className="career-live-head">
            <span>Pos</span><span>Player</span><span>Rd</span><span>Total</span><span>Thru</span>
          </div>
          {view.rows.map((row) => (
            <div
              className={`career-live-row ${row.isMe ? "is-me" : ""}`}
              key={row.competitorId}
            >
              <span>{row.positionLabel}</span>
              <span className="career-live-name">{row.displayName}</span>
              <span>{toPar(row.roundRelativeToPar)}</span>
              <span><b>{toPar(row.eventRelativeToPar)}</b></span>
              <span>{row.thruLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
