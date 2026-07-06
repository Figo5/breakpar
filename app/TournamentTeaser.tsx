"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SignUpButton } from "@clerk/nextjs";

/**
 * Home-screen tournament card. STATE-AWARE: fetches the live tournament phase
 * from /api/tournament and shows the right message + countdown:
 *  - upcoming  -> "starts in {countdown to startsAt}"        (Soon)
 *  - round1_2  -> "LIVE · rounds 1 & 2 · cut in {->cutAt}"    (Live)
 *  - round3_4  -> "LIVE · rounds 3 & 4 · ends in {->endsAt}"  (Live)
 *  - complete  -> "complete — champion crowned"               (Done)
 * Falls back to a static "coming soon" if the fetch fails. The button always
 * navigates to /tournament (self-activating page). `isAccount` drives the
 * guest sign-up CTA.
 */
type Phase = "upcoming" | "round1_2" | "cut" | "round3_4" | "complete";
type View = { phase: Phase; startsAt: string; cutAt: string; endsAt: string; fieldSize?: number } | null;

export function TournamentTeaser({ isAccount }: { isAccount: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View>(null);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");

  // Fetch the live tournament state once.
  useEffect(() => {
    let alive = true;
    fetch("/api/tournament")
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setView(d?.tournament ?? null);
          setLoaded(true);
        }
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // Countdown to the current phase's next boundary.
  const target =
    view?.phase === "upcoming"
      ? view.startsAt
      : view?.phase === "round1_2"
        ? view.cutAt
        : view?.phase === "round3_4"
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
      setLabel(d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const isLive = view?.phase === "round1_2" || view?.phase === "round3_4";
  const isComplete = view?.phase === "complete";

  // Headline line depending on phase.
  const headline = !loaded
    ? "Loading…"
    : !view
      ? "Coming soon"
      : view.phase === "upcoming"
        ? <>First tournament starts in <b>{label || "—"}</b></>
        : view.phase === "round1_2"
          ? <>Rounds 1 &amp; 2 live · cut closes in <b>{label || "—"}</b></>
          : view.phase === "round3_4"
            ? <>Rounds 3 &amp; 4 live · final in <b>{label || "—"}</b></>
            : "This week's tournament is complete.";

  return (
    <div className="tease" aria-label="Weekly Tournaments">
      <div className="tease-head">
        <h3>🏆 Weekly Tournaments</h3>
        <span className={`tease-soon ${isLive ? "live" : ""}`}>
          {isLive ? "Live" : isComplete ? "Done" : "Soon"}
        </span>
      </div>
      <div className="tease-count">{headline}</div>
      <div className="tease-sub">
        {isLive
          ? `One course, 4 rounds, top 30% make the cut.${view?.fieldSize ? ` ${view.fieldSize} playing.` : ""} Accounts only.`
          : "One course, 4 rounds, a cut, and a trophy for the winner. Accounts only."}
      </div>

      <button
        type="button"
        className={`tease-btn ${isLive ? "live" : ""}`}
        onClick={() => router.push("/tournament")}
      >
        🏆 {isLive ? "Play now" : "View tournament"}
      </button>

      {isAccount ? (
        <div className="tease-ready">
          {isLive ? "✓ You're in — tee it up." : isComplete ? "See the final standings." : "✓ You're all set."}
        </div>
      ) : (
        <SignUpButton mode="modal">
          <button className="cta green">Create a free account to play</button>
        </SignUpButton>
      )}
    </div>
  );
}
