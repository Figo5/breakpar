import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { courseBySlug } from "@/data/courses";
import { type HoleSpec } from "@/lib/engine/resolveHole";
import {
  resolveHoleChain,
  MAX_DECISIONS,
  approachDecisionCount,
  countTeeApproachAggressive,
} from "@/lib/engine/shots";
import { holeShotSeed, eventSeed } from "@/lib/engine/rng";
import type { Decision, Outcome } from "@/lib/engine/probabilities";
import type { GreenSpeed } from "@/lib/engine/putting";
import { AGGRESSIVE_BUDGET } from "@/lib/holeRead";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";

const DECISIONS: Decision[] = ["safe", "normal", "aggressive"];

// PATCH: submit the decision SEQUENCE for one hole (variable-length chain). The
// client sends every decision made on this hole so far; the SERVER replays them
// with per-shot seeded RNG + seeded events. While the hole is unfinished it
// returns the NEXT-STAGE descriptor (reads, the play-by-play note, any event)
// and persists nothing — deterministic, so it's safe to re-send. Once the chain
// resolves it writes a single HoleResult and advances the round.
export const PATCH = route(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const limited = await rateLimit("hole", 360, 60_000); // 360/min (3 shots/hole headroom)
  if (limited) return limited;

  const { id: roundId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    holeNumber?: number;
    decisions?: Decision[];
  };
  const holeNumber = Number(body.holeNumber);
  const decisions = Array.isArray(body.decisions) ? body.decisions : [];
  const validSeq =
    decisions.length >= 1 &&
    decisions.length <= MAX_DECISIONS &&
    decisions.every((d) => DECISIONS.includes(d));
  if (!validSeq || !(holeNumber >= 1 && holeNumber <= 18))
    return NextResponse.json({ error: "bad-input" }, { status: 400 });

  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: { holeResults: true, course: { select: { slug: true } } },
  });
  if (!round || round.userId !== user.id)
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (round.completed)
    return NextResponse.json({ error: "round-complete" }, { status: 409 });

  // Anti re-roll: a hole already resolved returns its stored result unchanged.
  const existing = round.holeResults.find((h) => h.holeNumber === holeNumber);
  if (existing) {
    return NextResponse.json({
      complete: true,
      outcome: existing.outcome,
      scoreChange: existing.scoreChange,
      score: round.score,
      relativeToPar: round.relativeToPar,
      replayed: true,
    });
  }

  // Enforce sequential play (hole N requires N-1 holes already done).
  if (round.holeResults.length !== holeNumber - 1)
    return NextResponse.json({ error: "out-of-order" }, { status: 409 });

  // Resolve against the round's OWN stored course (immune to UTC rollover).
  const course = courseBySlug(round.course.slug);
  const holeData = course?.holes.find((h) => h.number === holeNumber);
  if (!course || !holeData)
    return NextResponse.json({ error: "bad-input" }, { status: 400 });
  const spec: HoleSpec = {
    number: holeData.number,
    par: holeData.par,
    strokeIndex: holeData.strokeIndex,
  };

  // Aggression budget — counted across the round on TEE/APPROACH decisions only
  // (putt/short-game decisions reuse the vocab but are never charged). Recount
  // from stored chains, each interpreted with its own hole's par.
  const parOf = (n: number) => course.holes.find((h) => h.number === n)?.par ?? 4;
  const priorAggr = round.holeResults.reduce(
    (sum, h) => sum + countTeeApproachAggressive(h.decision, parOf(h.holeNumber)),
    0
  );
  const thisAggr = decisions
    .slice(0, approachDecisionCount(holeData.par))
    .filter((d) => d === "aggressive").length;
  if (priorAggr + thisAggr > AGGRESSIVE_BUDGET)
    return NextResponse.json(
      { error: "budget-exhausted", aggressiveBudget: AGGRESSIVE_BUDGET },
      { status: 409 }
    );

  // Momentum reads the round's prior outcomes (deterministic, no dice).
  const recent: Outcome[] = round.holeResults
    .slice()
    .sort((a, b) => a.holeNumber - b.holeNumber)
    .map((h) => h.outcome as Outcome);

  // Deterministic per (server secret, round, hole, shot) — tamper-proof.
  const step = resolveHoleChain(decisions, spec, { difficulty: course.difficulty, wind: course.wind }, {
    shotSeed: (shot) => holeShotSeed(roundId, holeNumber, shot),
    eventSeed: (shot) => eventSeed(roundId, holeNumber, shot),
    greens: course.greens as GreenSpeed,
    recent,
    holeYards: holeData.yardage, // display-only: drives yards-to-target + tee distance
  });

  // Hole not finished: report the next stage + reads + play-by-play. Persist
  // nothing (deterministic, so re-sending reproduces the same chain).
  if (!step.complete) {
    const last = step.shots[step.shots.length - 1] ?? null;
    return NextResponse.json({
      complete: false,
      stage: step.next,
      lie: step.lie ?? null,
      green: step.green ?? null,
      putt: step.putt ?? null,
      approachYards: step.approachYards ?? null,
      ballT: step.ballT ?? null,
      note: last?.note ?? null,
      event: last?.event ?? null,
      shots: step.shots,
    });
  }

  const usedDecisions = decisions.slice(0, step.used).join(",");
  let updated;
  try {
    [, updated] = await prisma.$transaction([
      prisma.holeResult.create({
        data: {
          roundId,
          holeNumber,
          decision: usedDecisions, // full shot sequence actually played this hole
          outcome: step.outcome!,
          scoreChange: step.scoreDelta!,
        },
      }),
      prisma.round.update({
        where: { id: roundId },
        data: {
          score: { increment: step.strokes! },
          relativeToPar: { increment: step.scoreDelta! },
        },
      }),
    ]);
  } catch (e) {
    // Concurrent submit for the same hole: the @@unique([roundId, holeNumber])
    // constraint rejects the duplicate (and rolls back the score increment).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const stored = await prisma.holeResult.findUnique({
        where: { roundId_holeNumber: { roundId, holeNumber } },
      });
      const fresh = await prisma.round.findUnique({ where: { id: roundId } });
      if (stored && fresh)
        return NextResponse.json({
          complete: true,
          outcome: stored.outcome,
          scoreChange: stored.scoreChange,
          score: fresh.score,
          relativeToPar: fresh.relativeToPar,
          replayed: true,
        });
    }
    throw e;
  }

  const last = step.shots[step.shots.length - 1] ?? null;
  return NextResponse.json({
    complete: true,
    lie: step.lie ?? null,
    green: step.green ?? null,
    outcome: step.outcome,
    scoreChange: step.scoreDelta,
    strokes: step.strokes,
    note: last?.note ?? null,
    event: last?.event ?? null,
    shots: step.shots,
    score: updated.score,
    relativeToPar: updated.relativeToPar,
  });
});
