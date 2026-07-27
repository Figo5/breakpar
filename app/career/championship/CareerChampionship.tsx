"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CareerChampionshipView, CareerStateView } from "@/lib/career/read";
import {
  canContestChampionship,
  lifecycleLabel,
  scoreLabel,
  sourceLabel,
} from "../career-ui";
import { CareerChrome, CareerError, CareerLoading } from "../CareerChrome";

export function CareerChampionship() {
  const [championship, setChampionship] = useState<CareerChampionshipView | null>(null);
  const [careerState, setCareerState] = useState<CareerStateView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [stateResponse, championshipResponse] = await Promise.all([
        fetch("/api/career/state", { cache: "no-store" }),
        fetch("/api/career/championship", { cache: "no-store" }),
      ]);
      if (!stateResponse.ok) throw new Error("Your Career World is temporarily unavailable.");
      const statePayload = await stateResponse.json() as { state: CareerStateView | null };
      setCareerState(statePayload.state);
      if (championshipResponse.status === 404) {
        setChampionship(null);
      } else {
        if (!championshipResponse.ok) throw new Error("The Championship field is temporarily unavailable.");
        const payload = await championshipResponse.json() as {
          championship: CareerChampionshipView | null;
        };
        setChampionship(payload.championship);
      }
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
      <CareerChrome eyebrow="Championship">
        {error ? <CareerError message={error} retry={() => void load()} /> : <CareerLoading label="Checking the crown-jewel field…" />}
      </CareerChrome>
    );
  }

  if (!championship) {
    const settled = careerState?.profile.settledSeasons ?? 0;
    const completedInCycle = settled % 4;
    const remaining = 4 - completedInCycle;
    const eligible = canContestChampionship(careerState?.profile.tier ?? "LOCAL");
    return (
      <CareerChrome eyebrow="Championship">
        <div className="career-champ-hero">
          <div className="career-kicker">Every four seasons</div>
          <h1>Championships</h1>
          <p>You against nineteen elite rivals on one crown-jewel course.</p>
        </div>
        <div className="career-cycle">
          {[1, 2, 3, 4].map((step) => (
            <span className={step <= completedInCycle ? "done" : step === completedInCycle + 1 ? "now" : ""} key={step}>
              {step}
            </span>
          ))}
        </div>
        {eligible ? (
          <div className="career-empty">
            <b>{remaining} more season{remaining === 1 ? "" : "s"} to your next shot.</b>
            <span>Complete a four-season cycle to earn your place in the field.</span>
          </div>
        ) : (
          <div className="career-empty">
            <b>Reach Challenger to contest the Championship.</b>
            <span>
              Cycles you complete at Local still count toward your career — they
              just don&apos;t open a Championship. Climb a tour and your next
              completed cycle earns you a place.
            </span>
          </div>
        )}
        <Link href="/career" className="cta ghost">Back to my career</Link>
      </CareerChrome>
    );
  }

  const competition = championship.competition;
  const mySlot = championship.slots.find((slot) => slot.isMe);
  const playable = !!competition
    && championship.qualified
    && competition.state === "ACTIVE"
    && !mySlot?.completed;

  return (
    <CareerChrome eyebrow="Championship">
      <div className="career-champ-hero">
        <div className="career-kicker">Cycle {championship.cycleNumber} · {lifecycleLabel(championship.state)}</div>
        <h1>{competition?.courseName ?? "Championship"}</h1>
        <p>
          {competition
            ? `${competition.courseLocation} · 20-player field`
            : "The complete 20-player field is being assembled."}
        </p>
      </div>

      {championship.qualified ? (
        <div className="career-qualified">
          <span>Qualified</span>
          <b>{mySlot ? sourceLabel(mySlot.source) : "You made the field"}</b>
          {playable && (
            <Link
              href={`/play?careerChampionship=${encodeURIComponent(championship.id)}`}
              className="cta career-primary"
            >
              Play the Championship
            </Link>
          )}
          {mySlot?.completed
            ? <small>Your card is posted: {scoreLabel(mySlot.relativeToPar)}</small>
            : <small>Optional, and it never expires — play it whenever you like.</small>}
        </div>
      ) : championship.slots.length > 0 ? (
        <div className="career-context">
          <b>Keep climbing</b>
          You did not qualify for this field. Your regular season continues normally.
        </div>
      ) : (
        <div className="career-context">
          <b>Preparing the field</b>
          Your nineteen elite rivals are being set. This takes a moment.
        </div>
      )}

      <div className="career-section-head">
        <div><span>The field</span><b>{championship.slots.length || "—"} of 20</b></div>
      </div>

      {championship.slots.length === 0 ? (
        <div className="career-empty">
          <b>No partial fields are shown.</b>
          <span>All 20 places publish together, once and immutably.</span>
        </div>
      ) : (
        <div className="career-board career-champ-board">
          <div className="career-board-head">
            <span>Pos</span><span>Player</span><span>Source</span><span>Score</span>
          </div>
          {championship.slots.map((slot) => (
            <div
              className={`career-board-row ${slot.isMe ? "is-me" : ""} ${slot.isWinner ? "is-winner" : ""}`}
              key={slot.slotNumber}
            >
              <span>{slot.rank ?? slot.slotNumber}</span>
              <span>
                <b>{slot.displayName}{slot.isWinner ? " · Champion" : ""}</b>
                <small>{slot.competitorType === "BOT" ? "Rival" : "Player"}</small>
              </span>
              <span className="career-source">{sourceLabel(slot.source)}</span>
              <span>{scoreLabel(slot.relativeToPar)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="career-context">
        <b>Prestige, not pressure</b>
        A Championship awards Legacy and a trophy, never movement or Tour Rating.
        Skipping one costs you nothing but the trophy — it waits indefinitely.
      </div>

      <div className="career-links">
        <Link href="/career" className="cta ghost">Back to my career</Link>
      </div>
    </CareerChrome>
  );
}
