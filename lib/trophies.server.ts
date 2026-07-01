/**
 * Server-only trophy fetch. Kept separate from lib/trophies.ts (pure/client-
 * safe) so the client toggle can import trophy types + metadata without pulling
 * prisma / next/headers into the client bundle.
 */

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { COURSES } from "@/data/courses";
import { summarizeRounds, buildTrophyBoard, type RoundLite, type TrophyBoard } from "@/lib/trophies";

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
  return buildTrophyBoard(stats, !!user.clerkId);
}
