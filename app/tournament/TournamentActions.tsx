"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SignUpButton } from "@clerk/nextjs";
import { relativeLabel } from "@/lib/scoring";
import type { TournamentView, MyTournamentProgress } from "@/lib/tournament.server";

/**
 * Client island for the tournament page: a live countdown to the next phase
 * boundary, the join/play controls appropriate to the current phase and my
 * progress, and the phase banner. Server passes the derived view + my progress;
 * this only adds the ticking clock and the action buttons.
 */
export function TournamentActions({
  view,
  me,
  isAccount,
}: {
  view: TournamentView;
  me: MyTournamentProgress | null;
  isAccount: boolean;
}) {
  const router = useRouter();
  const [countdown, setCountdown] = useState("");
  const [busy, setBusy] = useState(false);

  // Countdown to the next meaningful boundary for the current phase.
  const target =
    view.phase === "upcoming"
      ? view.startsAt
      : view.phase === "round1_2"
        ? view.cutAt
        : view.phase === "round3_4"
          ? view.endsAt
          : null;

  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const ms = Math.max(0, new Date(target).getTime() - Date.now());
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setCountdown(d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  async function join() {
    setBusy(true);
    try {
      const res = await fetch("/api/tournament", { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // The start weekday is DERIVED from startsAt, never hardcoded: the schedule has
  // already moved once (Monday-start -> Tuesday-start) and left this label saying
  // "Monday" while the countdown beside it correctly ticked to Tuesday. Deriving
  // it means the copy can never drift from the data again.
  //
  // Formatted in America/New_York because that's the timezone the schedule itself
  // is anchored to (see lib/daily.ts) — and because pinning the zone makes this
  // client component render identically on the server, avoiding a hydration
  // mismatch that an implicit local timezone would cause.
  const startDay = new Date(view.startsAt).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "America/New_York",
  });

  const phaseLabel =
    view.phase === "upcoming"
      ? `Starts ${startDay}`
      : view.phase === "round1_2"
        ? "Rounds 1 & 2 · cut closes in"
        : view.phase === "round3_4"
          ? "Rounds 3 & 4 · final in"
          : "Complete";

  // --- upcoming: teaser + join (accounts) ----------------------------------
  if (view.phase === "upcoming" && !view.isPreview) {
    return (
      <div className="tourn-actions">
        <div className="tourn-phase">
          {phaseLabel} · <b>{countdown || "—"}</b>
        </div>
        {isAccount ? (
          me?.joined ? (
            <div className="tourn-joined">✓ You&apos;re in — first tee {startDay}.</div>
          ) : (
            <button className="cta green" onClick={join} disabled={busy}>
              {busy ? "Joining…" : "Join the tournament"}
            </button>
          )
        ) : (
          <SignUpButton mode="modal">
            <button className="cta green">Create a free account to enter</button>
          </SignUpButton>
        )}
        <div className="tourn-sub">
          {view.courseName} · unlimited entry · top {view.cutPercent}% (min {view.cutMin}) make the cut
        </div>
      </div>
    );
  }

  // --- complete ------------------------------------------------------------
  if (view.phase === "complete") {
    return (
      <div className="tourn-actions">
        <div className="tourn-phase">This tournament is complete. See the final standings below.</div>
      </div>
    );
  }

  // --- live (round1_2 / round3_4, or preview) ------------------------------
  const cumulative = me?.cumulativeToPar ?? 0;
  const withdrawn = me?.withdrawn;
  const missedCut = me?.madeCut === false && view.phase === "round3_4" && !view.isPreview;

  return (
    <div className="tourn-actions">
      <div className="tourn-phase">
        {phaseLabel} {target && <b>{countdown || "—"}</b>}
      </div>

      {!isAccount ? (
        <SignUpButton mode="modal">
          <button className="cta green">Create a free account to play</button>
        </SignUpButton>
      ) : withdrawn ? (
        <div className="tourn-note">You didn&apos;t complete rounds 1 & 2 by the cut, so you&apos;re withdrawn this week.</div>
      ) : missedCut ? (
        <div className="tourn-note">You didn&apos;t make the cut this week — but your rounds are on the board. Next week resets Monday.</div>
      ) : (
        <>
          {me && me.joined && (
            <div className="tourn-mine">
              Your total: <b>{relativeLabel(cumulative)}</b>
            </div>
          )}
          <div className="tourn-rounds">
            {[1, 2, 3, 4].map((n) => {
              const r = me?.rounds.find((x) => x.roundNo === n);
              const done = r?.completed;
              const playable = r?.playable;
              return (
                <button
                  key={n}
                  className={`tourn-round-btn ${done ? "done" : playable ? "open" : "locked"}`}
                  disabled={!playable}
                  onClick={() => playable && router.push(`/play?tournament=${n}`)}
                >
                  <span className="trb-n">R{n}</span>
                  <span className="trb-state">
                    {done ? relativeLabel(r!.relativeToPar ?? 0) : playable ? "Play" : n <= 2 ? "—" : "Locked"}
                  </span>
                </button>
              );
            })}
          </div>
          {!me?.joined && (
            <div className="tourn-sub">Tap an open round to join and play.</div>
          )}
        </>
      )}
    </div>
  );
}
