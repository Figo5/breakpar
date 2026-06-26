import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { courseBySlug } from "@/data/courses";
import { resolveHoleForRound, type HoleSpec } from "@/lib/engine/resolveHole";
import type { Decision } from "@/lib/engine/probabilities";
import { route } from "@/lib/api";
import { rateLimit } from "@/lib/rateLimit";

const DECISIONS: Decision[] = ["safe", "normal", "aggressive"];

// PATCH: submit a decision for one hole. The SERVER resolves the outcome.
export const PATCH = route(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const limited = await rateLimit("hole", 120, 60_000); // 120/min (well above real play)
  if (limited) return limited;

  const { id: roundId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    holeNumber?: number;
    decision?: Decision;
  };
  const holeNumber = Number(body.holeNumber);
  const decision = body.decision;
  if (!decision || !DECISIONS.includes(decision) || !(holeNumber >= 1 && holeNumber <= 18))
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

  // Resolve against the round's OWN stored course (works for both daily and
  // unlimited rounds, and is immune to UTC-midnight rollover).
  const course = courseBySlug(round.course.slug);
  const holeData = course?.holes.find((h) => h.number === holeNumber);
  if (!course || !holeData)
    return NextResponse.json({ error: "bad-input" }, { status: 400 });
  const spec: HoleSpec = {
    number: holeData.number,
    par: holeData.par,
    strokeIndex: holeData.strokeIndex,
  };

  // Deterministic, seeded by (server secret, roundId, holeNumber) — tamper-proof.
  const result = resolveHoleForRound(roundId, decision, spec, {
    difficulty: course.difficulty,
    wind: course.wind,
  });

  let updated;
  try {
    [, updated] = await prisma.$transaction([
      prisma.holeResult.create({
        data: {
          roundId,
          holeNumber,
          decision,
          outcome: result.outcome,
          scoreChange: result.scoreDelta,
        },
      }),
      prisma.round.update({
        where: { id: roundId },
        data: {
          score: { increment: result.strokes },
          relativeToPar: { increment: result.scoreDelta },
        },
      }),
    ]);
  } catch (e) {
    // Concurrent submit for the same hole: the @@unique([roundId, holeNumber])
    // constraint rejects the duplicate (and rolls back the score increment).
    // Return the already-stored result so the client stays consistent.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const stored = await prisma.holeResult.findUnique({
        where: { roundId_holeNumber: { roundId, holeNumber } },
      });
      const fresh = await prisma.round.findUnique({ where: { id: roundId } });
      if (stored && fresh)
        return NextResponse.json({
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
    outcome: result.outcome,
    label: result.label,
    emoji: result.emoji,
    scoreChange: result.scoreDelta,
    strokes: result.strokes,
    score: updated.score,
    relativeToPar: updated.relativeToPar,
  });
});
