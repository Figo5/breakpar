"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HoleArt } from "@/components/HoleArt";
import { PuttView } from "@/components/PuttView";
import { Scorecard } from "@/components/Scorecard";
import {
  holeCues,
  riskRead,
  lieRiskRead,
  puttRead,
  puttRiskRead,
  shortGameRiskRead,
  greenRead,
  situationRead,
  AGGRESSIVE_BUDGET,
} from "@/lib/holeRead";
import { LIE_META, stagePrompt, type Lie, type PuttContext, type ShotRecord } from "@/lib/engine/shots";
import { GREEN_META, type GreenResult } from "@/lib/engine/putting";
import { OUTCOME_META, type Decision, type Outcome } from "@/lib/engine/probabilities";
import { relativeLabel } from "@/lib/scoring";
import { track, identifyUser, type RoundMeta } from "@/lib/analytics";
import type { Course } from "@/data/courses";

type PlayCourse = Course & { par: number };
type SwingStage = "tee" | "approach" | "putt" | "scramble";

// Decision vocab is shared (safe/normal/aggressive) but labelled per stage.
const SWING_CHOICES: { id: Decision; label: string; blurb: string }[] = [
  { id: "safe", label: "Safe", blurb: "Protect par, low risk" },
  { id: "normal", label: "Normal", blurb: "Balanced go at it" },
  { id: "aggressive", label: "Aggressive", blurb: "Chase birdie, accept blowups" },
];
const PUTT_CHOICES: { id: Decision; label: string; blurb: string }[] = [
  { id: "safe", label: "Lag", blurb: "Cozy it up, protect against the 3-putt" },
  { id: "normal", label: "Roll it", blurb: "Good pace, give it a chance" },
  { id: "aggressive", label: "Charge", blurb: "Ram it in — three-jack risk" },
];
const SHORT_CHOICES: { id: Decision; label: string; blurb: string }[] = [
  { id: "safe", label: "Punch", blurb: "Take bogey, kill the blow-up" },
  { id: "normal", label: "Chip", blurb: "Standard chip at it" },
  { id: "aggressive", label: "Flop", blurb: "High flop, go for the save" },
];

