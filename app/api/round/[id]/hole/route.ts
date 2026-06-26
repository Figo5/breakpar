import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { courseBySlug } from "@/data/courses";
import { type HoleSpec } from "@/lib/engine/resolveHole";
import { resolveHoleShots, SHOTS_PER_HOLE } from "@/lib/engine/shots";
import { holeShotSeed } from "@/lib/engine/rng";
import type { Decision } from "@/lib/engine/probabilities";
import { AGGRESSIVE_BUDGET } from "@/lib/holeRead";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";

const DECISIONS: Decision[] = ["safe", "normal", "aggressive"];
const countAggressive = (joined: string) => joined.split(",").filter((d) => d === "aggressive").length;

// PATCH: submit the decision SEQUENCE for one hole (multi-shot). The client
// sends every decision made on this hole so far; the SERVER replays them with
// per-shot seeded RNG. While the hole is unfinished it returns the resulting
// lie (and persists nothing — deterministic, so it's safe to re-send). Once the
// final shot lands it writes a single HoleResult and advances the round.
export const PATCH = route(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const limited = await rateLimit("hole", 240, 60_000); // 240/min (2 shots/hole headroom)
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
    decisions.length <= SHOTS_PER_HOLE &&
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

  // Enforce the aggression budget server-side across the whole round (the
  // decision column stores the per-hole shot sequence, so we can recount).
  const priorAggr = round.holeResults.reduce((n, h) => n + countAggressive(h.decision), 0);
  if (priorAggr + decisions.filter((d) => d === "aggressive").length > AGGRESSIVE_BUDGET)
    return NextResponse.json(
      { error: "budget-exhausted", aggressiveBudget: AGGRESSIVE_BUDGET },
      { status: 409 }
    );

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

  // Deterministic per (server secret, round, hole, shot) — tamper-proof.
  const step = resolveHoleShots(decisions, spec, { difficulty: course.difficulty, wind: course.wind }, (shot) =>
    holeShotSeed(roundId, holeNumber, shot)
  );

  // Hole not finished: report the lie, persist nothing (safe to re-send).
  if (!step.complete)
    return NextResponse.json({ complete: false, shot: step.shot, lie: step.lie });

  let updated;
  try {
    [, updated] = await prisma.$transaction([
      prisma.holeResult.create({
        data: {
          roundId,
          holeNumber,
          decision: decisions.join(","), // full shot sequence for this hole
          outcome: step.outcome,
          scoreChange: step.scoreDelta,
        },
      }),
      prisma.round.update({
        where: { id: roundId },
        data: {
          score: { increment: step.strokes },
          relativeToPar: { increment: step.scoreDelta },
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

  return NextResponse.json({
    complete: true,
    lie: step.lie,
    outcome: step.outcome,
    scoreChange: step.scoreDelta,
    strokes: step.strokes,
    score: updated.score,
    relativeToPar: updated.relativeToPar,
  });
});
