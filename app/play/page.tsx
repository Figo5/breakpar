"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HoleArt } from "@/components/HoleArt";
import { Scorecard } from "@/components/Scorecard";
import { previewOdds } from "@/lib/engine/resolveHole";
import { OUTCOME_META, type Decision, type Outcome } from "@/lib/engine/probabilities";
import { relativeLabel } from "@/lib/scoring";
import type { Course } from "@/data/courses";

type PlayCourse = Course & { par: number };
const DECISIONS: { id: Decision; label: string; blurb: string }[] = [
  { id: "safe", label: "Safe", blurb: "Protect par, low risk" },
  { id: "normal", label: "Normal", blurb: "Balanced go at it" },
  { id: "aggressive", label: "Aggressive", blurb: "Chase birdie, accept blowups" },
];

export default function Play() {
  return (
    <Suspense fallback={<Loading />}>
      <PlayInner />
    </Suspense>
  );
}

function Loading() {
  return <div className="screen"><div className="spacer" /><div className="tagline" style={{ textAlign: "center" }}>Walking to the first tee…</div><div className="spacer" /></div>;
}

function PlayInner() {
  const router = useRouter();
  const slug = useSearchParams().get("course"); // present -> unlimited practice
  const [course, setCourse] = useState<PlayCourse | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [holeIdx, setHoleIdx] = useState(0); // 0..17
  const [outcomes, setOutcomes] = useState<(Outcome | null)[]>(Array(18).fill(null));
  const [pending, setPending] = useState<Outcome | null>(null);
  const [rel, setRel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bootstrap: start/resume the round (daily, or unlimited if ?course=slug).
  // The course payload comes back with the round, so no second request.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rRes = await fetch("/api/round", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(slug ? { slug } : {}),
        });
        if (rRes.status === 401) throw new Error("Please sign in to play.");
        if (rRes.status === 404) throw new Error("That course doesn't exist.");
        if (!rRes.ok) throw new Error("round");
        const r = await rRes.json();
        if (cancelled) return;

        setCourse(r.course as PlayCourse);
        setUnlimited(r.mode === "unlimited");
        setRoundId(r.roundId);
        if (r.playedHoles?.length) {
          setHoleIdx(Math.min(r.playedHoles.length, 17));
          setRel(r.relativeToPar ?? 0);
        }
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error && (e.message.includes("sign in") || e.message.includes("exist"))
              ? e.message
              : "Couldn't reach the course. Check your connection and try again."
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error) {
    return (
      <div className="screen">
        <div className="spacer" />
        <div className="tagline" style={{ textAlign: "center" }}>{error}</div>
        <button className="cta" style={{ marginTop: 18 }} onClick={() => location.reload()}>Try again</button>
        <div className="spacer" />
      </div>
    );
  }

  if (!course || !roundId) return <Loading />;

  const hole = course.holes[holeIdx];
  const conditions = { difficulty: course.difficulty, wind: course.wind };

  async function choose(decision: Decision) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/round/${roundId}/hole`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ holeNumber: hole.number, decision }),
      });
      if (!res.ok) throw new Error("hole");
      const data = await res.json();
      const outcome = data.outcome as Outcome;
      // Only commit local state once the server confirms, so a failed request
      // can't desync the scorecard from the authoritative round.
      setOutcomes((prev) => prev.map((o, i) => (i === holeIdx ? outcome : o)));
      setRel(data.relativeToPar);
      setPending(outcome);
    } catch {
      setError("That shot didn't register. Tap to retry.");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (holeIdx >= 17) {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/round/${roundId}/finish`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error("finish");
        router.push(`/result/${roundId}`);
      } catch {
        setError("Couldn't post your card. Tap to retry.");
        setBusy(false);
      }
      return;
    }
    setPending(null);
    setHoleIdx((i) => i + 1);
  }

  const odds = (d: Decision) => previewOdds(d, hole, conditions);

  return (
    <div className="screen">
      <div className="play-head">
        <div className="hole-id">{unlimited ? "Practice · " : ""}{course.name.split("—")[0].trim()} · Hole {hole.number}/18</div>
        <div className="score-pill"><span className="v">{relativeLabel(rel)}</span><span className="k">to par</span></div>
      </div>
      <div className="progress"><i style={{ width: `${(holeIdx / 18) * 100}%` }} /></div>

      <div className="hole-info">
        <div><div className="big">{hole.number}</div><div className="par">Par {hole.par} · SI {hole.strokeIndex}</div></div>
        <div className="yards">{hole.yardage}<small>Yards</small></div>
      </div>

      <HoleArt hole={hole} wind={course.wind} windDir={course.windDir} greens={course.greens} />

      {!pending ? (
        <>
          <div className="prompt">How do you play it?</div>
          <div className="choices">
            {DECISIONS.map((d) => {
              const o = odds(d.id);
              return (
                <button
                  key={d.id}
                  className={`choice c-${d.id}`}
                  disabled={busy}
                  onClick={() => choose(d.id)}
                  aria-label={`Play ${d.label}: ${d.blurb}. ${o.underPct}% chance under par, ${o.overPct}% over.`}
                >
                  <span className="dot" />
                  <span className="txt"><b>{d.label}</b><span>{d.blurb}</span></span>
                  <span className="odds" aria-hidden="true"><em>{o.underPct}%</em> under<br />{o.overPct}% over</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className={`result ${OUTCOME_META[pending].tone}`} role="status" aria-live="polite">
          <div className="emoji">{OUTCOME_META[pending].emoji}</div>
          <div className="name">{OUTCOME_META[pending].label}</div>
          <div className="delta">running {relativeLabel(rel)}</div>
          <button className={`cta ${holeIdx >= 17 ? "" : "green"}`} style={{ marginTop: 18 }} onClick={next}>
            {holeIdx >= 17 ? "See your card" : "Next hole"}
          </button>
        </div>
      )}

      <Scorecard holes={course.holes} outcomes={outcomes} currentHole={holeIdx} />
    </div>
  );
}
