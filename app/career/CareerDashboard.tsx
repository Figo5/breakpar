"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CareerStateView } from "@/lib/career/read";
import {
  availabilityLabel,
  canContestChampionship,
  eventAvailability,
  scoreLabel,
  seasonsUntilChampionship,
  tierLabel,
} from "./career-ui";
import { CareerChrome, CareerError, CareerLoading } from "./CareerChrome";

type StateResponse = {
  enrolled: boolean;
  state: CareerStateView | null;
};

export function CareerDashboard() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [error, setError] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/career/state", { cache: "no-store" });
      if (!response.ok) throw new Error("Your tour card is temporarily unavailable.");
      setData(await response.json() as StateResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function enroll() {
    setEnrolling(true);
    setError("");
    try {
      const response = await fetch("/api/career/enroll", { method: "POST" });
      if (!response.ok) throw new Error("We couldn't start your career.");
      const payload = await response.json() as { state: CareerStateView };
      setData({ enrolled: true, state: payload.state });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setEnrolling(false);
    }
  }

  return (
    <CareerChrome eyebrow="Career Mode">
      {!data && !error && <CareerLoading />}
      {error && !data && <CareerError message={error} retry={() => void load()} />}
      {data && !data.enrolled && (
        <CareerOnboarding busy={enrolling} error={error} onEnroll={() => void enroll()} />
      )}
      {data?.state && <CareerHome state={data.state} onRefresh={() => void load()} />}
    </CareerChrome>
  );
}

function CareerOnboarding({
  busy,
  error,
  onEnroll,
}: {
  busy: boolean;
  error: string;
  onEnroll: () => void;
}) {
  return (
    <>
      <div className="career-kicker">A career that never resets</div>
      <h1 className="wordmark career-wordmark">Career<br /><span>Mode</span></h1>
      <p className="career-intro">
        Four quick events. Your best three count. Climb from Local to Pro, meet
        recurring rivals, and earn your way into the Championships.
      </p>

      <div className="career-ladder" aria-label="Career progression">
        <div><span>01</span><b>Local</b><small>Start here</small></div>
        <i>→</i>
        <div><span>02</span><b>Challenger</b><small>Earn the move</small></div>
        <i>→</i>
        <div><span>03</span><b>Pro</b><small>Stay sharp</small></div>
      </div>

      <div className="banner career-onboard-card">
        <div className="career-onboard-label">Play at your pace</div>
        <strong>No schedule. No waiting.</strong>
        <p>
          All four events are open the moment your season starts — play them in any
          order, one attempt each. Finish the fourth and your next season begins
          immediately. Nothing ever expires.
        </p>
      </div>

      {error && <div className="career-inline-error">{error}</div>}
      <button className="cta career-primary" onClick={onEnroll} disabled={busy}>
        {busy ? "Building your tour…" : "Start my career"}
      </button>
      <div className="career-fineprint">Free to enter · guests carry their progress into an account</div>
    </>
  );
}

function CareerHome({ state, onRefresh }: { state: CareerStateView; onRefresh: () => void }) {
  const rating = state.latestRating?.rating ?? 0;
  const { completed, total } = state.seasonProgress;
  const seasonComplete = total > 0 && completed === total;
  const championship = state.championship;
  const eligible = canContestChampionship(state.profile.tier);
  const untilCycle = seasonsUntilChampionship(state.profile.settledSeasons);

  return (
    <>
      <div className="career-hero">
        <div>
          <div className="career-kicker">Season {state.profile.currentSeason}</div>
          <h1>{tierLabel(state.profile.tier)}</h1>
          <div className="career-season-line">
            {completed} of {total || 4} events played
            <span>·</span>
            {state.profile.settledSeasons} season{state.profile.settledSeasons === 1 ? "" : "s"} banked
          </div>
        </div>
        <div className={`career-tier-mark tier-${state.profile.tier.toLowerCase()}`}>
          {state.profile.tier === "LOCAL" ? "L" : state.profile.tier === "CHALLENGER" ? "C" : "P"}
        </div>
      </div>

      <div className="career-metrics">
        <div className="card">
          <span>Tour Rating</span>
          <b>{Math.round(rating)}</b>
          <small>{state.latestRating ? `After season ${state.latestRating.seasonNumber}` : "Builds after your first season"}</small>
        </div>
        <div className="card">
          <span>Legacy</span>
          <b>{state.profile.legacyTotal}</b>
          <small>Permanent points</small>
        </div>
      </div>

      <div className="career-section-head">
        <div>
          <span>This season</span>
          <b>Best 3 of 4 count</b>
        </div>
        {state.cohort && <Link href="/career/season">Standings →</Link>}
      </div>

      {!state.cohort ? (
        <div className="career-empty">
          <b>Setting up your next season.</b>
          <span>Your four-event card is being prepared — this only takes a moment.</span>
          <button className="cta ghost" onClick={onRefresh}>Refresh</button>
        </div>
      ) : (
        <div className="career-events">
          {state.schedule.map((event) => {
            const availability = eventAvailability(event);
            return (
              <Link
                href={`/career/event/${event.competitionId}`}
                className={`career-event event-${availability}`}
                key={event.competitionId}
              >
                <div className="career-event-no">E{event.eventNumber ?? "—"}</div>
                <div className="career-event-copy">
                  <b>{event.courseName}</b>
                  <span>{event.courseLocation}</span>
                  <small>{availabilityLabel(availability)}</small>
                </div>
                <div className="career-event-score">
                  {event.completed ? scoreLabel(event.relativeToPar) : "→"}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {state.cohort && !seasonComplete && (
        <div className="career-context">
          <b>Play in any order</b>
          Every event is open right now, one attempt each. Finish all four to close
          the season — there is no deadline to beat.
        </div>
      )}
      {seasonComplete && state.cohort?.state !== "SETTLED" && (
        <div className="career-context">
          <b>All four cards are in</b>
          Your season is being finalised — standings, movement, rating and Legacy
          publish together.
        </div>
      )}
      {state.cohort?.state === "SETTLED" && (
        <div className="career-context good">
          <b>Season complete</b>
          Your next season is already open. Check standings for how you moved.
        </div>
      )}

      <div className="career-links">
        {championship ? (
          <Link href="/career/championship" className="career-link-card">
            <span>Cycle {championship.cycleNumber} · unlocked</span>
            <b>Championship awaiting</b>
            <small>Optional, never expires — play it whenever you like →</small>
          </Link>
        ) : (
          <Link href="/career/championship" className="career-link-card">
            <span>Every four seasons</span>
            <b>Championships</b>
            <small>
              {eligible
                ? `${untilCycle} more season${untilCycle === 1 ? "" : "s"} to your next shot →`
                : "Reach Challenger to contest the Championship →"}
            </small>
          </Link>
        )}
        <Link href="/" className="cta ghost">Back to today&apos;s game</Link>
      </div>
    </>
  );
}