const initialStage = (par: number): SwingStage => (par === 3 ? "approach" : "tee");

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
  const [aggressiveLeft, setAggressiveLeft] = useState(AGGRESSIVE_BUDGET);

  // Current-hole chain state.
  const [holeDecisions, setHoleDecisions] = useState<Decision[]>([]);
  const [stage, setStage] = useState<SwingStage>("tee");
  const [lie, setLie] = useState<Lie | null>(null);
  const [green, setGreen] = useState<GreenResult | null>(null);
  const [puttCtx, setPuttCtx] = useState<PuttContext | null>(null);
  const [shotLog, setShotLog] = useState<ShotRecord[]>([]);
  const [approachYards, setApproachYards] = useState<number | null>(null); // yards to pin (display)
  const [ballT, setBallT] = useState(0.05); // ball position along the hole, 0..1 (display)

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Analytics: round context reused by every funnel event, plus refs to drive
  // best-effort round_abandoned without re-rendering.
  const metaRef = useRef<RoundMeta | null>(null);
  const finishedRef = useRef(false);
  const completedHolesRef = useRef(0);
  const abandonReportedRef = useRef(false);

  // Bootstrap: start/resume the round (daily, or unlimited if ?course=slug).
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

        const c = r.course as PlayCourse;
        setCourse(c);
        setUnlimited(r.mode === "unlimited");
        setRoundId(r.roundId);
        setAggressiveLeft((r.aggressiveBudget ?? AGGRESSIVE_BUDGET) - (r.aggressiveUsed ?? 0));
        const startIdx = r.playedHoles?.length ? Math.min(r.playedHoles.length, 17) : 0;
        setHoleIdx(startIdx);
        setStage(initialStage(c.holes[startIdx].par));
        if (r.playedHoles?.length) setRel(r.relativeToPar ?? 0);

        // Analytics. Identify with the durable server User.id so this person is
        // one PostHog identity across sessions and a later sign-in.
        const meta: RoundMeta = {
          roundId: r.roundId,
          slug: c.slug,
          mode: r.mode === "unlimited" ? "practice" : "daily",
          puzzleNumber: r.puzzleNumber ?? null,
        };
        metaRef.current = meta;
        completedHolesRef.current = startIdx;
        if (r.userId) identifyUser(r.userId);
        // Only count a fresh start (0 holes played) as round_started; a resume
        // already fired it on its original day.
        if (!r.playedHoles?.length) track.roundStarted(meta);
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

  // round_abandoned (best-effort): a started round left unfinished. Fires once,
  // on SPA unmount (back to home, etc.) or pagehide (tab close/navigate away).
  // The finish path sets finishedRef first, so a normal finish never reports.
  // Hard tab-closes may drop the event (no flush guarantee) — approximate by
  // design; the SPA-unmount path is reliable.
  useEffect(() => {
    const report = () => {
      if (abandonReportedRef.current || finishedRef.current || !metaRef.current) return;
      abandonReportedRef.current = true;
      track.roundAbandoned(metaRef.current, completedHolesRef.current);
    };
    window.addEventListener("pagehide", report);
    return () => {
      window.removeEventListener("pagehide", report);
      report();
    };
  }, []);

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
  const budgeted = stage === "tee" || stage === "approach";

  async function choose(decision: Decision) {
    if (busy) return;
    setBusy(true);
    const submitStage = stage; // capture before any async state changes
    const sequence = [...holeDecisions, decision];
    try {
      const res = await fetch(`/api/round/${roundId}/hole`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ holeNumber: hole.number, decisions: sequence }),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "budget-exhausted") {
          setAggressiveLeft(0);
          setError(null);
          return; // not committed; button is already disabled
        }
      }
      if (!res.ok) throw new Error("hole");
      const data = await res.json();

      // Commit local state only after the server confirms.
      setHoleDecisions(sequence);
      if ((submitStage === "tee" || submitStage === "approach") && decision === "aggressive")
        setAggressiveLeft((n) => Math.max(0, n - 1));
      if (Array.isArray(data.shots)) setShotLog(data.shots as ShotRecord[]);

      if (data.complete) {
        const outcome = data.outcome as Outcome;
        setOutcomes((prev) => prev.map((o, i) => (i === holeIdx ? outcome : o)));
        setRel(data.relativeToPar);
        completedHolesRef.current = holeIdx + 1;
        if (metaRef.current) track.holeCompleted(metaRef.current, hole.number, outcome);
        setGreen((data.green as GreenResult) ?? green);
        setLie((data.lie as Lie) ?? lie);
        setPending(outcome);
      } else {
        // Next stage — reveal the new position + reads.
        setStage(data.stage as SwingStage);
        setLie((data.lie as Lie) ?? lie);
        setGreen((data.green as GreenResult) ?? null);
        setPuttCtx((data.putt as PuttContext) ?? null);
        setApproachYards((data.approachYards as number) ?? null);
        setBallT(typeof data.ballT === "number" ? data.ballT : 0.05);
      }
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
        // round_finished: server-authoritative score; toPar/brokePar from the
        // running relative-to-par (final after hole 18). Suppress abandoned.
        const fin = await res.json().catch(() => ({} as { score?: number; newTrophies?: unknown[] }));
        finishedRef.current = true;
        if (metaRef.current)
          track.roundFinished(metaRef.current, fin.score ?? course!.par + rel, rel, rel < 0);
        // Hand any newly-unlocked trophies to the result screen for a one-time
        // celebration (keyed by round so shares/re-visits never re-fire).
        if (Array.isArray(fin.newTrophies) && fin.newTrophies.length) {
          try {
            sessionStorage.setItem(`bp_new_trophies_${roundId}`, JSON.stringify(fin.newTrophies));
          } catch {}
        }
        router.push(`/result/${roundId}`);
      } catch {
        setError("Couldn't post your card. Tap to retry.");
        setBusy(false);
      }
      return;
    }
    const nextIdx = holeIdx + 1;
    setPending(null);
    setHoleDecisions([]);
    setLie(null);
    setGreen(null);
    setPuttCtx(null);
    setShotLog([]);
    setApproachYards(null);
    setBallT(0.05);
    setStage(initialStage(course!.holes[nextIdx].par));
    setHoleIdx(nextIdx);
  }

  const cues = holeCues(hole, conditions, course.greens);
  const situation = situationRead(rel, 18 - holeIdx);
  const choices = stage === "putt" ? PUTT_CHOICES : stage === "scramble" ? SHORT_CHOICES : SWING_CHOICES;

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

      {stage === "putt" && puttCtx ? (
        <PuttView putt={puttCtx} />
      ) : (
        <HoleArt hole={hole} wind={course.wind} windDir={course.windDir} greens={course.greens} ballT={ballT} />
      )}

      {!pending ? (
        <>
          <div className="reads">
            {stage === "tee" && situation && <div className={`situation s-${situation.tone}`}>{situation.text}</div>}
            {positionBanner(stage, hole.par, lie, green, puttCtx, course.greens, cues)}
            {stage === "approach" && (approachYards ?? hole.yardage) && (
              <div className="yardage">⛳ {approachYards ?? hole.yardage} to the pin</div>
            )}
          </div>

          {shotLog.length > 0 && (
            <div className="shotlog" aria-label="Shot-by-shot">
              {shotLog.map((s, i) => (
                <div className="plog" key={i}>
                  <span className="pst">{stageTag(s.stage)}</span>
                  <span className="pnote">
                    {s.note}
                    {typeof s.yards === "number" && <em className="pyd">~{s.yards} yd</em>}
                    {s.event && <em className={`pev pev-${s.event.tone}`}>⚡ {s.event.narration}</em>}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="prompt">{stagePrompt(stage, hole.par)}</div>
          {!budgeted && <div className="budget-note">Putts &amp; chips don&apos;t use your 🔥 budget</div>}
          <div className="choices">
            {choices.map((d) => {
              const risk = riskFor(stage, d.id, hole, conditions, lie, puttCtx);
              const isAggro = d.id === "aggressive";
              const outOfBudget = budgeted && isAggro && aggressiveLeft <= 0;
              return (
                <button
                  key={d.id}
                  className={`choice c-${d.id}`}
                  disabled={busy || outOfBudget}
                  onClick={() => choose(d.id)}
                  aria-label={`${d.label}: ${d.blurb}. ${outOfBudget ? "No aggressive plays left." : risk.text + "."}`}
                >
                  <span className="dot" />
                  <span className="txt">
                    <b>{d.label}{budgeted && isAggro && <em className="budget">🔥 {aggressiveLeft} left</em>}</b>
                    <span>{d.blurb}</span>
                  </span>
                  <span className={`risk r-${risk.tone}`} aria-hidden="true">
                    {outOfBudget ? "Spent" : risk.text}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className={`result ${OUTCOME_META[pending].tone}`} role="status" aria-live="polite">
          <div className="emoji">{OUTCOME_META[pending].emoji}</div>
          <div className="name">{OUTCOME_META[pending].label}</div>
          {shotLog.length > 0 && <div className="result-note">“{shotLog[shotLog.length - 1].note}”</div>}
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

// --- helpers ---------------------------------------------------------------

function stageTag(stage: ShotRecord["stage"]): string {
  return stage === "tee" ? "Tee" : stage === "approach" ? "Approach" : stage === "layup" ? "Wedge" : stage === "putt" ? "Putt" : "Chip";
}

/** The position/read banner above the choices, per stage. */
function positionBanner(
  stage: SwingStage,
  par: number,
  lie: Lie | null,
  green: GreenResult | null,
  puttCtx: PuttContext | null,
  greens: Course["greens"],
  cues: { icon: string; text: string }[]
) {
  // Tee, or a par-3 tee shot (no lie yet) -> hole cues.
  if (stage === "tee" || (stage === "approach" && !lie)) {
    return (
      <div className="cues">
        {cues.map((c, i) => (
          <span className="cue" key={i}><span className="ci">{c.icon}</span>{c.text}</span>
        ))}
      </div>
    );
  }
  // Approach from a known lie -> lie banner.
  if (stage === "approach" && lie) {
    return (
      <div className={`lie-banner l-${LIE_META[lie].tone}`}>
        <span className="le">{LIE_META[lie].emoji}</span>
        <span className="lt"><b>{LIE_META[lie].label}</b><span>{LIE_META[lie].note}</span></span>
      </div>
    );
  }
  // Putt -> green banner + distance/break/speed cues.
  if (stage === "putt" && green && puttCtx) {
    const gr = greenRead(green);
    const pr = puttRead(puttCtx.bucket, puttCtx.distanceFt, puttCtx.breakDir, puttCtx.slope, greens);
    return (
      <>
        <div className={`lie-banner l-${GREEN_META[green].tone === "even" ? "even" : GREEN_META[green].tone === "good" ? "good" : "bad"}`}>
          <span className="le">{GREEN_META[green].emoji}</span>
          <span className="lt"><b>{GREEN_META[green].label}</b><span>{gr.text}</span></span>
        </div>
        <div className="cues" style={{ marginTop: 10 }}>
          {pr.cues.map((c, i) => (
            <span className="cue" key={i}><span className="ci">{c.icon}</span>{c.text}</span>
          ))}
        </div>
      </>
    );
  }
  // Scramble -> green banner.
  if (stage === "scramble" && green) {
    const gr = greenRead(green);
    return (
      <div className={`lie-banner l-bad`}>
        <span className="le">{GREEN_META[green].emoji}</span>
        <span className="lt"><b>{GREEN_META[green].label}</b><span>{gr.text}</span></span>
      </div>
    );
  }
  return null;
}

/** Per-stage risk read shown on each choice button. */
function riskFor(
  stage: SwingStage,
  d: Decision,
  hole: PlayCourse["holes"][number],
  conditions: { difficulty: number; wind: number },
  lie: Lie | null,
  puttCtx: PuttContext | null
): { tone: "good" | "warn" | "bad"; text: string } {
  if (stage === "tee") return riskRead(d, hole, conditions);
  if (stage === "approach") return lie ? lieRiskRead(lie, d) : riskRead(d, hole, conditions);
  if (stage === "putt" && puttCtx) return puttRiskRead(d, puttCtx.bucket, puttCtx.speed);
  return shortGameRiskRead(d);
}
