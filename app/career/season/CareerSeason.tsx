"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CareerSeasonStandingView, CareerStateView } from "@/lib/career/read";
import { movementLabel, pointsLabel, tierLabel } from "../career-ui";
import { CareerChrome, CareerError, CareerLoading } from "../CareerChrome";

export function CareerSeason() {
  const [state, setState] = useState<CareerStateView | null>(null);
  const [standings, setStandings] = useState<CareerSeasonStandingView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const stateResponse = await fetch("/api/career/state", { cache: "no-store" });
      if (!stateResponse.ok) throw new Error("Your Career season is temporarily unavailable.");
      const statePayload = await stateResponse.json() as { state: CareerStateView | null };
      if (!statePayload.state?.cohort) {
        setState(statePayload.state);
        setStandings([]);
        setLoaded(true);
        return;
      }
      const standingsResponse = await fetch(
        `/api/career/season/standings?cohortId=${encodeURIComponent(statePayload.state.cohort.id)}`,
        { cache: "no-store" },
      );
      if (!standingsResponse.ok) throw new Error("Season standings are temporarily unavailable.");
      const standingsPayload = await standingsResponse.json() as {
        standings: CareerSeasonStandingView[];
      };
      setState(statePayload.state);
      setStandings(standingsPayload.standings);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    }
  }, []);

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

  if (!state?.cohort) {
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

  const mine = standings.find((row) => row.profileId === state.profile.id);
  return (
    <CareerChrome eyebrow="Season">
      <div className="career-season-hero">
        <div className="career-kicker">{tierLabel(state.cohort.tier)}</div>
        <h1>Season {state.cohort.seasonNumber}</h1>
        <p>Your best three event-point totals count. A season settles once all four cards are in.</p>
      </div>

      {mine && (
        <div className="career-my-season">
          <span>Your position</span>
          <b>{mine.rank ? `#${mine.rank}` : "—"}</b>
          <strong>{pointsLabel(mine.seasonPoints)} points</strong>
          <small>{movementLabel(mine.movement, mine.tier, mine.nextTier)}</small>
        </div>
      )}

      {standings.length === 0 ? (
        <div className="career-empty">
          <b>Standings settle after all four events.</b>
          <span>Every event stays playable until you finish it — nothing expires. Final movement is never calculated from a partial table.</span>
        </div>
      ) : (
        <div className="career-board career-season-board">
          <div className="career-board-head">
            <span>Pos</span><span>Player</span><span>Points</span><span>Move</span>
          </div>
          {standings.map((row) => (
            <div
              className={`career-board-row ${row.profileId === state.profile.id ? "is-me" : ""}`}
              key={row.profileId}
            >
              <span>{row.rank ?? "—"}</span>
              <span><b>{row.displayName}</b><small>{tierLabel(row.tier)}</small></span>
              <span>{pointsLabel(row.seasonPoints)}</span>
              <span className={`career-movement move-${row.movement.toLowerCase()}`}>
                {row.movement === "PROMOTE" ? "↑" : row.movement === "RELEGATE" ? "↓" : "•"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="career-context">
        <b>Movement uses form, not one lucky season</b>
        Your last two completed seasons feed promotion and relegation, so a single
        hot or cold run never decides your tour on its own.
      </div>

      <div className="career-links">
        <Link href="/career" className="cta ghost">Back to my career</Link>
      </div>
    </CareerChrome>
  );
}
