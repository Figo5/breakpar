"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CareerEventLeaderboardView } from "@/lib/career/read";
import {
  cumulativeLabel,
  lifecycleLabel,
  pointsLabel,
  revealLabel,
  roundProgressLabel,
  scoreLabel,
} from "../../career-ui";
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
  const progress = view.playerProgress;
  const eventComplete = progress.roundsCompleted >= progress.roundsTotal;
  const playable = event.state === "ACTIVE" && !eventComplete;
  const nextRound = progress.nextRound ?? progress.roundsTotal;
  // Scores stay hidden until the player's own card for the round is in: knowing
  // the number to beat would change how they play it.
  const hidden = !view.revealed;

  return (
    <CareerChrome eyebrow="Event">
      <div className="career-event-hero">
        <div className="career-kicker">
          Event {event.eventNumber ?? "—"} · {lifecycleLabel(event.state)}
        </div>
        <h1>{event.courseName}</h1>
        <p>{event.courseLocation}</p>
      </div>

      <div className="career-event-progress">
        <div>
          <span>Your progress</span>
          <b>{roundProgressLabel(progress.roundsCompleted, progress.roundsTotal)}</b>
        </div>
        <div>
          <span>Cumulative</span>
          <b>
            {progress.roundsCompleted > 0
              ? scoreLabel(progress.cumulativeRelativeToPar)
              : "—"}
          </b>
        </div>
      </div>

      {playable && (
        <Link href={`/play?careerEvent=${encodeURIComponent(event.id)}`} className="cta career-primary">
          {progress.currentRoundId ? `Resume round ${nextRound}` : `Play round ${nextRound}`}
        </Link>
      )}
      {eventComplete && event.state === "ACTIVE" && (
        <div className="career-context good">
          <b>Your card is posted</b>
          All {progress.roundsTotal} rounds are in. Your cumulative score counts toward the season.
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
          <b>{revealLabel(view.roundsRevealed, progress.roundsTotal)}</b>
        </div>
        <Link href="/career/season">Season →</Link>
      </div>

      {hidden && (
        <div className="career-context">
          <b>
            {view.roundCardsAvailable
              ? "Scores unlock as you play"
              : "Scores unlock when you finish"}
          </b>
          {view.roundCardsAvailable
            ? `Your nineteen rivals are already out there. Post round ${nextRound} and the whole field's cards through that round appear — the rounds after it stay sealed until you reach them.`
            : "This event was formed before round-by-round cards were stored, so rival scores stay sealed until you complete every round. Nothing here is estimated."}
        </div>
      )}

      {view.standings.length === 0 ? (
        <div className="career-empty">
          <b>No field published yet.</b>
          <span>Your rivals are still being set for this event.</span>
        </div>
      ) : (
        <div className="career-board">
          <div className="career-board-head">
            <span>Pos</span>
            <span>Player</span>
            <span>{view.roundsRevealed >= progress.roundsTotal ? "Total" : "Thru"}</span>
            <span>{view.settled ? "Pts" : "Rds"}</span>
          </div>
          {view.standings.map((row) => (
            <div className={`career-board-row ${row.isMe ? "is-me" : ""}`} key={row.competitorId}>
              <span>{row.rank ?? "—"}</span>
              <span>
                <b>{row.displayName}</b>
                <small>{row.isMe ? "You" : "Rival"}</small>
              </span>
              <span>{hidden ? "—" : cumulativeLabel(row.relativeToPar)}</span>
              <span>
                {view.settled
                  ? pointsLabel(row.points)
                  : hidden
                    ? "—"
                    : `${row.roundsCompleted}/${progress.roundsTotal}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {!hidden && !view.settled && view.roundsRevealed < progress.roundsTotal && (
        <div className="career-context">
          <b>Live through round {view.roundsRevealed}</b>
          Every score above is cumulative through round {view.roundsRevealed} only. Rounds{" "}
          {view.roundsRevealed + 1} to {progress.roundsTotal} are sealed for the whole field, and
          event points are awarded once all {progress.roundsTotal} rounds are in.
        </div>
      )}

      <div className="career-links">
        <Link href="/career" className="cta ghost">Back to my career</Link>
      </div>
    </CareerChrome>
  );
}
