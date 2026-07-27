"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CareerEventLeaderboardView } from "@/lib/career/read";
import { lifecycleLabel, pointsLabel, scoreLabel } from "../../career-ui";
import { CareerChrome, CareerError, CareerLoading } from "../../CareerChrome";

export function CareerEvent({ eventId }: { eventId: string }) {
  const [view, setView] = useState<CareerEventLeaderboardView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/career/event/${encodeURIComponent(eventId)}/leaderboard`, {
        cache: "no-store",
      });
      if (response.status === 404) throw new Error("That event is not part of your career.");
      if (!response.ok) throw new Error("The leaderboard is temporarily unavailable.");
      setView(await response.json() as CareerEventLeaderboardView);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) {
    return (
      <CareerChrome eyebrow="Event">
        {error ? <CareerError message={error} retry={() => void load()} /> : <CareerLoading label="Walking to the event…" />}
      </CareerChrome>
    );
  }

  const event = view.competition;
  const playable = event.state === "ACTIVE";
  // Opponents stay hidden until the player's own card is in: knowing the number
  // to beat would change how they play the round.
  const hidden = !view.revealed;

  return (
    <CareerChrome eyebrow="Event">
      <div className="career-event-hero">
        <div className="career-kicker">Event {event.eventNumber ?? "—"} · {lifecycleLabel(event.state)}</div>
        <h1>{event.courseName}</h1>
        <p>{event.courseLocation}</p>
      </div>

      {playable && hidden && (
        <Link href={`/play?careerEvent=${encodeURIComponent(event.id)}`} className="cta career-primary">
          Play this event
        </Link>
      )}
      {playable && !hidden && (
        <div className="career-context good">
          <b>Your card is posted</b>
          One attempt per event — this one is done. Your score counts toward the season.
        </div>
      )}
      {event.state === "FORMING" || event.state === "LOCKING" ? (
        <div className="career-context">
          <b>Preparing the field</b>
          Your rivals are being set. This takes a moment — refresh shortly.
        </div>
      ) : null}
      {["ENDED", "SETTLED"].includes(event.state) && (
        <div className={`career-context ${view.settled ? "good" : ""}`}>
          <b>{view.settled ? "Leaderboard final" : "Scoring"}</b>
          {view.settled
            ? "Points are locked and now count toward the season."
            : "The final card is being published."}
        </div>
      )}

      <div className="career-section-head">
        <div>
          <span>{view.settled ? "Final leaderboard" : "Leaderboard"}</span>
          <b>{hidden ? "Hidden" : `${view.standings.length || "—"} players`}</b>
        </div>
        <Link href="/career/season">Season →</Link>
      </div>

      {hidden ? (
        <div className="career-empty">
          <b>Scores are revealed when you finish.</b>
          <span>
            Your nineteen rivals have already played this course. Their cards stay
            sealed until yours is in, so you play your own round — not theirs.
          </span>
        </div>
      ) : view.standings.length === 0 ? (
        <div className="career-empty">
          <b>No scores on the board yet.</b>
          <span>This event has no published field.</span>
        </div>
      ) : (
        <div className="career-board">
          <div className="career-board-head">
            <span>Pos</span><span>Player</span><span>Score</span><span>Pts</span>
          </div>
          {view.standings.map((row) => (
            <div className="career-board-row" key={row.competitorId}>
              <span>{row.rank ?? "—"}</span>
              <span>
                <b>{row.displayName}</b>
                <small>{row.competitorType === "BOT" ? "Rival" : "You"}</small>
              </span>
              <span>{scoreLabel(row.relativeToPar)}</span>
              <span>{pointsLabel(row.points)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="career-links">
        <Link href="/career" className="cta ghost">Back to my career</Link>
      </div>
    </CareerChrome>
  );
}
