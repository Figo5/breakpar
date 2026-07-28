"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CareerSeasonTableView, CareerStateView } from "@/lib/career/read";
import {
  cumulativeLabel,
  movementLabel,
  percentileLabel,
  pointsLabel,
  seasonRevealLabel,
  tierLabel,
} from "../career-ui";
import { CareerChrome, CareerError, CareerLoading } from "../CareerChrome";

export function CareerSeason({ cohortId }: { cohortId?: string }) {
  const [state, setState] = useState<CareerStateView | null>(null);
  const [table, setTable] = useState<CareerSeasonTableView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const stateResponse = await fetch("/api/career/state", { cache: "no-store" });
      if (!stateResponse.ok) throw new Error("Your Career season is temporarily unavailable.");
      const statePayload = await stateResponse.json() as { state: CareerStateView | null };
      const selectedCohortId = cohortId ?? statePayload.state?.cohort?.id;
      if (!statePayload.state || !selectedCohortId) {
        setState(statePayload.state);
        setTable(null);
        setLoaded(true);
        return;
      }
      const standingsResponse = await fetch(
        `/api/career/season/standings?cohortId=${encodeURIComponent(selectedCohortId)}`,
        { cache: "no-store" },
      );
      if (!standingsResponse.ok) throw new Error("Season standings are temporarily unavailable.");
      setState(statePayload.state);
      setTable(await standingsResponse.json() as CareerSeasonTableView);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    }
  }, [cohortId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) {
    return (
      <CareerChrome eyebrow="Season">
        {error ? <CareerError message={error} retry={() => void load()} /> : <CareerLoading label="Reading the season table…" />}
      </CareerChrome>
    );
  }

  if (!state) {
    return (
      <CareerChrome eyebrow="Season">
        <div className="career-empty">
          <b>No Career Journey found.</b>
          <Link href="/career" className="cta ghost">Back to Career Mode</Link>
        </div>
      </CareerChrome>
    );
  }

  if (!table) {
    return (
      <CareerChrome eyebrow="Season">
        <div className="career-empty">
          <b>No active season yet.</b>
          <span>Your four-event card is being prepared — this only takes a moment.</span>
          <Link href="/career" className="cta ghost">Back to my career</Link>
        </div>
      </CareerChrome>
    );
  }

  const mine = table.standings.find((row) => row.isMe);
  const remaining = table.eventsTotal - table.eventsRevealed;
  const promotionThreshold = state.movement.promotionThreshold;
  const promotionFloor = state.movement.promotionFloor;
  const relegationThreshold = state.movement.relegationThreshold;

  return (
    <CareerChrome eyebrow="Season">
      <div className="career-season-hero">
        <div className="career-kicker">{tierLabel(table.tier)}</div>
        <h1>Season {table.seasonNumber}</h1>
        <p>
          {table.settled
            ? "Final standings · your best three event totals counted."
            : "Your best three event totals count. The table updates each time you complete an event."}
        </p>
      </div>

      {mine && (
        <div className="career-my-season">
          <span>{table.settled ? "Your finish" : "Your position"}</span>
          <b>{mine.rank ? `#${mine.rank}` : "—"}</b>
          <strong>{pointsLabel(mine.seasonPoints)} points</strong>
          <small>
            {table.settled
              ? movementLabel(mine.movement, mine.tier, mine.nextTier)
              : `${table.eventsRevealed} of ${table.eventsTotal} events played${
                remaining > 0 ? ` · ${remaining} still to count` : ""
              }`}
          </small>
        </div>
      )}

      <div className="career-section-head">
        <div>
          <span>Standings</span>
          <b>{seasonRevealLabel(table.eventsRevealed, table.eventsTotal)}</b>
        </div>
        <span className="career-section-note">{table.standings.length} players</span>
      </div>

      <div className="career-board career-season-board">
        <div className="career-board-head">
          <span>Pos</span><span>Player</span><span>Points</span><span>{table.settled ? "Move" : "Ev"}</span>
        </div>
        {table.standings.map((row) => (
          <div className={`career-board-row ${row.isMe ? "is-me" : ""}`} key={row.competitorId}>
            <span>{row.rank ?? "—"}</span>
            <span>
              <b>{row.displayName}</b>
              <small>{row.isMe ? "You" : "Rival"}</small>
            </span>
            <span>{table.eventsRevealed > 0 ? pointsLabel(row.seasonPoints) : "—"}</span>
            <span className={table.settled ? `career-movement move-${row.movement.toLowerCase()}` : ""}>
              {table.settled
                ? row.movement === "PROMOTE"
                  ? "↑"
                  : row.movement === "RELEGATE"
                    ? "↓"
                    : row.movement === "RIVAL"
                      ? "—"
                      : "•"
                : `${row.eventsCompleted}/${table.eventsTotal}`}
            </span>
          </div>
        ))}
      </div>

      {table.eventsRevealed === 0 && (
        <div className="career-context">
          <b>Your field is set — the scoring is not</b>
          All {table.standings.length} players are already in this season. Nobody has a
          position yet because no event has been completed. Finish an event and its
          results appear here for the whole field.
        </div>
      )}

      {mine && table.eventsRevealed > 0 && (
        <>
          <div className="career-section-head">
            <div>
              <span>Your card</span>
              <b>Best {table.countingEvents} of {table.eventsTotal} count</b>
            </div>
          </div>
          <div className="career-your-events">
            {mine.events.map((cell) => (
              <div
                className={`career-your-event ${cell.counting ? "is-counting" : ""} ${cell.revealed ? "" : "is-hidden"}`}
                key={cell.eventIndex}
              >
                <span>Event {cell.eventNumber}</span>
                <b>{cell.revealed ? pointsLabel(cell.points) : "—"}</b>
                <small>
                  {cell.revealed
                    ? `${cumulativeLabel(cell.relativeToPar)} · ${cell.rank ? `#${cell.rank}` : "—"}${cell.counting ? " · counting" : ""}`
                    : "Not played yet"}
                </small>
              </div>
            ))}
          </div>
          {!table.settled && (
            <div className="career-context">
              <b>Provisional through {table.eventsRevealed} of {table.eventsTotal}</b>
              Only events you have completed are scored, for you and for every rival
              alike. Events you have not played are left out of the maths entirely —
              they are never counted as zero, so they cannot drag your position down.
              Once all four are in, this table is the final one.
            </div>
          )}
        </>
      )}

      <div className="career-context">
        <b>Exactly how movement works</b>
        Season 1 establishes form; movement starts after two results.{" "}
        {promotionThreshold != null && promotionFloor != null
          ? `Promotion requires both finishes at or above the ${percentileLabel(promotionFloor)} and their average at or above the ${percentileLabel(promotionThreshold)}. `
          : "Pro is the highest tour, so there is no further promotion. "}
        {relegationThreshold != null
          ? `A two-season average at or below the ${percentileLabel(relegationThreshold)} causes relegation. `
          : "Local cannot relegate. "}
        A reduced piece of promotion form carries into the new tour.
        {state.movement.evidence.length > 0 && (
          <span className="career-movement-inline">
            Your stored form:{" "}
            {state.movement.evidence.map((value) => `${Math.round(value * 100)}%`).join(" · ")}
            {state.movement.average != null
              ? ` · ${Math.round(state.movement.average * 100)}% average`
              : ""}
          </span>
        )}
      </div>

      <div className="career-links">
        <Link href="/career" className="cta ghost">Back to my career</Link>
      </div>
    </CareerChrome>
  );
}
