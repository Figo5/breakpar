/**
 * Server-only trophy fetch. Kept separate from lib/trophies.ts (pure/client-
 * safe) so the client toggle can import trophy types + metadata without pulling
 * prisma / next/headers into the client bundle.
 */

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { COURSES } from "@/data/courses";
import {
  summarizeRounds,
  evaluateTrophies,
  newlyUnlocked,
  buildTrophyBoard,
  type RoundLite,
  type TrophyBoard,
  type TrophyState,
} from "@/lib/trophies";

export async function getTrophies(): Promise<TrophyBoard | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  // One pull of the user's own completed rounds + their hole outcomes, reduced
  // in JS (same pattern as hallOfFame). Bounded by one player's play; fine at
  // current scale. Plus the streak row for the day-ladders.
  const [rows, streak] = await Promise.all([
    prisma.round.findMany({
      where: { userId: user.id, completed: true },
      select: {
        relativeToPar: true,
        courseId: true,
        holeResults: { select: { outcome: true, scoreChange: true } },
      },
    }),
    prisma.streak.findUnique({ where: { userId: user.id } }),
  ]);

  const lite: RoundLite[] = rows.map((r) => ({
    relativeToPar: r.relativeToPar,
    courseKey: r.courseId,
    holes: r.holeResults,
  }));

  const stats = summarizeRounds(lite, COURSES.length, streak?.maxStreak ?? 0);

  // Attach unlock dates (B2). Null unlockedAt (backfilled/unknown) stays null so
  // the UI shows a date only when it's truthful.
  const awards = await prisma.trophyAward.findMany({
    where: { userId: user.id },
    select: { trophyId: true, unlockedAt: true },
  });
  const dates = new Map<string, string | null>(
    awards.map((a) => [a.trophyId, a.unlockedAt ? a.unlockedAt.toISOString() : null])
  );
  return buildTrophyBoard(stats, !!user.clerkId, dates, user.featuredTrophies);
}

/** A completed round reduced to RoundLite, fetched from the DB for a user. */
async function completedRounds(userId: string): Promise<{ id: string; lite: RoundLite }[]> {
  const rows = await prisma.round.findMany({
    where: { userId, completed: true },
    select: {
      id: true,
      relativeToPar: true,
      courseId: true,
      holeResults: { select: { outcome: true, scoreChange: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    lite: { relativeToPar: r.relativeToPar, courseKey: r.courseId, holes: r.holeResults },
  }));
}

/**
 * Award trophies on round finish. Compares the trophy set AS OF this round
 * (after) against the set WITHOUT it (before) so only genuine new unlocks are
 * celebrated — existing players' history never re-fires (see lib/trophies
 * newlyUnlocked). Idempotent: awards are createMany({ skipDuplicates }) on a
 * unique (userId, trophyId), and the finish route only calls this on the
 * winning claim, so no double-awards. Backfilled historical trophies get a NULL
 * unlockedAt (unknown date); genuine new unlocks get the real timestamp.
 *
 * Must be called AFTER the streak roll-up so afterMaxStreak reflects this round.
 * Returns the newly-unlocked trophies for the result-screen celebration.
 */
export async function awardTrophiesOnFinish(args: {
  userId: string;
  roundId: string;
  beforeMaxStreak: number;
  afterMaxStreak: number;
}): Promise<TrophyState[]> {
  const { userId, roundId, beforeMaxStreak, afterMaxStreak } = args;
  const rounds = await completedRounds(userId);
  const total = COURSES.length;

  const afterRounds = rounds.map((r) => r.lite);
  const beforeRounds = rounds.filter((r) => r.id !== roundId).map((r) => r.lite);

  const after = evaluateTrophies(summarizeRounds(afterRounds, total, afterMaxStreak));
  const before = evaluateTrophies(summarizeRounds(beforeRounds, total, beforeMaxStreak));

  const fresh = newlyUnlocked(before, after);
  const freshIds = new Set(fresh.map((t) => t.id));
  const now = new Date();

  // Persist every currently-earned trophy (idempotent). Genuine new unlocks get
  // a real date; backfilled historical ones get null (unknown).
  const rows = after
    .filter((s) => s.earned)
    .map((s) => ({ userId, trophyId: s.id, unlockedAt: freshIds.has(s.id) ? now : null }));
  if (rows.length) await prisma.trophyAward.createMany({ data: rows, skipDuplicates: true });

  return fresh;
}
