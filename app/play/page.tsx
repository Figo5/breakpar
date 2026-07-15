"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HoleMap } from "@/components/HoleMap";
import { OpponentStrip } from "@/components/OpponentStrip";
import { PuttView } from "@/components/PuttView";
import { Scorecard } from "@/components/Scorecard";
import {
  holeCues,
  riskRead,
  lieRiskRead,
  puttRead,
  puttForLabel,
  puttRiskRead,
  shortGameRiskRead,
  greenRead,
  AGGRESSIVE_BUDGET,
} from "@/lib/holeRead";
import { LIE_META, type Lie, type PuttContext, type ShotRecord } from "@/lib/engine/shots";
import { GREEN_META, type GreenResult, type GreenSpeed, type GreenSource } from "@/lib/engine/putting";
import { OUTCOME_META, type Decision, type Outcome } from "@/lib/engine/probabilities";
import { relativeLabel } from "@/lib/scoring";
import { encodeBallDisplay } from "@/lib/ballDisplay";
import { finishSummary } from "@/lib/finishSummary";
import {
  teeOddsReveal, teeOddsTakeaway,
  puttOddsReveal, puttOddsTakeaway,
  approachOddsReveal, approachOddsTakeaway,
  scrambleOddsReveal, scrambleOddsTakeaway,
} from "@/lib/oddsReveal";
import { track, identifyUser, type RoundMeta } from "@/lib/analytics";
import type { Course } from "@/data/courses";

type PlayCourse = Course & { par: number };
type SwingStage = "tee" | "approach" | "putt" | "scramble";

