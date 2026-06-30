/**
 * Shared leaderboard queries. Centralised so the API route and the result page
 * read the same ordering (score asc, then duration asc) and the rank math stays
 * in one place.
 */

import { prisma } from "@/lib/db";

export interface BoardEntry {
  id: string;
  userId: string;
  username: string;
  xHandle: string | null; // optional X handle; null renders unchanged
  score: number;
  durationMs: number | null;
  rank: number;
}

/** Top `limit` completed rounds for a given day, ranked. */
export async function topBoard(dateKey: string, limit: number): Promise<BoardEntry[]> {
  const rows = await prisma.round.findMany({
    where: { dateKey, completed: true },
    orderBy: [{ score: "asc" }, { durationMs: "asc" }],
    take: limit,
    include: { user: { select: { username: true, xHandle: true } } },
  });
  return rows.map((r, i) => ({
    id: r.id,
    userId: r.userId,
    username: r.user.username,
    xHandle: r.user.xHandle,
    score: r.score,
    durationMs: r.durationMs,
    rank: i + 1,
  }));
}

/** Size of the day's completed field and how many rounds beat `score`. */
export async function fieldStats(dateKey: string, score: number) {
  const [fieldSize, betterCount] = await Promise.all([
    prisma.round.count({ where: { dateKey, completed: true } }),
    prisma.round.count({ where: { dateKey, completed: true, score: { lt: score } } }),
  ]);
  // 1-based rank within the field (1 = best).
  return { fieldSize, betterCount, rank: betterCount + 1 };
}
