"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { careerLegacyTitle } from "@/lib/career/legacy";
import {
  CAREER_SKILL_EFFECT_COPY,
  CAREER_SKILL_LABELS,
  type CareerSkill,
} from "@/lib/career/development";
import type { CareerStateView } from "@/lib/career/read";
import {
  availabilityLabel,
  canContestChampionship,
  eventAvailability,
  movementLabel,
  percentileLabel,
  pointsLabel,
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
        Four events, four rounds each. Your best three events count. Climb from Local to Pro, meet
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
          order. Each event is four cumulative rounds with one attempt per round.
          Complete all sixteen cards and your next season begins immediately.
          Nothing ever expires.
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
  const [developmentError, setDevelopmentError] = useState("");
  const [upgrading, setUpgrading] = useState<CareerSkill | null>(null);
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireConfirmation, setRetireConfirmation] = useState("");
  const [retireError, setRetireError] = useState("");
  const [retiring, setRetiring] = useState(false);
  const rating = state.latestRating?.rating ?? 0;
  const { completed, total } = state.seasonProgress;
  const seasonComplete = total > 0 && completed === total;
  const championship = state.championship;
  const eligible = canContestChampionship(state.profile.tier);
  const untilCycle = seasonsUntilChampionship(state.profile.settledSeasons);
  const fourRoundSeason = state.schedule.every((event) => event.roundsTotal === 4);
  const seasonUntouched = state.schedule.every(
    (event) => event.roundsCompleted === 0 && !event.roundId && !event.completed,
  );

  async function upgrade(skill: CareerSkill, expectedRank: number) {
    setUpgrading(skill);
    setDevelopmentError("");
    try {
      const response = await fetch("/api/career/development", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skill, expectedRank }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(
          payload.error === "not-enough-points"
            ? "You need more development points for that upgrade."
            : "That upgrade could not be applied. Refresh and try again.",
        );
      }
      onRefresh();
    } catch (cause) {
      setDevelopmentError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setUpgrading(null);
    }
  }

  async function retire() {
    setRetiring(true);
    setRetireError("");
    try {
      const response = await fetch("/api/career/retire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileId: state.profile.id,
          confirmation: retireConfirmation,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const message = payload.error === "career-already-started"
          ? "Finish this season, then retire before starting the next one."
          : payload.error === "championship-in-progress"
            ? "Finish the Championship card already in progress before retiring."
            : "Your career could not be retired.";
        throw new Error(message);
      }
      onRefresh();
    } catch (cause) {
      setRetireError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setRetiring(false);
    }
  }

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
        <Link href="/career/legacy" className="card career-legacy-card">
          <span>Legacy</span>
          <b>{state.profile.legacyTotal}</b>
          <small>{careerLegacyTitle(state.profile.legacyTotal).title} · see breakdown →</small>
        </Link>
      </div>

      {state.latestSettledSeason && (
        <Link
          href={`/career/season?cohortId=${encodeURIComponent(state.latestSettledSeason.cohortId)}`}
          className="career-last-season"
        >
          <div>
            <span>Season {state.latestSettledSeason.seasonNumber} · Final</span>
            <b>
              {state.latestSettledSeason.rank
                ? `Finished #${state.latestSettledSeason.rank} of ${state.latestSettledSeason.fieldSize}`
                : "Final standings"}
            </b>
            <small>
              {pointsLabel(state.latestSettledSeason.seasonPoints)} points ·{" "}
              {movementLabel(
                state.latestSettledSeason.movement,
                state.latestSettledSeason.tier,
                state.latestSettledSeason.nextTier,
              )}
            </small>
          </div>
          <strong>View →</strong>
        </Link>
      )}

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
                  <small>
                    Round {Math.min(event.roundsCompleted + 1, event.roundsTotal)} of {event.roundsTotal}
                    {event.roundsCompleted > 0 && !event.completed
                      ? ` · ${scoreLabel(event.relativeToPar)} total`
                      : ""}
                  </small>
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
          {fourRoundSeason
            ? "Every event is open right now. Finish four numbered rounds in each event, then complete all four events to close the season — there is no deadline to beat."
            : "This in-progress season keeps its original one-round event format. Complete all four events to close it; your next season will use four rounds per event."}
        </div>
      )}

      <details className="career-rules">
        <summary>How promotion and relegation work</summary>
        <div>
          <p><b>Movement uses your latest two season finishes.</b> Season 1 establishes form, so nobody moves after one result.</p>
          {state.movement.promotionThreshold != null && (
            <p><b>Promotion:</b> both results must be at or above the{" "}
              {percentileLabel(state.movement.promotionFloor ?? 0)}{" "}
              and average at or above the{" "}
              {percentileLabel(state.movement.promotionThreshold)}.
            </p>
          )}
          {state.movement.relegationThreshold != null && (
            <p><b>Relegation:</b> a two-result average at or below the{" "}
              {percentileLabel(state.movement.relegationThreshold)}
              moves you down.
            </p>
          )}
          <div className="career-form-evidence">
            {state.movement.evidence.length === 0
              ? <span>No stored form yet</span>
              : state.movement.evidence.map((value, index) => (
                <span key={`${index}:${value}`}>
                  {index === state.movement.evidence.length - 1 ? "Latest" : "Previous"}{" "}
                  <b>{Math.round(value * 100)}%</b>
                </span>
              ))}
            {state.movement.average != null && (
              <span>Average <b>{Math.round(state.movement.average * 100)}%</b></span>
            )}
          </div>
        </div>
      </details>

      <div className="career-section-head">
        <div>
          <span>Player development</span>
          <b>
            {state.development.enabled
              ? `${state.development.points} point${state.development.points === 1 ? "" : "s"} available`
              : "Unlocks next season"}
          </b>
        </div>
      </div>
      {!state.development.enabled ? (
        <div className="career-context">
          <b>Your current season keeps its original rules</b>
          Driving, Approach, Short Game and Putting ranks unlock when your next
          season begins. This card will never change underneath you.
        </div>
      ) : state.development.latestAward && (
        <div className="career-context good">
          <b>
            +{state.development.latestAward.points} from Season{" "}
            {state.development.latestAward.seasonNumber ?? "—"}
          </b>
          {state.development.latestAward.reasons.join(" · ")}
        </div>
      )}
      {state.development.enabled && <div className="career-skill-grid">
        {state.development.skills.map((entry) => {
          const canUpgrade =
            entry.nextCost != null && state.development.points >= entry.nextCost;
          return (
            <div className="card career-skill-card" key={entry.skill}>
              <div>
                <span>{CAREER_SKILL_LABELS[entry.skill]}</span>
                <b>Rank {entry.rank}/{entry.maxRank}</b>
              </div>
              <p>{CAREER_SKILL_EFFECT_COPY[entry.skill]}</p>
              {entry.nextCost == null ? (
                <small>Max rank</small>
              ) : (
                <button
                  type="button"
                  disabled={!canUpgrade || upgrading != null}
                  onClick={() => void upgrade(entry.skill, entry.rank)}
                >
                  {upgrading === entry.skill
                    ? "Upgrading…"
                    : `Upgrade · ${entry.nextCost} pt${entry.nextCost === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          );
        })}
      </div>}
      {state.development.enabled && <div className="career-context">
        <b>Skill helps; it never guarantees a score</b>
        Ranks improve the real odds for that part of the game. The first four
        foundation points come from completing seasons; every point after that
        requires top-half or top-quarter finishes.
      </div>}
      {developmentError && <div className="career-inline-error">{developmentError}</div>}
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

      {state.retiredCareers.length > 0 && (
        <details className="career-rules">
          <summary>Retired careers ({state.retiredCareers.length})</summary>
          <div className="career-retired-list">
            {state.retiredCareers.map((career) => (
              <Link
                href={`/career/legacy?profileId=${encodeURIComponent(career.profileId)}`}
                key={career.profileId}
              >
                <span>Career #{career.careerNumber} · {career.settledSeasons} seasons</span>
                <b>{career.legacyTotal.toLocaleString()} Legacy →</b>
              </Link>
            ))}
          </div>
        </details>
      )}

      <div className="career-retire">
        {!retireOpen ? (
          <button type="button" onClick={() => setRetireOpen(true)}>
            Retire this career
          </button>
        ) : (
          <div>
            <b>Retire Career #{state.profile.careerNumber}?</b>
            <p>
              This archives its seasons and Legacy, then lets you start again
              from Local with fresh rivals and zero active-career progress.
              Retirement is allowed only before taking a shot in the current season.
            </p>
            {!seasonUntouched && (
              <small>Finish this season first. Retire before starting the next one.</small>
            )}
            <label>
              Type RETIRE to confirm
              <input
                value={retireConfirmation}
                onChange={(event) => setRetireConfirmation(event.target.value)}
                autoComplete="off"
              />
            </label>
            {retireError && <div className="career-inline-error">{retireError}</div>}
            <div>
              <button type="button" onClick={() => setRetireOpen(false)}>Cancel</button>
              <button
                type="button"
                disabled={
                  retiring
                  || !seasonUntouched
                  || retireConfirmation !== "RETIRE"
                }
                onClick={() => void retire()}
              >
                {retiring ? "Retiring…" : "Archive and restart"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