// Decision vocab is shared (safe/normal/aggressive) but labelled per stage.
const SWING_CHOICES: { id: Decision; label: string; blurb: string }[] = [
  { id: "safe", label: "Safe", blurb: "Middle of the green" },
  { id: "normal", label: "Normal", blurb: "Favor the fat side" },
  { id: "aggressive", label: "Aggressive", blurb: "Hunt the pin" },
];
const PUTT_CHOICES: { id: Decision; label: string; blurb: string }[] = [
  { id: "safe", label: "Lag", blurb: "Cozy it close" },
  { id: "normal", label: "Roll it", blurb: "Good pace" },
  { id: "aggressive", label: "Charge", blurb: "Ram it in" },
];
const SHORT_CHOICES: { id: Decision; label: string; blurb: string }[] = [
  { id: "safe", label: "Punch", blurb: "Take the safe out" },
  { id: "normal", label: "Chip", blurb: "Standard chip" },
  { id: "aggressive", label: "Flop", blurb: "Go for the save" },
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
  const params = useSearchParams();
  const slug = params.get("course"); // present -> unlimited practice
  const challengeId = params.get("challenge"); // present -> head-to-head challenge round
  const tournamentRoundParam = params.get("tournament"); // present -> tournament round N (1..4)
  const tournamentRoundNo = tournamentRoundParam ? parseInt(tournamentRoundParam, 10) : null;
  const [course, setCourse] = useState<PlayCourse | null>(null);
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
          body: JSON.stringify(
            tournamentRoundNo ? { tournamentRoundNo } : challengeId ? { challengeId } : slug ? { slug } : {}
          ),
        });
        if (rRes.status === 401) throw new Error("Please sign in to play.");
        if (rRes.status === 403) throw new Error("Please sign in to play.");
        if (rRes.status === 404) throw new Error("That course doesn't exist.");
        if (!rRes.ok) throw new Error("round");
        const r = await rRes.json();
        if (cancelled) return;

        const c = r.course as PlayCourse;
        setCourse(c);
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
          mode: r.mode === "unlimited" ? "practice" : r.mode === "challenge" ? "challenge" : "daily",
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
  }, [slug, challengeId, tournamentRoundNo]);

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
        const nextStage = data.stage as SwingStage;
        const nextLie = (data.lie as Lie) ?? lie;
        setStage(nextStage);
        setLie(nextLie);
        setGreen((data.green as GreenResult) ?? null);
        setPuttCtx((data.putt as PuttContext) ?? null);
        setApproachYards((data.approachYards as number) ?? null);
        const progress = typeof data.ballT === "number" ? data.ballT : 0.05;
        setBallT(encodeBallDisplay(progress, nextLie, nextStage));
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
          } catch { }
        }
        // Challenge rounds land on the side-by-side challenge view; tournament
        // rounds return to the tournament page (standings). Others -> result.
        router.push(
          tournamentRoundNo ? `/tournament` : challengeId ? `/challenges/${challengeId}` : `/result/${roundId}`
        );
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
  const choices = stage === "putt" ? PUTT_CHOICES : stage === "scramble" ? SHORT_CHOICES : SWING_CHOICES;
  const openingRead = stage === "tee" || (stage === "approach" && !lie);
  const isIsland = hole.par === 3 && hole.hazard === "water" && !!hole.signature && /island/i.test(hole.signature);
  const mapFeature = isIsland
    ? "Island green"
    : hole.hazard === "water"
      ? "Water in play"
      : hole.hazard === "ocean"
        ? "Ocean in play"
        : hole.hazard === "sand"
          ? "Bunkers"
          : hole.dogleg === "L"
            ? "Dogleg left"
            : hole.dogleg === "R"
              ? "Dogleg right"
              : null;
  const pendingFinish = pending ? finishSummary(shotLog, pending) : null;

  return (
    <div className="play">
      {/* progress hairline, above the card */}
      <div className="play-progress"><i style={{ width: `${(holeIdx / 18) * 100}%` }} /></div>

      {/* ============ THE CARD: one surface (HoleMap seam owns the art) ============ */}
      <div className={`pm-card ${pending ? "is-result" : "is-decision"}`}>
        <div className="pm-card-art">
          {stage === "putt" && puttCtx ? (
            <PuttView putt={puttCtx} />
          ) : (
            <HoleMap hole={hole} wind={course.wind} windDir={course.windDir} greens={course.greens} ballT={ballT} />
          )}

          {/* header floats over the art's own baked-in top scrim */}
          <div className="pm-head">
            <div>
              <div className="pm-num">{hole.number}</div>
              <div className="pm-sub">Par {hole.par} · SI {hole.strokeIndex}</div>
            </div>
            <div className="pm-right">
              <div className="pm-topar"><b>{relativeLabel(rel)}</b><span>to par</span></div>
              {!pending && <div className="pm-yards">{approachYards ?? hole.yardage} yards</div>}
            </div>
          </div>

          {/* The original concept used this rail for three terse conditions,
              leaving the map itself unobstructed and the bottom rail thin. */}
          {!pending && (
            <div className="pm-chips">
              <span className="pm-chip">{course.wind} mph</span>
              <span className="pm-chip">{course.greens.toLowerCase()} greens</span>
              {mapFeature && <span className="pm-chip">{mapFeature}</span>}
            </div>
          )}

          {/* ============ DECISION controls: float on the bottom scrim ============ */}
          {!pending && (
            <div className="pm-controls">
              {challengeId && (
                <div className="pm-opponent">
                  <OpponentStrip challengeId={challengeId} holesCompleted={outcomes.filter(Boolean).length} />
                </div>
              )}

              <div className="pm-reads">
                {positionBanner(stage, hole.par, lie, green, puttCtx, course.greens, cues)}
              </div>

              <div className="pm-prompt">{openingRead ? "Tee shot" : compactStageLabel(stage)}</div>
              <div className="pm-choices">
                {choices.map((d) => {
                  const risk = riskFor(stage, d.id, hole, conditions, lie, puttCtx);
                  const blurb = decisionBlurb(stage, d.id, hole.par, d.blurb);
                  const isAggro = d.id === "aggressive";
                  const outOfBudget = budgeted && isAggro && aggressiveLeft <= 0;
                  return (
                    <button
                      key={d.id}
                      className={`pm-choice c-${d.id} risk-${risk.tone}`}
                      disabled={busy || outOfBudget}
                      onClick={() => choose(d.id)}
                      aria-label={`${d.label}: ${blurb}. ${outOfBudget ? "No aggressive plays left." : risk.text + "."}`}
                    >
                      <span className="pm-choice-top">
                        <span className="pm-lbl"><span className="pm-dot" /><span className="pm-name">{d.label}</span></span>
                        {budgeted && isAggro && (
                          <span className="pm-budget">
                            {outOfBudget ? "spent" : <><b>{aggressiveLeft}</b><i> left</i></>}
                          </span>
                        )}
                      </span>
                      <span className="pm-desc">{blurb}</span>
                      {!outOfBudget && <span className="pm-risk">{risk.text}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============ RESULT: a panel over the bottom of the SAME card ============ */}
          {pending && (
            <div className="pm-result-panel">
              <div className="pr-holeline">Hole {hole.number} · {hole.yardage} yards · SI {hole.strokeIndex}</div>
              <div className={`pr-outcome o-${OUTCOME_META[pending].tone}`} role="status" aria-live="polite">
                <div className="pr-tag">{OUTCOME_META[pending].label}</div>
                {pendingFinish && <div className="pr-finish">{pendingFinish}</div>}
                {shotLog.length > 0 && <div className="pr-quote">“{shotLog[shotLog.length - 1].note}”</div>}
                <div className="pr-run">running <b>{relativeLabel(rel)}</b></div>
              </div>

              {shotLog.length > 0 && holeDecisions.length > 0 && (
                <OddsReveal
                  shots={shotLog}
                  decisions={holeDecisions}
                  hole={{ number: hole.number, par: hole.par, strokeIndex: hole.strokeIndex }}
                  conditions={conditions}
                  greens={course.greens}
                />
              )}

              <button className="pr-cta" onClick={next}>
                {holeIdx >= 17 ? "See your card" : "Next hole"}
              </button>

              <Scorecard holes={course.holes} outcomes={outcomes} currentHole={holeIdx} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function compactStageLabel(stage: SwingStage): string {
  if (stage === "tee") return "Tee shot";
  if (stage === "approach") return "Approach";
  if (stage === "putt") return "Putt";
  return "Short game";
}

function decisionBlurb(stage: SwingStage, decision: Decision, par: number, fallback: string): string {
  if (stage === "tee") {
    if (decision === "safe") return "Find the fairway";
    if (decision === "normal") return "Play your line";
    return "Challenge the trouble";
  }
  // A par-3 "approach" is its tee shot; retain the original concept language.
  if (stage === "approach") {
    if (decision === "safe") return par === 3 ? "Middle of the green" : "Center of the green";
    if (decision === "normal") return "Favor the fat side";
    return "Hunt the pin";
  }
  return fallback;
}

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
      <div className="cues hole-read">
        {cues.map((c, i) => (
          <span
            className={`cue${i === 0 ? ` cue-primary cue-${holeCueTone(c.text)}` : ""}`}
            key={i}
          >
            {i === 0 && <span className="cue-light" />}
            <span className="ci">{c.icon}</span>{c.text}
          </span>
        ))}
      </div>
    );
  }
  // Approach from a known lie -> lie banner.
  if (stage === "approach" && lie) {
    return (
      <div className={`lie-banner l-${LIE_META[lie].tone}`}>
        <span className="le"><span className={`lie-dot tone-${LIE_META[lie].tone}`} /></span>
        <span className="lt"><b>{LIE_META[lie].label}</b><span>{LIE_META[lie].note}</span></span>
      </div>
    );
  }
  // Putt -> green banner + distance/break/speed cues.
  if (stage === "putt" && green && puttCtx) {
    const gr = greenRead(green, puttCtx.puttFor);
    const pr = puttRead(puttCtx.bucket, puttCtx.distanceFt, puttCtx.breakDir, puttCtx.slope, greens, puttCtx.puttFor);
    // Bold banner title: for a makeable putt, label by what it's FOR (eagle on a
    // par-5 reached in two) instead of the static "Birdie look" in GREEN_META.
    const puttTitle = green === "makeable" ? puttForLabel(puttCtx.puttFor) : GREEN_META[green].label;
    return (
      <>
        <div className={`lie-banner l-${GREEN_META[green].tone === "even" ? "even" : GREEN_META[green].tone === "good" ? "good" : "bad"}`}>
          <span className="le"><span className={`lie-dot tone-${GREEN_META[green].tone}`} /></span>
          <span className="lt"><b>{puttTitle}</b><span>{gr.text}</span></span>
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
        <span className="le"><span className="lie-dot tone-bad" /></span>
        <span className="lt"><b>{GREEN_META[green].label}</b><span>{gr.text}</span></span>
      </div>
    );
  }
  return null;
}

function holeCueTone(text: string): "good" | "warn" | "bad" {
  if (text.startsWith("Gettable")) return "good";
  if (text.startsWith("Card-wrecker")) return "bad";
  return "warn";
}

function OddsReveal({
  shots,
  decisions,
  hole,
  conditions,
  greens,
}: {
  shots: ShotRecord[];
  decisions: Decision[];
  hole: { number: number; par: number; strokeIndex: number };
  conditions: { difficulty: number; wind: number };
  greens: GreenSpeed;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="odds-toggle" onClick={() => setOpen(true)} aria-expanded="false">
        See the odds you faced
      </button>
    );
  }

  // Walk the shots the player actually made and pair each DECISION shot with its
  // odds block. Kick-ins/layup/auto shots have decision === null and are skipped.
  const order: Decision[] = ["safe", "normal", "aggressive"];
  const isPar3 = hole.par === 3;
  let teeLie: Lie | null = null;
  const blocks: ReactNode[] = [];

  for (const s of shots) {
    if (s.stage === "tee" && s.decision) {
      teeLie = (s.lie as Lie) ?? null;
      const rows = teeOddsReveal(hole, conditions);
      blocks.push(
        <StageOdds key="tee" title="Tee shot" chosen={s.decision} order={order}
          rows={order.map((d) => ({ label: rows[d].label, decision: d,
            segs: [{ cls: "good", w: rows[d].pct.dialed + rows[d].pct.fairway }, { cls: "rough", w: rows[d].pct.rough }, { cls: "trouble", w: rows[d].pct.trouble }],
            right: `${rows[d].goodPct}%` }))}
          legend={[["good", "short grass"], ["rough", "rough"], ["trouble", "trouble"]]}
          takeaway={teeOddsTakeaway(s.decision, hole, conditions)} />
      );
    } else if (s.stage === "approach" && s.decision) {
      const source: GreenSource = isPar3 ? "tee" : (teeLie ?? "fairway");
      const rows = approachOddsReveal(source, hole, conditions);
      blocks.push(
        <StageOdds key="approach" title="Approach" chosen={s.decision} order={order}
          rows={order.map((d) => ({ label: rows[d].label, decision: d,
            segs: [{ cls: "good", w: rows[d].kickinPct + rows[d].makeablePct }, { cls: "rough", w: rows[d].lagPct }, { cls: "trouble", w: rows[d].scramblePct }],
            right: `${rows[d].greenPct}%` }))}
          legend={[["good", "birdie look"], ["rough", "long putt"], ["trouble", "missed green"]]}
          takeaway={approachOddsTakeaway(s.decision, source, hole, conditions)} />
      );
    } else if (s.stage === "putt" && s.decision) {
      const bucket = s.green === "makeable" ? "short" : "long";
      const distanceFt = s.distanceFt ?? (bucket === "short" ? 12 : 35);
      const rows = puttOddsReveal(bucket, greens, distanceFt);
      blocks.push(
        <StageOdds key="putt" title="Putt" chosen={s.decision} order={order}
          rows={order.map((d) => ({ label: rows[d].label, decision: d,
            segs: [{ cls: "good", w: rows[d].onePct }, { cls: "rough", w: rows[d].twoPct }, { cls: "trouble", w: rows[d].threePct }],
            right: `${rows[d].onePct}%` }))}
          legend={[["good", "one-putt"], ["rough", "two-putt"], ["trouble", "three-putt"]]}
          takeaway={puttOddsTakeaway(s.decision, bucket, greens, distanceFt)} />
      );
    } else if (s.stage === "scramble" && s.decision) {
      const rows = scrambleOddsReveal(hole, conditions);
      blocks.push(
        <StageOdds key="scramble" title="Short game" chosen={s.decision} order={order}
          rows={order.map((d) => ({ label: rows[d].label, decision: d,
            segs: [{ cls: "good", w: rows[d].updownPct }, { cls: "rough", w: rows[d].twochipPct }, { cls: "trouble", w: rows[d].blowupPct + rows[d].disasterPct }],
            right: `${rows[d].savePct}%` }))}
          legend={[["good", "up & down"], ["rough", "chip & two-putt"], ["trouble", "blow-up"]]}
          takeaway={scrambleOddsTakeaway(s.decision, hole, conditions)} />
      );
    }
  }

  return (
    <div className="odds-reveal" role="region" aria-label="Odds you faced this hole">
      <div className="odds-reveal-title">The odds you faced · every decision</div>
      {blocks}
    </div>
  );
}

/** One stage's odds block: three decision rows (safe/normal/aggressive) with a
 * three-segment bar + a plain-English takeaway. Reused across tee/approach/putt/
 * scramble so every decision reads the same way. */
function StageOdds({
  title, chosen, order, rows, legend, takeaway,
}: {
  title: string;
  chosen: Decision;
  order: Decision[];
  rows: { label: string; decision: Decision; segs: { cls: string; w: number }[]; right: string }[];
  legend: [string, string][];
  takeaway: string;
}) {
  return (
    <div className="odds-stage">
      <div className="odds-reveal-h">{title} · odds you faced</div>
      {rows.map((r) => (
        <div className={`odds-row ${r.decision === chosen ? "mine" : ""}`} key={r.decision}>
          <span className="odds-name">{r.label}{r.decision === chosen ? " ✓" : ""}</span>
          <span className="odds-bar" aria-hidden="true">
            {r.segs.map((s, i) => (
              <span key={i} className={`odds-seg ${s.cls}`} style={{ width: `${s.w}%` }} />
            ))}
          </span>
          <span className="odds-good-lbl">{r.right}</span>
        </div>
      ))}
      <div className="odds-legend">
        {legend.map(([cls, lbl]) => (
          <span key={cls}><i className={cls} /> {lbl}</span>
        ))}
      </div>
      <div className="odds-take">{takeaway}</div>
    </div>
  );
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
  if (stage === "putt" && puttCtx) return puttRiskRead(d, puttCtx.bucket, puttCtx.speed, puttCtx.distanceFt);
  return shortGameRiskRead(d);
}
