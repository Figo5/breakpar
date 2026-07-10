"use client";

import { useEffect, useRef, useState } from "react";

interface LiveOpponent {
  name: string;
  isBot: boolean;
  holes: { holeNumber: number; scoreChange: number }[];
  thru: number;
  relativeToPar: number;
  finished: boolean;
}

interface LiveState {
  me: { thru: number; relativeToPar: number; finished: boolean };
  opponent: LiveOpponent | null;
}

const POLL_MS = 7000;

function relLabel(rel: number): string {
  return rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`;
}

/**
 * Compact live-opponent strip for challenge rounds. Polls the live endpoint on
 * a timer AND whenever `holesCompleted` changes (finishing a hole is exactly
 * when a bot opponent reveals its next hole — refetching on it makes the
 * pacing feel instant instead of up-to-7s late).
 *
 * Renders nothing until the first successful fetch, and disappears quietly on
 * errors — the strip is garnish; it must never block play.
 */
export function OpponentStrip({
  challengeId,
  holesCompleted,
}: {
  challengeId: string;
  holesCompleted: number;
}) {
  const [state, setState] = useState<LiveState | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/challenge/${challengeId}/live`, { cache: "no-store" });
        if (!res.ok) {
          console.warn(`[opponent-strip] live fetch ${res.status} for ${challengeId}`);
          return;
        }
        const json = (await res.json()) as LiveState;
        if (!dead) setState(json);
      } catch {
        /* transient network noise — keep the last state */
      }
    };
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      dead = true;
      if (timer.current) clearInterval(timer.current);
    };
    // holesCompleted in deps: refetch immediately when I finish a hole.
  }, [challengeId, holesCompleted]);

  const opp = state?.opponent;
  if (!opp) return null;

  const last = opp.holes[opp.holes.length - 1] ?? null;
  const lastLabel =
    last === null
      ? null
      : last.scoreChange < 0
        ? `birdied ${last.holeNumber}`
        : last.scoreChange === 0
          ? `parred ${last.holeNumber}`
          : `+${last.scoreChange} on ${last.holeNumber}`;

  return (
    <div className="opp-strip" aria-live="polite">
      <span className="opp-name">
        {opp.name}
        {opp.isBot ? <span className="opp-bot-tag">BOT</span> : null}
      </span>
      <span className="opp-thru">
        {opp.finished ? "F" : opp.thru === 0 ? "—" : `thru ${opp.thru}`}
      </span>
      <span className={`opp-rel ${opp.relativeToPar < 0 ? "under" : opp.relativeToPar > 0 ? "over" : ""}`}>
        {opp.thru === 0 && !opp.finished ? "" : relLabel(opp.relativeToPar)}
      </span>
      {lastLabel ? <span className="opp-last">{lastLabel}</span> : null}
    </div>
  );
}