import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { nextStreak, type StreakState } from "@/lib/scoring";
import { route } from "@/lib/api";

// POST: finalize the round and roll up streak + best-score stats.
export const POST = route(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: roundId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Body is no longer trusted for duration (see below); parsed only to stay
  // tolerant of older clients still sending it.
  await req.json().catch(() => ({}));

  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: { holeResults: true },
  });
  if (!round || round.userId !== user.id)
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (round.holeResults.length !== 18)
    return NextResponse.json({ error: "incomplete" }, { status: 409 });

  // Duration is a leaderboard tiebreaker, so it must be server-authoritative.
  // Derive it from the round's creation timestamp rather than a client-supplied
  // value (which a client could set to 0 to win every tie).
  const durationMs = Date.now() - round.playedAt.getTime();

  // Idempotency / concurrency guard. Finalizing is a one-time false->true
  // transition: claim it with a conditional update so exactly one caller wins,
  // even under concurrent requests. Re-runs must NOT touch streak stats again —
  // doing so would double-count daysPlayed and reset currentStreak.
  const claim = await prisma.round.updateMany({
    where: { id: roundId, completed: false },
    data: { completed: true, durationMs },
  });

  if (claim.count === 0) {
    // Already finalized by a previous (or concurrent winning) request.
    const current = (await prisma.streak.findUnique({
      where: { userId: user.id },
    })) as (StreakState & { lastPlayedKey: string | null }) | null;
    return NextResponse.json({ score: round.score, streak: current, replayed: true });
  }

  // Unlimited (practice) rounds don't count toward streaks or the daily ladder.
  if (round.mode !== "daily" || !round.dateKey)
    return NextResponse.json({ score: round.score, streak: null });

  // We own the finalize transition — safe to roll up the streak exactly once.
  // Anchor streak days to the round's own puzzle day (round.dateKey), matching
  // the one-round-per-day model, so finishing just after midnight still counts
  // for the day the puzzle belongs to rather than wall-clock "today".
  const prev = (await prisma.streak.findUnique({ where: { userId: user.id } })) as
    | (StreakState & { lastPlayedKey: string | null })
    | null;
  // relativeToPar is course-agnostic, so streak stats compare fairly day to day.
  // nextStreak owns the one-day-freeze continuity rule (DST-safe, see lib/scoring).
  const next = nextStreak(prev, round.dateKey, round.relativeToPar);
  // Total under-par days powers the win % stat (separate from the consecutive run).
  const underParTotal =
    ((prev as { underParTotal?: number } | null)?.underParTotal ?? 0) +
    (round.relativeToPar < 0 ? 1 : 0);

  await prisma.streak.upsert({
    where: { userId: user.id },
    update: { ...next, underParTotal, lastPlayedKey: round.dateKey },
    create: { userId: user.id, ...next, underParTotal, lastPlayedKey: round.dateKey },
  });

  return NextResponse.json({ score: round.score, streak: next });
});
